/**
 * 性能の採取スペック（雛形）— parity-suite
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は
 * `<parity_suite_dir>/parity/<slug>/perf/perf.spec.ts` にする（実際のパスは metadata.json の suite.perf に記録する）。
 * `current` と `new` の両方のプロジェクトに含める（`current-only/`・`new-only/` に置かない）。
 * 出力先は project 名で分けるので、相手側の記録を上書きしない。
 *
 * 何を採るか: capture_conditions.pages × viewports の組ごとに、ウォームアップの 1 回を捨ててから
 * PARITY_PERF_RUNS 回（デフォルト 10）読み込み、次の 4 つを読む。読み込むたびに新しいコンテキストを作る（キャッシュの無い状態）。
 *   lcp  … 最後の largest-contentful-paint の startTime（ms）。候補が出ない頁は null。
 *   cls  … layout-shift の value の合計（入力の直後のものを除く。セッションウィンドウにはまとめない）。
 *   tbt  … longtask の (duration − 50ms) の合計（ms。TBT 相当。FCP から TTI までに限らない）。
 *   ttfb … navigation の responseStart（ms）。
 * 値は読み込みから PARITY_PERF_SETTLE_MS（デフォルト 3000）の間に出たエントリを、PerformanceObserver の buffered で読む。
 * 集計とノイズの幅は、スキルの scripts/perf-stats.mjs が決める（このスペックは値を並べるだけ）。
 *
 * 環境変数は次のとおりである。
 *   PARITY_PERF_CAPTURE … "1" の実行でだけ採る。強度チェック・green の確認・ノイズの測定では渡さない（記録を上書きしない）。
 *   PARITY_SLUG         … 対象機能の slug（必須）。
 *   PARITY_NEW_TARGET   … `new` で実行するとき必須。出力先 new/<target>/ を決める。
 *   PARITY_PERF_RUNS    … 1 組あたりの回数（5 以上。デフォルト 10）。
 *   PARITY_PERF_SETTLE_MS … 読み込みの後、値を読むまでの時間（デフォルト 3000）
 *   PARITY_REPO_ROOT    … `.replace/` を持つリポジトリのルート（省略時は cwd）
 *
 * 実行は直列にする（`--workers=1`）。並列に読み込むと CPU を取り合い、互いの値を遅くする。
 * ブラウザは Playwright が起動したものを使う（capture_conditions.browser が cdp でも、このスペックは接続しない）。
 * `channel` を指定するか `headless: false` にすると、Playwright の headless shell ではなく完全版の Chromium か
 * Google Chrome が起動し、ブラウザ本体が起動しただけで Google へ送信する。性能の比較にも、その送信の分の負荷が入る。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { test } from "@playwright/test";

// scripts/perf-stats.mjs の SAMPLES_VERSION と同じ値にする
const PERF_SAMPLES_VERSION = "1";

test("性能の採取", async ({ browser }, testInfo) => {
  test.skip(process.env.PARITY_PERF_CAPTURE !== "1", "PARITY_PERF_CAPTURE=1 の実行でだけ採る");
  const side = testInfo.project.name;
  if (side !== "current" && side !== "new") {
    throw new Error(`current / new 以外の project で実行された: ${side}`);
  }
  if (testInfo.config.workers !== 1) {
    throw new Error(
      `--workers=1 で実行する（並列の読み込みは互いの値を遅くする）: workers=${testInfo.config.workers}`,
    );
  }
  const slug = requireName("PARITY_SLUG");
  const repoRoot = process.env.PARITY_REPO_ROOT ?? process.cwd();
  const root = join(repoRoot, ".replace", "parity", slug);
  const out =
    side === "current"
      ? join(root, "perf-samples.json")
      : join(root, "new", requireName("PARITY_NEW_TARGET"), "perf-samples.json");
  const rel = relative(root, out);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`出力先 ${out} が ${root} の外を指す`);

  const runs = Number(process.env.PARITY_PERF_RUNS ?? "10");
  const settleMs = Number(process.env.PARITY_PERF_SETTLE_MS ?? "3000");
  if (!Number.isInteger(runs) || runs < 5)
    throw new Error(`PARITY_PERF_RUNS は 5 以上の整数: ${runs}`);
  if (!Number.isInteger(settleMs) || settleMs < 0)
    throw new Error(`PARITY_PERF_SETTLE_MS は 0 以上の整数: ${settleMs}`);

  // 組は metadata.json（parity-suite が記録した現側の条件）から読む。手で書き写さない
  const metadata = JSON.parse(readFileSync(join(root, "metadata.json"), "utf8"));
  const pages: { name: string; path: string }[] = metadata.capture_conditions.pages;
  const viewports: { label: string; width: number; height: number }[] =
    metadata.capture_conditions.viewports;
  test.setTimeout(pages.length * viewports.length * (runs + 1) * (settleMs + 30_000));

  // largest-contentful-paint と longtask は Chromium 系でしか観測できない（Firefox・WebKit では observe が例外になる）
  if (browser.browserType().name() !== "chromium") {
    throw new Error(`性能は chromium の project で採る: ${browser.browserType().name()}`);
  }
  const use = testInfo.project.use;
  const channel = use.channel ?? null;
  const headless = use.headless ?? true; // Playwright Test のデフォルトは headless: true
  if (channel !== null || headless === false) {
    console.warn(
      `[perf] channel=${channel} headless=${headless}: ブラウザ本体が Google へ送信する構成で測っている（デフォルトの headless shell では送信しない）`,
    );
  }

  const samples: Record<string, unknown>[] = [];
  for (const viewport of viewports) {
    for (const pageDef of pages) {
      for (let run = 0; run <= runs; run += 1) {
        // TODO: 認証が要るなら、プロジェクトの現側スペックと同じ方法でここに入れる（storageState を使うなら下の指定で足りる）。
        // browser.newContext は project の use を引き継がない。現側のスイートが extraHTTPHeaders・userAgent・
        // colorScheme・httpCredentials なども使っているなら、ここへ足す（現側と新側で同じ指定にする）
        const context = await browser.newContext({
          baseURL: use.baseURL,
          storageState: use.storageState,
          ignoreHTTPSErrors: use.ignoreHTTPSErrors,
          locale: use.locale,
          timezoneId: use.timezoneId,
          viewport: { width: viewport.width, height: viewport.height },
        });
        try {
          const page = await context.newPage();
          await page.goto(pageDef.path, { waitUntil: "load" });
          // 出典: https://developer.mozilla.org/docs/Web/API/PerformanceObserver/observe（buffered）、
          // https://web.dev/articles/lcp・https://web.dev/articles/cls・https://web.dev/articles/tbt
          const values = await page.evaluate(
            (settle) =>
              new Promise<{ lcp: number | null; cls: number; tbt: number; ttfb: number }>(
                (resolve) => {
                  const out = { lcp: null as number | null, cls: 0, tbt: 0, ttfb: 0 };
                  const nav = performance.getEntriesByType("navigation")[0] as
                    | PerformanceNavigationTiming
                    | undefined;
                  out.ttfb = nav ? nav.responseStart : 0;
                  const onLcp = (entries: PerformanceEntryList) => {
                    const last = entries.at(-1);
                    if (last) out.lcp = last.startTime;
                  };
                  const onShift = (entries: PerformanceEntryList) => {
                    for (const e of entries as (PerformanceEntry & {
                      value: number;
                      hadRecentInput: boolean;
                    })[]) {
                      if (!e.hadRecentInput) out.cls += e.value;
                    }
                  };
                  const onLongTask = (entries: PerformanceEntryList) => {
                    for (const e of entries) out.tbt += Math.max(0, e.duration - 50);
                  };
                  const observers: [PerformanceObserver, (e: PerformanceEntryList) => void][] = [
                    [new PerformanceObserver((l) => onLcp(l.getEntries())), onLcp],
                    [new PerformanceObserver((l) => onShift(l.getEntries())), onShift],
                    [new PerformanceObserver((l) => onLongTask(l.getEntries())), onLongTask],
                  ];
                  observers[0][0].observe({ type: "largest-contentful-paint", buffered: true });
                  observers[1][0].observe({ type: "layout-shift", buffered: true });
                  observers[2][0].observe({ type: "longtask", buffered: true });
                  setTimeout(() => {
                    // コールバックは非同期なので、まだ渡されていないエントリを取り出してから返す
                    for (const [observer, handle] of observers) {
                      handle(observer.takeRecords());
                      observer.disconnect();
                    }
                    resolve(out);
                  }, settle);
                },
              ),
            settleMs,
          );
          // 0 回目はウォームアップ（ブラウザの起動直後の 1 回は遅い）。記録しない
          if (run > 0)
            samples.push({ page: pageDef.name, viewport: viewport.label, run, ...values });
        } finally {
          await context.close();
        }
      }
    }
  }

  const cpuList = cpus();
  writeJsonAtomic(out, {
    version: PERF_SAMPLES_VERSION,
    side,
    slug,
    target: side === "new" ? process.env.PARITY_NEW_TARGET : null,
    measured_at: new Date().toISOString(),
    environment: {
      browser_name: browser.browserType().name(),
      browser_version: browser.version(),
      channel,
      headless,
      runner: {
        platform: platform(),
        arch: arch(),
        cpu_model: cpuList[0]?.model ?? null,
        cpu_count: cpuList.length > 0 ? cpuList.length : null,
      },
    },
    settings: {
      runs,
      warmup: 1,
      settle_ms: settleMs,
      cache: "cold",
      workers: testInfo.config.workers,
    },
    samples,
  });
});

function requireName(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} が未設定`);
  // 1 つのディレクトリ名に限る（`..`・区切り文字を通さない）
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || v.includes("..")) {
    throw new Error(`${name} がディレクトリ名の形でない: ${v}`);
  }
  return v;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
