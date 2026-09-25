// parity-suite の寸法の決まり方の当てはめ・照合（dimension-fit.mjs）の回帰テスト（Issue #367）。
//
// 撮影条件が 1 ビューポートだと、その 1 点の実測 px を並べた新側が画素・特性照合・aria の 3 経路すべてで緑になる。
// 現側で窓を変えて式を読み、新側を同じ窓で照合すれば、この版組を落とせることを固定する。
//
// 陽性コントロール（式で写した新側が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, fitPlane } from "../skills/parity-suite/scripts/dimension-fit.mjs";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/dimension-fit.mjs");

/** 幅と高さを独立に動かした 4 窓（撮影ビューポート 1366×768 を含む）。 */
const WINDOWS = [
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1280, height: 1024 },
  { width: 1920, height: 800 },
];

/** 移行元の式: 操作ボタンは器（幅 W − 40 の 50%）＋ 12、グリッドの高さは H − 132。 */
const formula = (w) => ({
  button: { x: 0.5 * (w.width - 40) + 12, y: 64, width: 96, height: 32 },
  grid: { x: 20, y: 120, width: w.width - 40, height: w.height - 132 },
});

/** 1366×768 の実測 px をそのまま並べた版組（新側の失敗形）。 */
const pinned = () => formula(WINDOWS[0]);

/**
 * @param {(w: {width:number,height:number}) => Record<string, Record<string, number> | null>} layout
 * @param {{width:number,height:number}[]} [windows]
 */
const samplesOf = (layout, windows = WINDOWS) => ({
  windows,
  elements: ["button", "grid"].map((element) => ({
    page: "list",
    element,
    rects: windows.map((w) => ({ window: w, rect: layout(w)[element] })),
  })),
});

const metadataOf = (viewports = [{ width: 1366, height: 768, label: "desktop" }]) => ({
  slug: "order-list",
  capture_conditions: { viewports, pages: [{ name: "list", path: "/orders" }] },
  traits: { elements: ["button", "grid"] },
});

/** メモリ上のファイルで main を回す。 */
function run(argv, files) {
  // check が読む現側 samples は、明示しなければ直近の fittedMetadata が当てはめたもの
  const fs = new Map(
    Object.entries({ "/w/s.json": currentSamplesText, ...files }).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
  let stdout = "";
  let stderr = "";
  const ow = process.stdout.write;
  const ew = process.stderr.write;
  process.stdout.write = (s) => ((stdout += s), true);
  process.stderr.write = (s) => ((stderr += s), true);
  let code;
  try {
    code = main(argv, {
      cwd: "/w",
      readFile: (p) => {
        if (!fs.has(p)) throw new Error(`ENOENT ${p}`);
        return fs.get(p);
      },
      writeFile: (p, s) => fs.set(p, s),
    });
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
  return {
    code,
    stdout,
    stderr,
    json: stdout ? JSON.parse(stdout) : null,
    file: (p) => JSON.parse(fs.get(p)),
  };
}

/** 現側で fit して dimension_model を書いた metadata.json を返す。 */
/** 直近の fittedMetadata が当てはめに使った現側 samples の本文（check の --current-samples に渡す。指紋が一致する） */
let currentSamplesText = "";

function fittedMetadata(layout = formula) {
  currentSamplesText = JSON.stringify(samplesOf(layout));
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json", "--write"], {
    "/w/s.json": currentSamplesText,
    "/w/m.json": metadataOf(),
  });
  expect(r.code).toBe(0);
  return r.file("/w/m.json");
}

test("fitPlane は幅と高さへの追従を分けて読む", () => {
  const f = fitPlane(
    WINDOWS.map((w) => ({ W: w.width, H: w.height, v: 0.25 * w.width - w.height + 7 })),
  );
  expect(f.ratio.width).toBeCloseTo(0.25, 9);
  expect(f.ratio.height).toBeCloseTo(-1, 9);
  expect(f.offset).toBeCloseTo(7, 6);
  expect(f.residual).toBeLessThan(1e-6);
});

