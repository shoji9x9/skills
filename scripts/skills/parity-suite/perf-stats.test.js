// parity-suite の性能の集計と比較（perf-stats.mjs）の回帰テスト（Issue #569）。
//
// 起こりうる不具合は「回帰を通す」「判定できない入力を合格にする」「正しい入力を止める」の 3 つ。
// 落とす入力（回帰・ばらつき・値の欠け・環境の違い・古い基準・形の誤り）と同じ数だけ、通る入力（自分との比較・
// 改善・許容幅ちょうど・両側で LCP が無い頁・回数の違い・下限の上書き）を置く。
// main は子プロセスを起動せず、メモリ上のファイルで直接呼ぶ（ミューテーションテストの 1 変異あたりの時間を抑える）。

import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  DEFAULT_FLOORS,
  judgeMetric,
  main,
  quantile,
  summarizeValues,
} from "../../../skills/parity-suite/scripts/perf-stats.mjs";

const META = ".replace/parity/demo/metadata.json";
const CUR = ".replace/parity/demo/perf-samples.json";
const NEW = ".replace/parity/demo/new/local/perf-samples.json";
const DIFF = ".replace/parity/demo/new/local/diff-metadata.json";

const environment = () => ({
  browser_name: "chromium",
  browser_version: "153.0.8010.12",
  channel: null,
  headless: true,
  runner: { platform: "linux", arch: "x64", cpu_model: "cpu", cpu_count: 8 },
  target_placement: "loopback",
  context_options: { colorScheme: "light", locale: "ja-JP" },
  launch_options: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});
const settings = (runs = 5) => ({ runs, warmup: 1, settle_ms: 1000, cache: "cold", workers: 1 });

/**
 * 1 組ぶんの採取。`values` は指標ごとの値の列（長さ = 回数）。
 * @param {string} page
 * @param {string} viewport
 * @param {Record<string, (number|null)[]>} values
 */
function pairSamples(page, viewport, values) {
  const n = values.lcp.length;
  return Array.from({ length: n }, (_, i) => ({
    page,
    viewport,
    run: i + 1,
    lcp: values.lcp[i],
    cls: values.cls[i],
    tbt: values.tbt[i],
    ttfb: values.ttfb[i],
  }));
}

const steady = () => ({
  lcp: [500, 510, 520, 530, 540],
  cls: [0, 0, 0, 0, 0],
  tbt: [0, 0, 0, 0, 0],
  ttfb: [10, 10, 10, 10, 10],
});

function samplesDoc(side, pairs, overrides = {}) {
  const runs = pairs[0]?.values.lcp.length ?? 5;
  return {
    version: "1",
    side,
    slug: "demo",
    target: side === "new" ? "local" : null,
    measured_at: "2026-10-08T00:00:00.000Z",
    environment: environment(),
    settings: settings(runs),
    // 雛形が書く形と同じく、採ったときの組の定義を持たせる
    capture: captureOf(metadata().capture_conditions),
    samples: pairs.flatMap((p) => pairSamples(p.page, p.viewport, p.values)),
    ...overrides,
  };
}

/** capture_conditions から、採取ファイルの capture を作る。 */
function captureOf(cc) {
  return {
    pages: cc.pages.map((p) => ({ name: p.name, path: p.path })),
    viewports: cc.viewports.map((v) => ({ label: v.label, width: v.width, height: v.height })),
  };
}

const metadata = (extra = {}) => ({
  slug: "demo",
  mode: "feature",
  capture_conditions: {
    pages: [
      { name: "top", path: "" },
      { name: "list", path: "list" },
    ],
    viewports: [{ label: "desktop", width: 1280, height: 800 }],
  },
  ...extra,
});

const bothPairs = (values = steady) => [
  { page: "top", viewport: "desktop", values: values() },
  { page: "list", viewport: "desktop", values: values() },
];

/**
 * メモリ上のファイルで main を呼ぶ。
 * @param {Record<string, unknown>} files - パス → 値（文字列以外は JSON にする）
 * @param {string[]} argv
 */
