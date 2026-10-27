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
 *   cls  … layout-shift をセッションウィンドウ（直前のずれから 1 秒以内・最初のずれから 5 秒以内）にまとめた合計の最大値。
 *          入力の直後のずれは除く（https://web.dev/articles/cls の定義）。
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
import { test, type Browser, type TestInfo } from "@playwright/test";

// scripts/perf-stats.mjs の SAMPLES_VERSION と同じ値にする
const PERF_SAMPLES_VERSION = "1";

type PageDef = { name: string; path: string };
type Viewport = { label: string; width: number; height: number };
type Use = TestInfo["project"]["use"];
type Shift = { at: number; value: number };
// ページの中で読んだ値。cls はずれの一覧から Node の側でまとめる
type PageReading = { lcp: number | null; shifts: Shift[]; tbt: number; ttfb: number };
type PerfValues = { lcp: number | null; cls: number; tbt: number; ttfb: number };

test("性能の採取", async ({ browser }, testInfo) => {
  test.skip(process.env.PARITY_PERF_CAPTURE !== "1", "PARITY_PERF_CAPTURE=1 の実行でだけ採る");
  const side = requireSide(testInfo);
  const { slug, root, out } = outputPaths(side);
  const { runs, settleMs } = runSettings();

  const { pages, viewports } = captureConditions(root);
  test.setTimeout(pages.length * viewports.length * (runs + 1) * (settleMs + 30_000));

  const use = testInfo.project.use;
  const { channel, headless } = browserSettings(browser, use);
  const contextOptions = contextOptionsFromUse(use);
  // 置き場所が両側で違うと、ネットワークの遅れが TTFB・LCP の差に入る。perf-stats.mjs が違いを env_mismatch にする
  const placement = targetPlacement(
    pages.map((p) => p.path),
    typeof contextOptions.baseURL === "string" ? contextOptions.baseURL : undefined,
  );

  const samples = await collectSamples(browser, {
    contextOptions,
    pages,
    viewports,
    runs,
    settleMs,
  });

  writeJsonAtomic(out, {
    version: PERF_SAMPLES_VERSION,
    side,
    slug,
    target: side === "new" ? process.env.PARITY_NEW_TARGET : null,
    measured_at: new Date().toISOString(),
    // 採った組の定義。scripts/perf-stats.mjs が metadata.json の capture_conditions と突き合わせる
    capture: {
      pages: pages.map((p) => ({ name: p.name, path: p.path })),
      viewports: viewports.map((v) => ({ label: v.label, width: v.width, height: v.height })),
    },
    environment: environmentRecord(browser, { channel, headless, placement, contextOptions, use }),
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

// 実行した project が current か new で、直列（--workers=1）で実行されているかを確かめ、project 名を返す
function requireSide(testInfo: TestInfo): "current" | "new" {
  const side = testInfo.project.name;
  if (side !== "current" && side !== "new") {
    throw new Error(`current / new 以外の project で実行された: ${side}`);
  }
  if (testInfo.config.workers !== 1) {
    throw new Error(
      `--workers=1 で実行する（並列の読み込みは互いの値を遅くする）: workers=${testInfo.config.workers}`,
    );
  }
  return side;
}

// 対象機能の記録のディレクトリ（root）と、記録の出力先。出力先が root の外を指すなら失敗にする
function outputPaths(side: "current" | "new"): { slug: string; root: string; out: string } {
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
  return { slug, root, out };
}

// 1 組あたりの回数と、読み込みの後に値を読むまでの時間を環境変数から読む
function runSettings(): { runs: number; settleMs: number } {
  const runs = Number(process.env.PARITY_PERF_RUNS ?? "10");
  const settleMs = Number(process.env.PARITY_PERF_SETTLE_MS ?? "3000");
  if (!Number.isInteger(runs) || runs < 5)
    throw new Error(`PARITY_PERF_RUNS は 5 以上の整数: ${runs}`);
  if (!Number.isInteger(settleMs) || settleMs < 0)
    throw new Error(`PARITY_PERF_SETTLE_MS は 0 以上の整数: ${settleMs}`);
  return { runs, settleMs };
}

// 組は metadata.json（parity-suite が記録した現側の条件）から読む。手で書き写さない
function captureConditions(root: string): { pages: PageDef[]; viewports: Viewport[] } {
  const metadata = JSON.parse(readFileSync(join(root, "metadata.json"), "utf8"));
  const pages: PageDef[] = metadata.capture_conditions.pages;
  const viewports: Viewport[] = metadata.capture_conditions.viewports;
  return { pages, viewports };
}

// ブラウザが Chromium 系かを確かめ、channel と headless を返す。Google へ送信する構成なら警告を出す
function browserSettings(
  browser: Browser,
  use: Use,
): { channel: string | null; headless: boolean } {
  // largest-contentful-paint と longtask は Chromium 系でしか観測できない（Firefox・WebKit では observe が例外になる）
  if (browser.browserType().name() !== "chromium") {
    throw new Error(`性能は chromium の project で採る: ${browser.browserType().name()}`);
  }
  const channel = use.channel ?? null;
  const headless = use.headless ?? true; // Playwright Test のデフォルトは headless: true
  if (channel !== null || headless === false) {
    console.warn(
      `[perf] channel=${channel} headless=${headless}: ブラウザ本体が Google へ送信する構成で測っている（デフォルトの headless shell では送信しない）`,
    );
  }
  return { channel, headless };
}

// viewports × pages の組ごとに、ウォームアップの 1 回と runs 回を読み込み、ウォームアップ以外の値を並べる
async function collectSamples(
  browser: Browser,
  plan: {
    contextOptions: Record<string, unknown>;
    pages: PageDef[];
    viewports: Viewport[];
    runs: number;
    settleMs: number;
  },
): Promise<Record<string, unknown>[]> {
  const samples: Record<string, unknown>[] = [];
  for (const viewport of plan.viewports) {
    for (const pageDef of plan.pages) {
      for (let run = 0; run <= plan.runs; run += 1) {
        const values = await measureOnce(browser, { ...plan, viewport, pageDef });
        // 0 回目はウォームアップ（ブラウザの起動直後の 1 回は遅い）。記録しない
        if (run > 0) samples.push({ page: pageDef.name, viewport: viewport.label, run, ...values });
      }
    }
  }
  return samples;
}

// 新しいコンテキスト（キャッシュの無い状態）で 1 回読み込み、値を読む
async function measureOnce(
  browser: Browser,
  target: {
    contextOptions: Record<string, unknown>;
    viewport: Viewport;
    pageDef: PageDef;
    settleMs: number;
  },
): Promise<PerfValues> {
  // TODO: 認証を storageState 以外の方法で入れているなら、プロジェクトの現側スペックと同じ方法でここに入れる。
  // browser.newContext は project の use を引き継がないので、スイートと同じ指定になるよう、コンテキストの設定を移す
  const context = await browser.newContext({
    ...target.contextOptions,
    viewport: { width: target.viewport.width, height: target.viewport.height },
  });
  try {
    const page = await context.newPage();
    await page.goto(target.pageDef.path, { waitUntil: "load" });
    const reading = await page.evaluate(readInPage, target.settleMs);
    return {
      lcp: reading.lcp,
      cls: sessionWindowCls(reading.shifts),
      tbt: reading.tbt,
      ttfb: reading.ttfb,
    };
  } finally {
    await context.close();
  }
}

// ページの中で実行する。page.evaluate は関数を文字列にしてページへ渡すので、この関数の外の名前を参照しない。
// 出典: https://developer.mozilla.org/docs/Web/API/PerformanceObserver/observe（buffered）、
// https://web.dev/articles/lcp・https://web.dev/articles/cls・https://web.dev/articles/tbt
function readInPage(settle: number): Promise<PageReading> {
  return new Promise<PageReading>((resolve) => {
    const out: PageReading = { lcp: null, shifts: [], tbt: 0, ttfb: 0 };
    const nav = performance.getEntriesByType("navigation")[0];
    out.ttfb = nav instanceof PerformanceNavigationTiming ? nav.responseStart : 0;
    const onLcp = (entries: PerformanceEntryList) => {
      const last = entries.at(-1);
      if (last) out.lcp = last.startTime;
    };
    // LayoutShift は TypeScript の DOM の型に無いので、使う欄を持つかで確かめる
    const isLayoutShift = (
      e: PerformanceEntry,
    ): e is PerformanceEntry & { value: number; hadRecentInput: boolean } =>
      "value" in e && "hadRecentInput" in e;
    const onShift = (entries: PerformanceEntryList) => {
      for (const e of entries) {
        if (isLayoutShift(e) && !e.hadRecentInput)
          out.shifts.push({ at: e.startTime, value: e.value });
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
  });
}

// セッションウィンドウ: 直前のずれから 1 秒を超えるか、最初のずれから 5 秒を超えたら次の窓にする
function sessionWindowCls(shifts: Shift[]): number {
  let max = 0;
  let sum = 0;
  let first = -Infinity;
  let prev = -Infinity;
  for (const s of [...shifts].sort((a, b) => a.at - b.at)) {
    if (s.at - prev > 1000 || s.at - first > 5000) {
      sum = 0;
      first = s.at;
    }
    sum += s.value;
    prev = s.at;
    max = Math.max(max, sum);
  }
  return max;
}

// 記録の environment。perf-stats.mjs が両側で突き合わせる
function environmentRecord(
  browser: Browser,
  run: {
    channel: string | null;
    headless: boolean;
    placement: "loopback" | "remote";
    contextOptions: Record<string, unknown>;
    use: Use;
  },
): Record<string, unknown> {
  const cpuList = cpus();
  return {
    browser_name: browser.browserType().name(),
    browser_version: browser.version(),
    channel: run.channel,
    headless: run.headless,
    target_placement: run.placement,
    context_options: contextFingerprint(run.contextOptions),
    launch_options: launchFingerprint(run.use.launchOptions),
    runner: {
      platform: platform(),
      arch: arch(),
      cpu_model: cpuList[0]?.model ?? null,
      cpu_count: cpuList.length > 0 ? cpuList.length : null,
    },
  };
}

// project の use のうち、コンテキストを作るときに渡す設定（Playwright の BrowserContextOptions。1.63 の types.d.ts で確かめた）。
// 出典: https://playwright.dev/docs/api/class-browser#browser-new-context
// 含めないのは 4 つだけである。viewport は組ごとに上書きする。recordHar・recordVideo は記録の負荷が値に入る。logger は値に関わらない
const CONTEXT_OPTION_KEYS = [
  "acceptDownloads",
  "baseURL",
  "bypassCSP",
  "clientCertificates",
  "colorScheme",
  "contrast",
  "deviceScaleFactor",
  "extraHTTPHeaders",
  "forcedColors",
  "geolocation",
  "hasTouch",
  "httpCredentials",
  "ignoreHTTPSErrors",
  "isMobile",
  "javaScriptEnabled",
  "locale",
  "offline",
  "permissions",
  "proxy",
  "reducedMotion",
  "screen",
  "serviceWorkers",
  "storageState",
  "strictSelectors",
  "timezoneId",
  "userAgent",
] as const;

function contextOptionsFromUse(
  use: Record<string, unknown> & { contextOptions?: object },
): Record<string, unknown> {
  const options: Record<string, unknown> = { ...use.contextOptions };
  for (const key of CONTEXT_OPTION_KEYS) {
    if (use[key] !== undefined) options[key] = use[key];
  }
  return options;
}

// 認証の情報を持ちうる設定は、秘密の値（パスワード・トークン・cookie の値・鍵）を残さず、
// ユーザー・行き先・名前のように、違えば別の内容や通信になる部分だけを残す
function redactedContextOption(key: string, value: unknown): unknown {
  switch (key) {
    case "extraHTTPHeaders":
      return Object.keys(objectOf(value, key))
        .map((name) => name.toLowerCase())
        .sort();
    case "httpCredentials": {
      const c = objectOf(value, key);
      return { username: c.username, origin: c.origin ?? null, send: c.send ?? null };
    }
    case "proxy": {
      const p = objectOf(value, key);
      return { server: p.server, bypass: p.bypass ?? null };
    }
    case "clientCertificates":
      return arrayOf(value, key)
        .map((c) => objectOf(c, key).origin)
        .sort(byText);
    case "storageState": {
      if (typeof value === "string") return { path: value };
      const state = objectOf(value, key);
      return {
        cookies: arrayOf(state.cookies ?? [], "storageState.cookies")
          .map((c) => objectOf(c, "storageState.cookies"))
          .map((c) => `${String(c.domain)}${String(c.path)} ${String(c.name)}`)
          .sort(),
        origins: arrayOf(state.origins ?? [], "storageState.origins")
          .map((o) => objectOf(o, "storageState.origins").origin)
          .sort(byText),
      };
    }
    default:
      return value;
  }
}

// 両側で一致を求めるコンテキストの設定。baseURL は target ごとに違うので除き、違いは target_placement で見る
function contextFingerprint(options: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(options).sort()) {
    if (key === "baseURL" || options[key] === undefined) continue;
    out[key] = redactedContextOption(key, options[key]);
  }
  return out;
}

// project の use.launchOptions（ブラウザの起動の設定）。args・executablePath などが違えば描画や負荷が変わる。
// args は値を伏せる。秘密を持ちうる env は、実行したシェルと値が違う変数（上書き）の名前だけを残す。
// `env: { ...process.env }` の形でシェルの変数をすべて渡しても、側ごとに違う変数で誤った違いにしない。
// proxy は server と bypass だけを残す
function launchFingerprint(options: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(options ?? {}).sort()) {
    const value = options?.[key];
    if (value === undefined || typeof value === "function") continue;
    if (key === "env")
      out[key] = Object.entries(objectOf(value, "launchOptions.env"))
        .filter(([name, v]) => process.env[name] !== v)
        .map(([name]) => name)
        .sort();
    else if (key === "proxy") out[key] = redactedContextOption("proxy", value);
    // 起動引数は秘密の値（トークンなど）を持ちうるが、どのフラグが持つかは一覧にできず、
    // 値は `--flag=value` の形でも、次の要素（`["--flag", "value"]`）でも渡せる。
    // `-` で始まる要素はフラグ名だけを残して `=value` を `=*` にし、それ以外の要素は値として `*` にする
    else if (key === "args")
      out[key] = arrayOf(value, "launchOptions.args").map((arg) => {
        if (typeof arg !== "string")
          throw new TypeError(`launchOptions.args の要素が文字列でない: ${String(arg)}`);
        if (!arg.startsWith("-")) return "*";
        return arg.includes("=") ? `${arg.slice(0, arg.indexOf("="))}=*` : arg;
      });
    else out[key] = value;
  }
  return out;
}

// 設定の値は Playwright の型が形を決めている。ここでは読む前に、object か配列であることだけを確かめる
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function objectOf(value: unknown, name: string): Record<string, unknown> {
  if (!isObjectLike(value)) throw new TypeError(`${name} が object でない: ${shapeOf(value)}`);
  return value;
}

// 文字列にした値の順（引数なしの sort と同じ順）。undefined は sort が比べずに末尾へ置く。
function byText(a: unknown, b: unknown): number {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function arrayOf(value: unknown, name: string): unknown[] {
  if (!isArray(value)) throw new TypeError(`${name} が配列でない: ${shapeOf(value)}`);
  return value;
}

// エラーメッセージに出す値の形。object を String で文字列にすると `[object Object]` になり、何が来たかが分からない。
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (isArray(value)) return `配列（${value.length} 件）`;
  if (typeof value === "object") return `object（欄: ${Object.keys(value).join(", ") || "なし"}）`;
  if (typeof value === "function") return `function ${value.name}`;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return `${typeof value} ${String(value)}`;
  }
  return typeof value;
}

// すべての頁が localhost・127.0.0.0/8・::1 を指せば loopback、1 つでも他を指せば remote
function targetPlacement(paths: string[], baseURL: string | undefined): "loopback" | "remote" {
  const loopback = (host: string) =>
    host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);
  return paths.every((path) => loopback(new URL(path, baseURL).hostname)) ? "loopback" : "remote";
}

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

// このファイルは利用者のプロジェクトへ 1 ファイルだけコピーして使うので、ユーティリティを import せずに同じ関数を持つ。
// is-array:begin
// `Array.isArray` は `arg is any[]` なので、`unknown` の値を絞ると `any[]` になり、要素を読む処理で型の検査が外れる。
// `isArray` は、入力が `unknown` か `any` なら `unknown[]` に絞る。入力の union の配列の部分（`number[] | undefined` の
// `number[]`、`readonly` の配列、タプル）はそのまま保ち、配列でない側は入力から配列の部分を除いた型にする。
// 配列を含みうる型（`object`・`{}`・`Iterable<string>`）は、その型と `unknown[]` の交差にする。

/** `T` のうち配列の部分。`unknown` と `any` は `unknown[]`、配列を含みうる型は `unknown[]` との交差にする。 */
type ArrayPart<T> = 0 extends 1 & T
  ? unknown[]
  : unknown extends T
    ? unknown[]
    : T extends readonly unknown[]
      ? T
      : never[] extends T
        ? T & unknown[]
        : never;

/**
 * 型ガードの述語に使う形。述語の型は引数の型に代入できる必要がある（TS2677）。条件型のままでは
 * tsc がそれを確かめられないので、代入できる場合だけ `ArrayPart<T>` にする（具体的な型では常に代入できる）。
 */
type ArrayNarrowed<T> = ArrayPart<T> extends T ? ArrayPart<T> : never;

/** 配列か。配列なら、入力の型の配列の部分に絞る。 */
function isArray<T>(value: T): value is ArrayNarrowed<T> {
  return Array.isArray(value);
}
// is-array:end