test("fit: 式で決まる要素は fits に割合と定数を残す（陽性コントロール）", () => {
  const dm = fittedMetadata().capture_conditions.dimension_model;
  expect(dm.status).toBe("measured");
  expect(dm.measured_at).toEqual(WINDOWS);
  const buttonX = dm.fits.find((f) => f.element === "button" && f.property === "x");
  expect(buttonX.ratio).toEqual({ width: 0.5, height: 0 });
  expect(buttonX.offset).toBe(-8);
  const gridH = dm.fits.find((f) => f.element === "grid" && f.property === "height");
  expect(gridH.ratio).toEqual({ width: 0, height: 1 });
  expect(gridH.offset).toBe(-132);
  expect(dm.unfit).toEqual([]);
});

test("fit: ブレークポイントをまたぐ・一部の窓で表示されない軸は unfit（式が読めない）に残す", () => {
  const layout = (w) => ({
    button: { ...formula(w).button, x: w.width >= 1500 ? 800 : 400 },
    grid: w.width === 1280 ? null : formula(w).grid,
  });
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(layout),
    "/w/m.json": metadataOf(),
  });
  expect(r.code).toBe(0);
  const { unfit } = r.json.dimension_model;
  expect(unfit).toContainEqual(
    expect.objectContaining({
      element: "button",
      property: "x",
      reason: "residual_exceeds_tolerance",
    }),
  );
  expect(unfit.filter((u) => u.element === "grid")).toHaveLength(4);
  expect(unfit.find((u) => u.element === "grid").reason).toBe("hidden_in_windows: 1280x1024");
});