function run(files, argv) {
  /** @type {Map<string, string>} */
  const fs = new Map(
    Object.entries(files).map(([p, v]) => [
      `/repo/${p}`,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
  let out = "";
  let err = "";
  const code = main(argv, {
    cwd: "/repo",
    readFile: (p) => {
      const v = fs.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeFile: (p, s) => fs.set(p, s),
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  const read = (p) => JSON.parse(/** @type {string} */ (fs.get(`/repo/${p}`)));
  return { code, out, err, read };
}

const summarizeArgs = ["summarize", "--metadata", META, "--samples", CUR, "--write"];

/** 現側を集計した metadata.json と、その採取の本文を返す。 */
function summarized(curDoc = samplesDoc("current", bothPairs()), floors = []) {
  const r = run({ [META]: metadata(), [CUR]: curDoc }, [...summarizeArgs, ...floors]);
  expect(r.code).toBe(0);
  return { meta: r.read(META), curText: JSON.stringify(curDoc) };
}

function compareRun(newDoc, opts = {}) {
  const { meta, curText } = opts.base ?? summarized();
  const files = { [META]: opts.meta ?? meta, [NEW]: newDoc, [DIFF]: {} };
  if (!opts.dropCurrent) files[CUR] = opts.curText ?? curText;
  return run(files, [
    "compare",
    "--metadata",
    META,
    "--samples",
    NEW,
    "--target",
    "local",
    "--write",
    DIFF,
  ]);
}

describe("集計の部品", () => {
  test("分位数は線形補間で求める", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.75)).toBe(10);
  });

  test("null の回を数え、値の無い指標は統計を null にする", () => {
    expect(summarizeValues([null, null])).toEqual({
      n: 2,
      nulls: 2,
      median: null,
      p25: null,
      p75: null,
      iqr: null,
      min: null,
      max: null,
    });
    const s = summarizeValues([4, 1, 3, 2, 5]);
    expect(s).toMatchObject({ n: 5, nulls: 0, median: 3, p25: 2, p75: 4, iqr: 2, min: 1, max: 5 });
  });

  test("重いページでは、現側の中央値に対する割合が許容幅を広げる", () => {
    // LCP 1,000ms・四分位範囲 0 のページで、割合 0.2 なら許容幅は 200ms（絶対の下限 100ms より大きい）
    const cur = summarizeValues([1000, 1000, 1000, 1000, 1000]);
    const at = (ms) => judgeMetric(cur, summarizeValues([ms, ms, ms, ms, ms]), 100, 0.2);
    expect(at(1150)).toMatchObject({ status: "within_noise", tolerance: 200 });
    expect(at(1200).status).toBe("within_noise");
    expect(at(1201).status).toBe("regressed");
    // 軽いページでは絶対の下限が使われる
    const light = summarizeValues([20, 20, 20, 20, 20]);
    expect(judgeMetric(light, summarizeValues([110, 110, 110, 110, 110]), 100, 0.2).tolerance).toBe(
      100,
    );
  });

  test("許容幅は四分位範囲と下限の大きい方で、ちょうどは回帰にしない", () => {
    const cur = summarizeValues([100, 100, 100, 100, 100]);
    expect(judgeMetric(cur, summarizeValues([150, 150, 150, 150, 150]), 50).status).toBe(
      "within_noise",
    );
    expect(judgeMetric(cur, summarizeValues([151, 151, 151, 151, 151]), 50).status).toBe(
      "regressed",
    );
    const wide = summarizeValues([0, 100, 200, 300, 400]); // iqr 200
    expect(judgeMetric(wide, summarizeValues([380, 380, 380, 380, 380]), 50).status).toBe(
      "within_noise",
    );
  });
});

describe("summarize", () => {
  test("組がそろった採取を metadata.json の performance に書く", () => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, summarizeArgs);
    expect(r.code).toBe(0);
    const perf = r.read(META).performance;
    expect(perf.declared).toBe(true);
    expect(perf.samples).toBe(CUR);
    expect(perf.floors).toEqual(DEFAULT_FLOORS);
    expect(perf.pairs.map((p) => `${p.page}|${p.viewport}`)).toEqual([
      "top|desktop",
      "list|desktop",
    ]);
    expect(perf.pairs[0].metrics.lcp.median).toBe(520);
    expect(perf.samples_sha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(samplesDoc("current", bothPairs())))
        .digest("hex"),
    );
  });

  test("--write が無ければ metadata.json を書き換えない", () => {
    const r = run(
      { [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) },
      summarizeArgs.slice(0, -1),
    );
    expect(r.code).toBe(0);
    expect(r.read(META).performance).toBeUndefined();
  });

  test("割合の下限のデフォルトを記録し、--relative-floor で上書きできる", () => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, [
      ...summarizeArgs,
      "--relative-floor",
      "lcp=0.3",
    ]);
    expect(r.code).toBe(0);
    expect(r.read(META).performance.relative_floors).toEqual({
      lcp: 0.3,
      cls: 0,
      tbt: 0.2,
      ttfb: 0.2,
    });
  });

  test("--relative-floor の値が負なら exit 2", () => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, [
      ...summarizeArgs,
      "--relative-floor",
      "lcp=-0.1",
    ]);
    expect(r.code).toBe(2);
  });

  test("--floor で下限を上書きし、記録に残す", () => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, [
      ...summarizeArgs,
      "--floor",
      "lcp=150",
    ]);
    expect(r.code).toBe(0);
    expect(r.read(META).performance.floors.lcp).toBe(150);
  });

  test.each([
    ["指標でない", "fid=1"],
    ["負の値", "lcp=-1"],
    ["数でない", "lcp=abc"],
  ])("--floor の形が違えば exit 2: %s", (_, spec) => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, [
      ...summarizeArgs,
      "--floor",
      spec,
    ]);
    expect(r.code).toBe(2);
  });

  test("採っていない組があれば書かずに exit 1", () => {
    const r = run(
      { [META]: metadata(), [CUR]: samplesDoc("current", bothPairs().slice(0, 1)) },
      summarizeArgs,
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("list|desktop");
    expect(r.read(META).performance).toBeUndefined();
  });

  test("capture_conditions に無い組があれば exit 1", () => {
    const pairs = [...bothPairs(), { page: "extra", viewport: "desktop", values: steady() }];
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", pairs) }, summarizeArgs);
    expect(r.code).toBe(1);
    expect(r.err).toContain("extra|desktop");
  });

  test.each([
    ["feature でない mode", { [META]: metadata({ mode: "api-resource" }) }],
    ["side が new", { [CUR]: samplesDoc("new", bothPairs()) }],
    ["slug が違う", { [CUR]: samplesDoc("current", bothPairs(), { slug: "other" }) }],
    ["version が違う", { [CUR]: samplesDoc("current", bothPairs(), { version: "0" }) }],
    [
      "回数が下限より少ない",
      {
        [CUR]: samplesDoc(
          "current",
          bothPairs(() => ({
            lcp: [1, 2, 3, 4],
            cls: [0, 0, 0, 0],
            tbt: [0, 0, 0, 0],
            ttfb: [1, 1, 1, 1],
          })),
        ),
      },
    ],
    [
      "並列で採った",
      { [CUR]: samplesDoc("current", bothPairs(), { settings: { ...settings(), workers: 2 } }) },
    ],
    [
      "settle_ms が無い",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          settings: { runs: 5, warmup: 1, cache: "cold", workers: 1 },
        }),
      },
    ],
    [
      "ブラウザの版が null",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), browser_version: null },
        }),
      },
    ],
    [
      "CPU の数が null",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), runner: { ...environment().runner, cpu_count: null } },
        }),
      },
    ],
    [
      "ブラウザの版が文字列でない",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), browser_version: { major: 153 } },
        }),
      },
    ],
    [
      "CPU の数が整数でない",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), runner: { ...environment().runner, cpu_count: "8" } },
        }),
      },
    ],
    [
      "channel が空の文字列",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), channel: "" },
        }),
      },
    ],
    [
      "置き場所が決まった値でない",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), target_placement: "lan" },
        }),
      },
    ],
    [
      "起動の設定が無い",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), launch_options: undefined },
        }),
      },
    ],
    [
      "コンテキストの設定がオブジェクトでない",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), context_options: ["ja-JP"] },
        }),
      },
    ],
    [
      "headless が真偽値でない",
      {
        [CUR]: samplesDoc("current", bothPairs(), {
          environment: { ...environment(), headless: "true" },
        }),
      },
    ],
    ["samples が空", { [CUR]: samplesDoc("current", [], { settings: settings() }) }],
    [
      "現側の採取に target がある",
      { [CUR]: samplesDoc("current", bothPairs(), { target: "local" }) },
    ],
    ["JSON でない", { [CUR]: "{" }],
    [
      "metadata.json の pages の name が重複",
      {
        [META]: metadata({
          capture_conditions: {
            ...metadata().capture_conditions,
            pages: [
              { name: "top", path: "" },
              { name: "top", path: "x" },
            ],
          },
        }),
      },
    ],
    [
      "metadata.json の page に区切り文字",
      {
        [META]: metadata({
          capture_conditions: {
            ...metadata().capture_conditions,
            pages: [{ name: "a|b", path: "" }],
          },
        }),
      },
    ],
  ])("入力の形が違えば exit 2: %s", (_, override) => {
    // metadata.json だけを変えた入力では、採取の capture をその定義に合わせ、狙った検査より前の capture の照合で止めない
    const meta = override[META] ?? metadata();
    const cur =
      override[CUR] ??
      samplesDoc("current", bothPairs(), { capture: captureOf(meta.capture_conditions) });
    const r = run({ ...override, [META]: meta, [CUR]: cur }, summarizeArgs);
    expect(r.code).toBe(2);
  });

  test.each([
    ["絶対パス", "/repo/.replace/parity/demo/perf-samples.json"],
    ["外へ出るパス", "x/../.replace/parity/demo/perf-samples.json"],
  ])("--samples がルートからの相対パスでなければ exit 2: %s", (_, path) => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, [
      "summarize",
      "--metadata",
      META,
      "--samples",
      path,
      "--write",
    ]);
    expect(r.code).toBe(2);
    expect(r.read(META).performance).toBeUndefined();
  });

  test.each([
    ["path が違う", (c) => ({ ...c, pages: [{ name: "top", path: "old" }, c.pages[1]] })],
    ["capture が無い", () => undefined],
  ])("採取の capture が今の定義と違えば書かずに exit 2: %s", (_, change) => {
    const doc = samplesDoc("current", bothPairs());
    doc.capture = change(doc.capture);
    const r = run({ [META]: metadata(), [CUR]: doc }, summarizeArgs);
    expect(r.code).toBe(2);
    expect(r.read(META).performance).toBeUndefined();
  });

  test("channel の null（指定なし）は受ける", () => {
    const r = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, summarizeArgs);
    expect(r.code).toBe(0);
    expect(r.read(META).performance.environment.channel).toBeNull();
  });

  test("同じ組で run が重複すれば exit 2", () => {
    // 回数（重複を除いた run の数）は settings.runs と合わせ、重複の判定だけに届く形にする
    const doc = samplesDoc("current", bothPairs());
    doc.samples.push({ ...doc.samples[0] });
    const r = run({ [META]: metadata(), [CUR]: doc }, summarizeArgs);
    expect(r.code).toBe(2);
  });

  test.each([
    ["ウォームアップが 0", { warmup: 0 }],
    ["ウォームアップが 2", { warmup: 2 }],
    ["待つ時間が数でない", { settle_ms: "x" }],
    ["キャッシュが cold でない", { cache: "warm" }],
  ])("測り方の値が取り決めと違えば exit 2: %s", (_, override) => {
    const r = run(
      {
        [META]: metadata(),
        [CUR]: samplesDoc("current", bothPairs(), { settings: { ...settings(), ...override } }),
      },
      summarizeArgs,
    );
    expect(r.code).toBe(2);
  });

  test("run が 1 から settings.runs までの連番でなければ exit 2", () => {
    // 回数と重複だけでは、欠けた回を別の番号で埋めた採取（1〜4 と 6）を通してしまう
    const doc = samplesDoc("current", bothPairs());
    doc.samples[4].run = 6;
    const r = run({ [META]: metadata(), [CUR]: doc }, summarizeArgs);
    expect(r.code).toBe(2);
    expect(r.err).toContain("settings.runs までの整数でない");
  });

  test("組の回数が settings.runs と違えば exit 2", () => {
    const r = run(
      { [META]: metadata(), [CUR]: samplesDoc("current", bothPairs(), { settings: settings(6) }) },
      summarizeArgs,
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("settings.runs 6");
  });

  test("LCP の null は受け、他の指標の null は exit 2", () => {
    const lcpNull = samplesDoc("current", bothPairs());
    lcpNull.samples[0].lcp = null;
    expect(run({ [META]: metadata(), [CUR]: lcpNull }, summarizeArgs).code).toBe(0);
    const clsNull = samplesDoc("current", bothPairs());
    clsNull.samples[0].cls = null;
    expect(run({ [META]: metadata(), [CUR]: clsNull }, summarizeArgs).code).toBe(2);
    const negative = samplesDoc("current", bothPairs());
    negative.samples[0].tbt = -1;
    expect(run({ [META]: metadata(), [CUR]: negative }, summarizeArgs).code).toBe(2);
  });

  test("同梱のテンプレートのプレースホルダの metadata.json は exit 2", () => {
    const r = run(
      {
        [META]: {
          slug: "<slug>",
          mode: "<feature>",
          capture_conditions: { pages: [], viewports: [] },
        },
        [CUR]: samplesDoc("current", bothPairs()),
      },
      summarizeArgs,
    );
    expect(r.code).toBe(2);
  });
});

describe("compare", () => {
  test("同じ分布なら exit 0 で、diff-metadata.json に結果を書く", () => {
    const r = compareRun(samplesDoc("new", bothPairs()));
    expect(r.code).toBe(0);
    const perf = r.read(DIFF).performance;
    expect(perf.judged).toBe(true);
    expect(perf.ok).toBe(true);
    expect(perf.counts).toEqual({ within_noise: 8 });
    expect(perf.new_samples).toBe(NEW);
  });

  test("許容幅を超えた悪化は regressed で exit 1", () => {
    const slow = () => ({ ...steady(), tbt: [300, 300, 300, 300, 300] });
    const r = compareRun(samplesDoc("new", bothPairs(slow)));
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.regressed.map((x) => `${x.page}:${x.metric}`)).toEqual(["top:tbt", "list:tbt"]);
  });

  test("デフォルトの下限なら loosened_floors は空で、警告を出さない", () => {
    const r = compareRun(samplesDoc("new", bothPairs()));
    expect(r.code).toBe(0);
    const perf = r.read(DIFF).performance;
    expect(perf.loosened_floors).toEqual([]);
    expect(perf.floors).toEqual({ lcp: 100, cls: 0.01, tbt: 50, ttfb: 50 });
    expect(r.err).not.toContain("warning");
  });

  test("デフォルトより緩い下限は、判定を変えずに loosened_floors と警告に出す", () => {
    const base = summarized(samplesDoc("current", bothPairs()), [
      "--floor",
      "lcp=300",
      "--floor",
      "cls=0.005",
      "--relative-floor",
      "tbt=0.5",
    ]);
    const r = compareRun(samplesDoc("new", bothPairs()), { base });
    expect(r.code).toBe(0);
    // 厳しくした CLS は挙げない
    expect(r.read(DIFF).performance.loosened_floors).toEqual([
      { metric: "lcp", kind: "floors", value: 300, default: 100 },
      { metric: "tbt", kind: "relative_floors", value: 0.5, default: 0.2 },
    ]);
    expect(r.err).toContain("warning: デフォルトより緩い下限で判定した");
    expect(r.err).toContain("floors.lcp=300（デフォルト 100）");
  });

  test("compare は記録した割合の下限で判定する", () => {
    // 現側 LCP の中央値 520ms。割合 0.5 なら許容幅 260ms で、+250ms は許容幅の中
    const r0 = run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, [
      ...summarizeArgs,
      "--relative-floor",
      "lcp=0.5",
    ]);
    const base = {
      meta: r0.read(META),
      curText: JSON.stringify(samplesDoc("current", bothPairs())),
    };
    const slower = () => ({ ...steady(), lcp: [750, 760, 770, 780, 790] });
    expect(compareRun(samplesDoc("new", bothPairs(slower)), { base }).code).toBe(0);
    expect(compareRun(samplesDoc("new", bothPairs(slower))).code).toBe(1);
  });

  test("改善は合格として数える", () => {
    const fast = () => ({ ...steady(), lcp: [100, 100, 100, 100, 100] });
    const r = compareRun(samplesDoc("new", bothPairs(fast)));
    expect(r.code).toBe(0);
    expect(r.read(DIFF).performance.counts.improved).toBe(2);
  });

  test("新側のばらつきが許容幅を超えれば noisy で exit 1", () => {
    const noisy = () => ({ ...steady(), lcp: [300, 400, 520, 640, 740] }); // iqr 240 > 100
    const r = compareRun(samplesDoc("new", bothPairs(noisy)));
    expect(r.code).toBe(1);
    expect(r.read(DIFF).performance.counts.noisy).toBe(2);
  });

  test("両側で LCP が無い頁は not_applicable で合格", () => {
    const noLcp = () => ({ ...steady(), lcp: [null, null, null, null, null] });
    const base = summarized(samplesDoc("current", bothPairs(noLcp)));
    const r = compareRun(samplesDoc("new", bothPairs(noLcp)), { base });
    expect(r.code).toBe(0);
    expect(r.read(DIFF).performance.counts.not_applicable).toBe(2);
  });

  test("片側だけ LCP が無ければ missing で exit 1", () => {
    const noLcp = () => ({ ...steady(), lcp: [null, null, null, null, null] });
    const r = compareRun(samplesDoc("new", bothPairs(noLcp)));
    expect(r.code).toBe(1);
    expect(r.read(DIFF).performance.counts.missing).toBe(2);
  });

  test("新側に組が無ければ missing で exit 1", () => {
    const r = compareRun(samplesDoc("new", bothPairs().slice(0, 1)));
    expect(r.code).toBe(1);
    expect(r.read(DIFF).performance.counts.missing).toBe(4);
  });

  test("現側に無い組があれば exit 1", () => {
    const pairs = [...bothPairs(), { page: "extra", viewport: "desktop", values: steady() }];
    const r = compareRun(samplesDoc("new", pairs));
    expect(r.code).toBe(1);
    expect(r.read(DIFF).performance.extra_pairs).toEqual(["extra|desktop"]);
  });

  test.each([
    ["ブラウザの版", { environment: { ...environment(), browser_version: "154.0" } }],
    ["channel", { environment: { ...environment(), channel: "chrome" } }],
    [
      "CPU",
      {
        environment: { ...environment(), runner: { ...environment().runner, cpu_model: "other" } },
      },
    ],
    ["置き場所", { environment: { ...environment(), target_placement: "remote" } }],
    [
      "コンテキストの設定",
      {
        environment: {
          ...environment(),
          context_options: { colorScheme: "light", locale: "en-US" },
        },
      },
    ],
    [
      "起動の設定",
      { environment: { ...environment(), launch_options: { args: ["--disable-gpu"] } } },
    ],
    ["待つ時間", { settings: { ...settings(), settle_ms: 2000 } }],
  ])("環境・測り方が違えば env_mismatch で exit 1: %s", (_, override) => {
    const r = compareRun(samplesDoc("new", bothPairs(), override));
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.environment_differences.length).toBe(1);
    expect(perf.counts).toEqual({ env_mismatch: 8 });
  });

  test("コンテキストの設定はキーの順序だけが違っても一致として扱う", () => {
    const reordered = {
      environment: { ...environment(), context_options: { locale: "ja-JP", colorScheme: "light" } },
    };
    const r = compareRun(samplesDoc("new", bothPairs(), reordered));
    expect(r.code).toBe(0);
    expect(r.read(DIFF).performance.environment_differences).toEqual([]);
  });

  test("回数は両側が下限以上なら違ってよい", () => {
    const ten = () => ({
      lcp: [500, 510, 520, 530, 540, 500, 510, 520, 530, 540],
      cls: Array(10).fill(0),
      tbt: Array(10).fill(0),
      ttfb: Array(10).fill(10),
    });
    const r = compareRun(samplesDoc("new", bothPairs(ten)));
    expect(r.code).toBe(0);
  });

  test("現側の採取が集計の後に変わっていれば、組 × 指標を判定せず exit 1", () => {
    // 新側は回帰する値にする。古い基準と比べた regressed を出さないことを確かめる
    const slow = () => ({
      lcp: [5000, 5010, 5020, 5030, 5040],
      cls: Array(5).fill(0),
      tbt: Array(5).fill(0),
      ttfb: Array(5).fill(10),
    });
    const r = compareRun(samplesDoc("new", bothPairs(slow)), {
      curText: JSON.stringify(samplesDoc("current", bothPairs(), { measured_at: "x" })),
    });
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.stale_baseline).toBe(true);
    expect(perf.regressed).toEqual([]);
    expect(perf.counts).toEqual({ stale_baseline: 8 });
  });

  test("現側の採取の整形と改行コードが変わっただけなら古い基準にしない", () => {
    const curDoc = samplesDoc("current", bothPairs());
    const base = summarized(curDoc);
    const reformatted = JSON.stringify(curDoc, null, 2).replaceAll("\n", "\r\n");
    const r = compareRun(samplesDoc("new", bothPairs()), { base, curText: reformatted });
    expect(r.code).toBe(0);
  });

  test("diff-metadata.json が無くても、比べた結果を出力してから exit 2", () => {
    const { meta, curText } = summarized();
    const r = run({ [META]: meta, [CUR]: curText, [NEW]: samplesDoc("new", bothPairs()) }, [
      "compare",
      "--metadata",
      META,
      "--samples",
      NEW,
      "--target",
      "local",
      "--write",
      DIFF,
    ]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).ok).toBe(true);
  });

  test("現側の採取を読めなければ exit 1", () => {
    const r = compareRun(samplesDoc("new", bothPairs()), { dropCurrent: true });
    expect(r.code).toBe(1);
    expect(r.read(DIFF).performance.stale_baseline).toBe(true);
  });

  test.each([
    ["performance が無い", (m) => ({ ...m, performance: undefined })],
    ["declared が false", (m) => ({ ...m, performance: { declared: false, reason: "cdp" } })],
    [
      "組が重複する",
      (m) => ({
        ...m,
        performance: { ...m.performance, pairs: [m.performance.pairs[0], m.performance.pairs[0]] },
      }),
    ],
    [
      "中央値が数でない",
      (m) => {
        const pairs = structuredClone(m.performance.pairs);
        pairs[0].metrics.lcp.median = "<中央値>";
        return { ...m, performance: { ...m.performance, pairs } };
      },
    ],
    ["下限が無い", (m) => ({ ...m, performance: { ...m.performance, floors: { lcp: 100 } } })],
    [
      "採取の sha256 が無い",
      (m) => ({ ...m, performance: { ...m.performance, samples_sha256: "<sha256>" } }),
    ],
  ])("基準の形が違えば exit 2: %s", (_, mutate) => {
    const base = summarized();
    const r = compareRun(samplesDoc("new", bothPairs()), { base, meta: mutate(base.meta) });
    expect(r.code).toBe(2);
  });

  test("割合の下限が無い基準は、summarize の通し直しを求めて exit 2", () => {
    const base = summarized();
    const meta = {
      ...base.meta,
      performance: { ...base.meta.performance, relative_floors: undefined },
    };
    const r = compareRun(samplesDoc("new", bothPairs()), { base, meta });
    expect(r.code).toBe(2);
    expect(r.err).toContain("performance.relative_floors が無い");
  });

  test("基準の tool_version が今の版と違えば exit 2", () => {
    const base = summarized();
    const meta = { ...base.meta, performance: { ...base.meta.performance, tool_version: "0" } };
    const r = compareRun(samplesDoc("new", bothPairs()), { base, meta });
    expect(r.code).toBe(2);
    expect(r.err).toContain("tool_version");
  });

  test.each([
    [
      "ビューポートを足した",
      (cc) => ({
        ...cc,
        viewports: [...cc.viewports, { label: "mobile", width: 390, height: 844 }],
      }),
    ],
    [
      "ページの path を変えた",
      (cc) => ({ ...cc, pages: [{ name: "top", path: "home" }, cc.pages[1]] }),
    ],
  ])("基準を採った後に組の定義が変われば、判定せず exit 1: %s", (_, change) => {
    const base = summarized();
    const cc = change(base.meta.capture_conditions);
    const meta = { ...base.meta, capture_conditions: cc };
    const slow = () => ({ ...steady(), tbt: [300, 300, 300, 300, 300] });
    // 新側は変えた後の定義で採っている（雛形が採るときの metadata.json を読む）
    const r = compareRun(samplesDoc("new", bothPairs(slow), { capture: captureOf(cc) }), {
      base,
      meta,
    });
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.stale_capture).toBe(true);
    expect(perf.regressed).toEqual([]);
  });

  test("基準に組の定義が無ければ exit 2", () => {
    const base = summarized();
    const meta = { ...base.meta, performance: { ...base.meta.performance, capture: undefined } };
    const r = compareRun(samplesDoc("new", bothPairs()), { base, meta });
    expect(r.code).toBe(2);
    expect(r.err).toContain("performance.capture が無い");
  });

  test.each([
    ["別の target の採取", { target: "staging" }],
    ["target が無い採取", { target: null }],
  ])("新側の採取の target が --target と違えば exit 2: %s", (_, override) => {
    const r = compareRun(samplesDoc("new", bothPairs(), override));
    expect(r.code).toBe(2);
    expect(r.err).toContain("採取の target");
  });

  test("--target を渡さなければ exit 2", () => {
    const { meta, curText } = summarized();
    const r = run(
      { [META]: meta, [CUR]: curText, [NEW]: samplesDoc("new", bothPairs()), [DIFF]: {} },
      ["compare", "--metadata", META, "--samples", NEW],
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("比べる新側の target が無い");
  });

  test.each([
    ["回数が下限より少ない", { n: 1, nulls: 1 }],
    ["nulls が負", { nulls: -1 }],
    ["nulls が n を超える", { nulls: 6 }],
  ])("基準の回数が範囲外なら exit 2: %s", (_, override) => {
    const base = summarized();
    const pairs = structuredClone(base.meta.performance.pairs);
    pairs[0].metrics.lcp = { ...pairs[0].metrics.lcp, ...override };
    const meta = { ...base.meta, performance: { ...base.meta.performance, pairs } };
    const r = compareRun(samplesDoc("new", bothPairs()), { base, meta });
    expect(r.code).toBe(2);
    expect(r.err).toContain("回数が範囲外");
  });

  test.each([
    ["中央値が負", { median: -1 }],
    ["四分位範囲が負", { iqr: -1 }],
    ["すべて null の組に数がある", { nulls: 5, median: 520, iqr: 20 }],
  ])("基準の median / iqr が回数と合わなければ exit 2: %s", (_, override) => {
    const base = summarized();
    const pairs = structuredClone(base.meta.performance.pairs);
    pairs[0].metrics.lcp = { ...pairs[0].metrics.lcp, ...override };
    const meta = { ...base.meta, performance: { ...base.meta.performance, pairs } };
    const r = compareRun(samplesDoc("new", bothPairs()), { base, meta });
    expect(r.code).toBe(2);
    expect(r.err).toContain("median / iqr が回数と合わない");
  });

  test("基準の統計を手で書き換えていれば、判定せず exit 1", () => {
    // 採取ファイルと sha256 はそのままで、現側の TBT の中央値だけを大きくして新側の遅れを隠す
    const base = summarized();
    const pairs = structuredClone(base.meta.performance.pairs);
    pairs[0].metrics.tbt = { ...pairs[0].metrics.tbt, median: 300 };
    const meta = { ...base.meta, performance: { ...base.meta.performance, pairs } };
    const slow = () => ({ ...steady(), tbt: [300, 300, 300, 300, 300] });
    const r = compareRun(samplesDoc("new", bothPairs(slow)), { base, meta });
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.stale_summary).toBe(true);
    expect(perf.regressed).toEqual([]);
  });

  test.each([
    ["ブラウザの版", { environment: { ...environment(), browser_version: "154.0" } }],
    ["待つ時間", { settings: { ...settings(), settle_ms: 2000 } }],
  ])("基準の環境・測り方を新側に合わせて書き換えていれば、判定せず exit 1: %s", (_, changed) => {
    // 現側の採取と sha256 はそのままで、performance の環境・測り方だけを新側の値に書き換えて env_mismatch を避ける
    const base = summarized();
    const meta = { ...base.meta, performance: { ...base.meta.performance, ...changed } };
    const slow = () => ({ ...steady(), tbt: [300, 300, 300, 300, 300] });
    const r = compareRun(samplesDoc("new", bothPairs(slow), changed), { base, meta });
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.stale_summary).toBe(true);
    expect(perf.regressed).toEqual([]);
  });

  test("組の定義だけを書き換え、古い現側の採取を残していれば、判定せず exit 1", () => {
    // capture_conditions と performance.capture を新しい寸法に揃えても、現側の採取は古い寸法で採ったもの
    const base = summarized();
    const cc = {
      ...metadata().capture_conditions,
      viewports: metadata().capture_conditions.viewports.map((v) => ({ ...v, width: v.width + 1 })),
    };
    const meta = {
      ...base.meta,
      capture_conditions: cc,
      performance: { ...base.meta.performance, capture: captureOf(cc) },
    };
    const slow = () => ({ ...steady(), tbt: [300, 300, 300, 300, 300] });
    const r = compareRun(samplesDoc("new", bothPairs(slow), { capture: captureOf(cc) }), {
      base,
      meta,
    });
    expect(r.code).toBe(1);
    const perf = r.read(DIFF).performance;
    expect(perf.stale_capture).toBe(false);
    expect(perf.stale_summary).toBe(true);
    expect(perf.regressed).toEqual([]);
  });

  test.each([["/etc/perf-samples.json"], ["../other/perf-samples.json"]])(
    "基準の samples がリポジトリのルートからの相対パスでなければ exit 2: %s",
    (path) => {
      const base = summarized();
      const meta = { ...base.meta, performance: { ...base.meta.performance, samples: path } };
      const r = compareRun(samplesDoc("new", bothPairs()), { base, meta });
      expect(r.code).toBe(2);
      expect(r.err).toContain("performance.samples がリポジトリのルートからの相対パスでない");
    },
  );

  test("新側の採取の capture が今の定義と違えば exit 2", () => {
    const changed = {
      ...captureOf(metadata().capture_conditions),
      viewports: [{ label: "desktop", width: 1024, height: 768 }],
    };
    const r = compareRun(samplesDoc("new", bothPairs(), { capture: changed }));
    expect(r.code).toBe(2);
    expect(r.err).toContain("新側の採取の capture");
  });

  test("新側の採取の side が current なら exit 2", () => {
    const r = compareRun(samplesDoc("current", bothPairs()));
    expect(r.code).toBe(2);
  });
});

describe("引数", () => {
  test.each([
    [[]],
    [["unknown"]],
    [["summarize", "--metadata", META]],
    [["summarize", "--metadata", META, "--metadata", META, "--samples", CUR]],
    [["compare", "--metadata", META, "--samples", NEW, "--floor", "lcp=1"]],
  ])("使い方の誤りは exit 2: %j", (argv) => {
    expect(run({ [META]: metadata(), [CUR]: samplesDoc("current", bothPairs()) }, argv).code).toBe(
      2,
    );
  });
});