test.each([
  ["3 窓しかない", { "/w/s.json": samplesOf(formula, WINDOWS.slice(0, 3)) }, /4 窓以上/],
  [
    "撮影ビューポートを含まない",
    { "/w/s.json": samplesOf(formula, WINDOWS.slice(1).concat([{ width: 1440, height: 700 }])) },
    /viewports のどれも含まない/,
  ],
])("fit: %s は exit 2", (_, files, message) => {
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/m.json": metadataOf(),
    ...files,
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("fit: 縦横比が一定の窓（一直線上）では幅と高さを分けられず exit 2", () => {
  const collinear = [0, 1, 2, 3].map((i) => ({ width: 1280 + 160 * i, height: 720 + 90 * i }));
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(formula, collinear),
    "/w/m.json": metadataOf([{ width: 1280, height: 720, label: "desktop" }]),
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/一直線上/);
});

test.each([
  ["page の欠落", (s) => delete s.elements[0].page, /page \/ element/],
  ["(page, element) の重複", (s) => (s.elements[1].element = "button"), /重複/],
  ["窓の矩形の欠け", (s) => s.elements[0].rects.pop(), /矩形が無い/],
  ["窓の矩形の重複", (s) => (s.elements[0].rects[1].window = WINDOWS[0]), /重複/],
  ["矩形の型崩れ", (s) => (s.elements[0].rects[0].rect.x = "10"), /有限数/],
  ["要素 0 件", (s) => (s.elements = []), /0 件/],
])("fit: %s は exit 2（キーを潰して通さない）", (_, mutate, message) => {
  const samples = samplesOf(formula);
  mutate(samples);
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samples,
    "/w/m.json": metadataOf(),
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test.each([
  [
    "traits.elements に samples に無い論理名がある",
    (m) => m.traits.elements.push("toolbar"),
    /toolbar/,
  ],
  ["traits.elements が無い", (m) => delete m.traits, /traits\.elements/],
])("fit: %s は exit 2（測る要素を自分で選ばせない）", (_, mutate, message) => {
  const m = metadataOf();
  mutate(m);
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(formula),
    "/w/m.json": m,
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("check: 1 点の px を並べた新側は、撮影ビューポートでは合っていても exit 1", () => {
  const r = run(
    ["check", "--metadata", "m.json", "--current-samples", "s.json", "--samples", "n.json"],
    {
      "/w/m.json": fittedMetadata(),
      "/w/n.json": samplesOf(pinned),
    },
  );
  expect(r.code).toBe(1);
  expect(r.json.judged).toBe(true);
  expect(r.json.ok).toBe(false);
  // 撮影ビューポートでは差が出ない（3 経路が緑になる形そのもの）
  expect(r.json.failures.some((f) => f.window?.width === 1366 && f.window?.height === 768)).toBe(
    false,
  );
  const at1600 = r.json.failures.find(
    (f) => f.element === "grid" && f.property === "height" && f.window?.width === 1600,
  );
  expect(at1600.deviation).toBe(132);
});

test("check: 式で写した新側は exit 0（陽性コントロール）", () => {
  const r = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
      "--write",
      "r.json",
    ],
    {
      "/w/m.json": fittedMetadata(),
      "/w/n.json": samplesOf(formula),
      "/w/r.json": { slug: "order-list" },
    },
  );
  expect(r.code).toBe(0);
  expect(r.json.ok).toBe(true);
  expect(r.json.checked).toBe(8 * WINDOWS.length);
  expect(r.file("/w/r.json").dimension_check).toMatchObject({
    judged: true,
    ok: true,
    failures: 0,
  });
});

test("check: 新側に要素が無い・一部の窓で消えるのは失敗", () => {
  const samples = samplesOf(formula);
  samples.elements = samples.elements.filter((e) => e.element !== "grid");
  samples.elements[0].rects[2].rect = null;
  const r = run(
    ["check", "--metadata", "m.json", "--current-samples", "s.json", "--samples", "n.json"],
    {
      "/w/m.json": fittedMetadata(),
      "/w/n.json": samples,
    },
  );
  expect(r.code).toBe(1);
  expect(r.json.failures.filter((f) => f.reason === "not_sampled")).toHaveLength(4);
  expect(r.json.failures.filter((f) => f.reason === "hidden")).toHaveLength(4);
});

test("check: 式が読めなかった軸は unfit_to_note として返す", () => {
  const layout = (w) => ({
    ...formula(w),
    button: { ...formula(w).button, x: w.width >= 1500 ? 800 : 400 },
  });
  const r = run(
    ["check", "--metadata", "m.json", "--current-samples", "s.json", "--samples", "n.json"],
    {
      "/w/m.json": fittedMetadata(layout),
      "/w/n.json": samplesOf(layout),
    },
  );
  expect(r.code).toBe(0);
  expect(r.json.unfit_to_note).toEqual([
    { page: "list", element: "button", property: "x", reason: "residual_exceeds_tolerance" },
  ]);
});

test("check: 残差が許容ぎりぎりの軸でも、現側と同一の新側は係数の丸めで落ちない", () => {
  // 1/64 px に丸めた実測で残差 0.49991 になる形（係数を 6 桁に丸めると偏差 0.501 で落ちていた）
  const widths = [948.65625, 1102.765625, 951.34375, 1257.390625];
  const layout = (w) => ({
    ...formula(w),
    button: { ...formula(w).button, width: widths[WINDOWS.findIndex((x) => x.width === w.width)] },
  });
  const m = fittedMetadata(layout);
  const fit = m.capture_conditions.dimension_model.fits.find(
    (f) => f.element === "button" && f.property === "width",
  );
  expect(fit).toBeDefined();
  expect(fit.residual).toBeGreaterThan(0.499);
  const r = run(
    ["check", "--metadata", "m.json", "--current-samples", "s.json", "--samples", "n.json"],
    {
      "/w/m.json": m,
      "/w/n.json": samplesOf(layout),
    },
  );
  expect(r.code).toBe(0);
});

test("check: dimension_model のキーが無いのは免除にせず exit 2（前回の合格も上書きする）", () => {
  const legacy = run(["check", "--metadata", "m.json", "--write", "r.json"], {
    "/w/m.json": metadataOf(),
    "/w/r.json": { dimension_check: { ok: true } },
  });
  expect(legacy.code).toBe(2);
  expect(legacy.stderr).toMatch(/キーを省略したまま判定を免除しない/);
  expect(legacy.file("/w/r.json").dimension_check).toMatchObject({ judged: false, ok: false });
});

test("check: not_measured は理由付きで判定しない（judged: false）", () => {
  const m = metadataOf();
  m.capture_conditions.dimension_model = {
    status: "not_measured",
    reason: "窓を変えると認証が切れる",
  };
  const notMeasured = run(["check", "--metadata", "m.json"], { "/w/m.json": m });
  expect(notMeasured.code).toBe(0);
  expect(notMeasured.json.reason).toMatch(/not_measured/);
});

test.each([
  ["not_measured に reason が無い", { status: "not_measured", reason: "" }, metadataOf(), /reason/],
  [
    "1 ビューポートで not_required",
    { status: "not_required", reason: "複数で撮る" },
    metadataOf(),
    /1 つの撮影/,
  ],
  ["status が enum 外", { status: "skipped", reason: "x" }, metadataOf(), /status/],
])("check: %s は exit 2", (_, dm, m, message) => {
  m.capture_conditions.dimension_model = dm;
  const r = run(["check", "--metadata", "m.json"], { "/w/m.json": m });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("check: ビューポート 2 つ以上なら not_required を理由付きで通す", () => {
  const m = metadataOf([
    { width: 1366, height: 768, label: "desktop" },
    { width: 390, height: 844, label: "mobile" },
  ]);
  m.capture_conditions.dimension_model = {
    status: "not_required",
    reason: "desktop と mobile の 2 点で撮る",
  };
  const r = run(["check", "--metadata", "m.json"], { "/w/m.json": m });
  expect(r.code).toBe(0);
  expect(r.json.judged).toBe(false);
});

test.each([
  [
    "tool_version の不一致",
    (m) => (m.capture_conditions.dimension_model.tool_version = "0"),
    null,
    /採り直す/,
  ],
  [
    "fits と unfit がどちらも空",
    (m) => (m.capture_conditions.dimension_model.fits = []),
    null,
    /どちらも空/,
  ],
  [
    "新側に現側の測定窓が無い",
    () => {},
    samplesOf(formula, WINDOWS.slice(1).concat([{ width: 1440, height: 700 }])),
    /測定窓/,
  ],
  ["新側 samples を渡さない", () => {}, undefined, /--samples/],
  [
    "unfit の形が崩れている",
    (m) => (m.capture_conditions.dimension_model.unfit = [{}]),
    null,
    /unfit\[0\] の形/,
  ],
  [
    "unfit が fits と同じ軸を持つ",
    (m) => {
      const { page, element, property } = m.capture_conditions.dimension_model.fits[0];
      m.capture_conditions.dimension_model.unfit = [{ page, element, property, reason: "x" }];
    },
    null,
    /fits にも在る/,
  ],
  [
    "ある要素の軸を記録から消した",
    (m) => {
      const dm = m.capture_conditions.dimension_model;
      dm.fits = dm.fits.filter((f) => !(f.element === "grid" && f.property !== "x"));
    },
    null,
    /\(list, grid\) に軸 y, width, height/,
  ],
  [
    "traits.elements の論理名が記録から丸ごと無い",
    (m) => {
      const dm = m.capture_conditions.dimension_model;
      dm.fits = dm.fits.filter((f) => f.element !== "grid");
    },
    null,
    /traits\.elements の論理名: grid/,
  ],
  [
    "measured_at が撮影ビューポートを含まない",
    (m) => (m.capture_conditions.viewports = [{ width: 1440, height: 700, label: "desktop" }]),
    null,
    /measured_at が capture_conditions\.viewports/,
  ],
])("check: %s は exit 2", (_, mutate, newSamples, message) => {
  const m = fittedMetadata();
  mutate(m);
  const files = { "/w/m.json": m };
  const argv = ["check", "--metadata", "m.json", "--current-samples", "s.json"];
  if (newSamples !== undefined) {
    files["/w/n.json"] = newSamples ?? samplesOf(formula);
    argv.push("--samples", "n.json");
  }
  const r = run(argv, files);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("check --write: exit 2 でも前回の合格を残さず error を書き、照合した式と samples の指紋を残す", () => {
  const m = fittedMetadata();
  const ok = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
      "--write",
      "r.json",
    ],
    {
      "/w/m.json": m,
      "/w/n.json": samplesOf(formula),
      "/w/r.json": { slug: "order-list" },
    },
  );
  expect(ok.code).toBe(0);
  const passed = ok.file("/w/r.json").dimension_check;
  expect(passed.model_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(passed.samples_fingerprint).toMatch(/^[0-9a-f]{64}$/);

  const broken = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
      "--write",
      "r.json",
    ],
    {
      "/w/m.json": m,
      "/w/n.json": samplesOf(formula, WINDOWS.slice(1).concat([{ width: 1440, height: 700 }])),
      "/w/r.json": ok.file("/w/r.json"),
    },
  );
  expect(broken.code).toBe(2);
  const record = broken.file("/w/r.json").dimension_check;
  expect(record.ok).toBe(false);
  expect(record.error).toMatch(/測定窓/);
  expect(record.samples_fingerprint).not.toBe(passed.samples_fingerprint);
});

test.each([
  [
    "窓の寸法が文字列",
    (s) => (s.elements[0].rects[0].window = { width: "1366", height: "768" }),
    /window の width \/ height が正の整数でない/,
  ],
  [
    "撮影ページを測っていない",
    (s) => s.elements.forEach((e) => (e.page = "detail")),
    /capture_conditions\.pages に無いページ: detail/,
  ],
])("fit: %s は exit 2", (_, mutate, message) => {
  const samples = samplesOf(formula);
  mutate(samples);
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samples,
    "/w/m.json": metadataOf(),
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("fit: 撮影ページの 1 つを測っていなければ exit 2（別ページの論理名で埋めない）", () => {
  const m = metadataOf();
  m.capture_conditions.pages.push({ name: "detail", path: "/orders/1" });
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(formula),
    "/w/m.json": m,
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/測っていないページ: detail/);
});

test.each([
  ["寸法が 0", [{ width: 0, height: 768, label: "desktop" }], /正の整数でない/],
  [
    "同じ寸法の重複で 2 つに見せる",
    [
      { width: 1366, height: 768, label: "desktop" },
      { width: 1366, height: 768, label: "desktop-2" },
    ],
    /重複/,
  ],
])("check: ビューポートの%sは exit 2", (_, viewports, message) => {
  const m = metadataOf(viewports);
  m.capture_conditions.dimension_model = { status: "not_required", reason: "複数で撮る" };
  const r = run(["check", "--metadata", "m.json"], { "/w/m.json": m });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("check --write: metadata が読めない exit 2 でも前回の合格を上書きする", () => {
  const r = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
      "--write",
      "r.json",
    ],
    {
      "/w/m.json": "{ broken",
      "/w/n.json": samplesOf(formula),
      "/w/r.json": { dimension_check: { ok: true } },
    },
  );
  expect(r.code).toBe(2);
  expect(r.file("/w/r.json").dimension_check).toMatchObject({ ok: false });
});

test("check --write: 引数の不備（--write より後の不明な引数）の exit 2 でも前回の合格を上書きする", () => {
  const r = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
      "--write",
      "r.json",
      "--bogus",
    ],
    {
      "/w/m.json": fittedMetadata(),
      "/w/n.json": samplesOf(formula),
      "/w/r.json": { dimension_check: { ok: true } },
    },
  );
  expect(r.code).toBe(2);
  expect(r.file("/w/r.json").dimension_check).toMatchObject({
    ok: false,
    error: expect.stringMatching(/--bogus/),
  });
});

test("fit: 撮影ページ名の重複は exit 2（2 つ目のページの測り漏れを潰さない）", () => {
  const m = metadataOf();
  m.capture_conditions.pages.push({ name: "list", path: "/orders/archive" });
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(formula),
    "/w/m.json": m,
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/pages\[\]\.name が重複している: list/);
});

test("check --write: --write の重複は exit 2 で、どちらの書き込み先にも前回の合格を残さない", () => {
  const r = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--samples",
      "n.json",
      "--write",
      "r1.json",
      "--write",
      "r2.json",
      "--bogus",
    ],
    {
      "/w/m.json": fittedMetadata(),
      "/w/n.json": samplesOf(formula),
      "/w/r1.json": { dimension_check: { ok: true } },
      "/w/r2.json": { dimension_check: { ok: true } },
    },
  );
  expect(r.code).toBe(2);
  expect(r.file("/w/r1.json").dimension_check).toMatchObject({ ok: false });
  expect(r.file("/w/r2.json").dimension_check).toMatchObject({ ok: false });
});

test.each([
  [
    "check",
    [
      "check",
      "--metadata",
      "m.json",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
    ],
  ],
  ["fit", ["fit", "--samples", "s.json", "--metadata", "m.json", "--write", "--write"]],
])("%s: オプションの重複は後勝ちにせず exit 2", (_, argv) => {
  const r = run(argv, {
    "/w/m.json": fittedMetadata(),
    "/w/n.json": samplesOf(formula),
    "/w/s.json": samplesOf(formula),
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/重複している/);
});

test("fit: 全ての窓で表示されない要素は採取の失敗として exit 2（照合 0 件のモデルを作らない）", () => {
  const layout = (w) => ({ ...formula(w), grid: null });
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(layout),
    "/w/m.json": metadataOf(),
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/\(list, grid\) が全ての窓で表示されていない/);
});

test("check: fits が 0 件（全軸 unfit）なら合格を名乗らず judged: false と unfit_to_note を返す", () => {
  // 全要素・全軸が窓の幅 1500 を境に跳ぶ（ブレークポイントをまたいで式が読めない）
  const jump = (w) => (w.width >= 1500 ? 400 : 0);
  const layout = (w) => ({
    button: { x: 10 + jump(w), y: 10 + jump(w), width: 90 + jump(w), height: 30 + jump(w) },
    grid: { x: 20 + jump(w), y: 120 + jump(w), width: 500 + jump(w), height: 300 + jump(w) },
  });
  const m = fittedMetadata(layout);
  expect(m.capture_conditions.dimension_model.fits).toEqual([]);
  const r = run(
    [
      "check",
      "--metadata",
      "m.json",
      "--current-samples",
      "s.json",
      "--samples",
      "n.json",
      "--write",
      "r.json",
    ],
    { "/w/m.json": m, "/w/n.json": samplesOf(layout), "/w/r.json": {} },
  );
  expect(r.code).toBe(0);
  expect(r.json.judged).toBe(false);
  expect(r.json.unfit_to_note).toHaveLength(8);
  expect(r.file("/w/r.json").dimension_check).toMatchObject({ judged: false, ok: null });
  expect(r.file("/w/r.json").dimension_check.unfit_to_note).toHaveLength(8);
});

test.each([
  ["fit の後に offset を書き換えた", (dm) => (dm.fits[0].offset += 100)],
  [
    "fit の後に fits の軸を unfit へ移した",
    (dm) => dm.unfit.push({ ...dm.fits.shift(), reason: "residual_exceeds_tolerance" }),
  ],
])(
  "check: %s モデルは exit 2（現側 samples から当てはめ直した結果と突き合わせる）",
  (_, mutate) => {
    const m = fittedMetadata();
    mutate(m.capture_conditions.dimension_model);
    // 新側は書き換えた式どおりに作った想定でも通さない
    const r = run(
      ["check", "--metadata", "m.json", "--current-samples", "s.json", "--samples", "n.json"],
      {
        "/w/m.json": m,
        "/w/n.json": samplesOf(formula),
      },
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/当てはめ直した結果と一致しない/);
  },
);

test.each([
  [
    "現側 samples を採り直して fit を通していない",
    (files) =>
      (files["/w/s.json"] = samplesOf((w) => ({
        ...formula(w),
        button: { ...formula(w).button, x: w.width },
      }))),
    /samples_fingerprint と一致しない/,
  ],
  [
    "--current-samples を渡さない",
    (_files, argv) => argv.splice(argv.indexOf("--current-samples"), 2),
    /--current-samples/,
  ],
])("check: %s は exit 2", (_, mutate, message) => {
  const files = { "/w/m.json": fittedMetadata(), "/w/n.json": samplesOf(formula) };
  const argv = [
    "check",
    "--metadata",
    "m.json",
    "--current-samples",
    "s.json",
    "--samples",
    "n.json",
  ];
  mutate(files, argv);
  const r = run(argv, files);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("fit: traits.elements の論理名の重複は exit 2（測る対象を黙って減らさない）", () => {
  const m = metadataOf();
  m.traits.elements = ["button", "button", "grid"];
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json"], {
    "/w/s.json": samplesOf(formula),
    "/w/m.json": m,
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/traits\.elements が重複している: button/);
});

test("CLI: シンボリックリンクでなく実パスで起動して exit コードを返す", () => {
  const dir = makeTempDir("dimension-fit-");
  writeFileSync(join(dir, "s.json"), JSON.stringify(samplesOf(formula)));
  writeFileSync(join(dir, "m.json"), JSON.stringify(metadataOf()));
  const fit = spawnSync(
    process.execPath,
    [script, "fit", "--samples", "s.json", "--metadata", "m.json", "--write"],
    {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  expect(fit.status).toBe(0);
  writeFileSync(join(dir, "n.json"), JSON.stringify(samplesOf(pinned)));
  const check = spawnSync(
    process.execPath,
    [script, "check", "--metadata", "m.json", "--current-samples", "s.json", "--samples", "n.json"],
    {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  expect(check.status).toBe(1);
  expect(
    JSON.parse(readFileSync(join(dir, "m.json"), "utf8")).capture_conditions.dimension_model.status,
  ).toBe("measured");
});
