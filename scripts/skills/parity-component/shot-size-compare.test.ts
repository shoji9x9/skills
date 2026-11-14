// 部品の寸法を基準とカタログの見本で突き合わせる shot-size-compare.mjs の回帰テスト（Issue #1019）。
//
// このツールが誤るのは、多くの場合「比べていない組を合格と言う」側である。
// そのため、記録が片側に無い・読めない・png が数でない・比べた組が 0 件・基準の無い見本を、
// exit 2 で止めることを厚く見る。寸法の差（幅だけ・高さだけ）が exit 1 になることと、
// 寸法が同じなら 0 件で exit 0 になることも置く。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  compareShotSizes,
  main,
} from "../../../skills/parity-component/scripts/shot-size-compare.mjs";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-component/scripts/shot-size-compare.mjs");

type Size = { width: number; height: number };

/** element-shot.mjs が書く形の記録。png と page_rect などを上書きできる。 */
function shot(size: Size, override: Record<string, unknown> = {}) {
  return {
    clip: { x: 8, y: 8, ...size },
    png: size,
    rect: { x: 8, y: 8, ...size },
    page_rect: { x: 8, y: 8, ...size },
    frame_depth: 0,
    animations: "disabled",
    tool_version: "6",
    ...override,
  };
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}

/**
 * 部品の成果物ディレクトリとカタログの採取ディレクトリを作る。
 * baseline と catalog は `<instance>/<state>` をキーにした記録（undefined なら置かない）。
 */
/** layout に渡す採取物。省いたものはデフォルトの 1 組（orders-search/default、100x20）にする。 */
type Layout = {
  metadata?: unknown;
  baseline?: Record<string, unknown>;
  catalog?: Record<string, unknown>;
};

function layout({
  metadata = { instances: [{ id: "orders-search" }], capture: { states: ["default"] } },
  baseline = { "orders-search/default": shot({ width: 100, height: 20 }) },
  catalog = { "orders-search/default": shot({ width: 100, height: 20 }) },
}: Layout = {}) {
  const dir = makeTempDir("shot-size-compare-");
  const baselineDir = join(dir, "components", "button");
  const catalogDir = join(baselineDir, "new", "local", "catalog");
  mkdirSync(catalogDir, { recursive: true });
  writeJson(join(baselineDir, "metadata.json"), metadata);
  for (const [key, value] of Object.entries(baseline)) {
    if (value !== undefined)
      writeJson(join(baselineDir, "baseline", key, "element.shot.json"), value);
  }
  for (const [key, value] of Object.entries(catalog)) {
    if (value !== undefined) writeJson(join(catalogDir, key, "element.shot.json"), value);
  }
  return { dir, baselineDir, catalogDir };
}

function codes(result: { findings: { code: string }[] }) {
  return result.findings.map((f) => f.code);
}

test("寸法が同じ組だけなら、差分 0 件で判定できる", () => {
  const result = compareShotSizes(layout());
  expect(result).toMatchObject({ structural: false, findings: [], compared: 1 });
});

test("要素 1 つで幅だけが違うと、width の差を page_rect の診断と一緒に出す", () => {
  const { baselineDir, catalogDir } = layout({
    catalog: {
      "orders-search/default": shot(
        { width: 140, height: 20 },
        { page_rect: { x: 8, y: 8, width: 140.4, height: 20 } },
      ),
    },
  });
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.structural).toBe(false);
  expect(result.findings).toEqual([
    {
      code: "size-mismatch",
      instance: "orders-search",
      state: "default",
      axis: "width",
      baseline: 100,
      catalog: 140,
      page_rect: { baseline: { width: 100, height: 20 }, catalog: { width: 140.4, height: 20 } },
    },
  ]);
});

test("要素 1 つで高さだけが違うと、height の差だけを出す", () => {
  const { baselineDir, catalogDir } = layout({
    catalog: { "orders-search/default": shot({ width: 100, height: 50 }) },
  });
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.findings.map((f) => [f.code, f.axis, f.baseline, f.catalog])).toEqual([
    ["size-mismatch", "height", 20, 50],
  ]);
});

test("複数の組のうち 1 組だけ違えば、その組だけを出す", () => {
  const { baselineDir, catalogDir } = layout({
    metadata: {
      instances: [{ id: "orders-search" }, { id: "user-create" }],
      capture: { states: ["default", "hover"] },
    },
    baseline: {
      "orders-search/default": shot({ width: 100, height: 20 }),
      "orders-search/hover": shot({ width: 100, height: 20 }),
      "user-create/default": shot({ width: 120, height: 20 }),
      "user-create/hover": shot({ width: 120, height: 20 }),
    },
    catalog: {
      "orders-search/default": shot({ width: 100, height: 20 }),
      "orders-search/hover": shot({ width: 100, height: 20 }),
      "user-create/default": shot({ width: 120, height: 20 }),
      "user-create/hover": shot({ width: 121, height: 20 }),
    },
  });
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.compared).toBe(4);
  expect(result.findings.map((f) => `${f.instance}/${f.state}/${f.axis}`)).toEqual([
    "user-create/hover/width",
  ]);
});

test("page_rect が無い記録でも、png で判定し、診断の page_rect を null にする", () => {
  const { baselineDir, catalogDir } = layout({
    catalog: {
      "orders-search/default": shot({ width: 101, height: 20 }, { page_rect: undefined }),
    },
  });
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.findings[0]).toMatchObject({
    code: "size-mismatch",
    page_rect: { baseline: { width: 100, height: 20 }, catalog: null },
  });
});

test.each<[string, Layout, string]>([
  ["見本の側に記録が無い", { catalog: {} }, "catalog"],
  [
    "基準の側に記録が無い",
    { baseline: { "orders-search/hover": shot({ width: 100, height: 20 }) } },
    "baseline",
  ],
  ["見本の記録が JSON として読めない", { catalog: { "orders-search/default": "{" } }, "catalog"],
])("%s組は、合格として扱わずに止める", (_name, input, side) => {
  const result = compareShotSizes(layout(input));
  expect(result.structural).toBe(true);
  expect(result.findings).toEqual([
    expect.objectContaining({ code: "shot-unreadable", instance: "orders-search", side }),
  ]);
});

test.each([
  ["png のキーが無い", { png: undefined }],
  ["png が null", { png: null }],
  ["幅が文字列", { png: { width: "100", height: 20 } }],
  ["高さが無い", { png: { width: 100 } }],
  ["幅が小数", { png: { width: 100.5, height: 20 } }],
  ["幅が 0", { png: { width: 0, height: 20 } }],
  ["tool_version が無い", { tool_version: undefined }],
])("%s記録は、比べずに止める", (_name, override) => {
  const result = compareShotSizes(
    layout({ catalog: { "orders-search/default": shot({ width: 100, height: 20 }, override) } }),
  );
  expect(result.structural).toBe(true);
  expect(codes(result)).toEqual(["shot-unreadable"]);
  expect(result.compared).toBe(0);
});

test("両側の element-shot のバージョンが違うと、PNG の寸法を比べずに止める", () => {
  const result = compareShotSizes(
    layout({
      catalog: { "orders-search/default": shot({ width: 100, height: 20 }, { tool_version: "5" }) },
    }),
  );
  expect(result.structural).toBe(true);
  expect(codes(result)).toEqual(["shot-version-mismatch"]);
});

/** orders-search だけが disabled に到達できないと宣言した metadata。 */
const partlyUnreachable = {
  instances: [
    {
      id: "orders-search",
      unreachable_states: [{ state: "disabled", reason: "無効にする条件が無い" }],
    },
    { id: "users-create" },
  ],
  capture: { states: ["default", "disabled"] },
};

/** partlyUnreachable の母集合（到達できない組を除く 3 組）の記録。 */
function partlyUnreachableShots(extra: Record<string, unknown> = {}) {
  const same = shot({ width: 100, height: 20 });
  return {
    "orders-search/default": same,
    "users-create/default": same,
    "users-create/disabled": same,
    ...extra,
  };
}

test("宣言済みの到達できない組は読まずに外し、excluded に残す", () => {
  const result = compareShotSizes(
    layout({
      metadata: partlyUnreachable,
      baseline: partlyUnreachableShots(),
      catalog: partlyUnreachableShots(),
    }),
  );
  expect(result).toMatchObject({
    structural: false,
    findings: [],
    compared: 3,
    excluded: [{ instance: "orders-search", state: "disabled" }],
  });
});

test("どのインスタンスでも到達できないと宣言された状態は、除外として通さずに止める", () => {
  const result = compareShotSizes(
    layout({
      metadata: {
        instances: [
          { id: "orders-search", unreachable_states: [{ state: "default", reason: "理由" }] },
        ],
        capture: { states: ["default"] },
      },
      catalog: {},
    }),
  );
  expect(result.structural).toBe(true);
  expect(codes(result)).toEqual(["unreachable-everywhere"]);
});

test.each([
  ["reason の無い宣言", [{ state: "default" }], "unreachable-invalid"],
  ["文字列だけの宣言", ["default"], "unreachable-invalid"],
  ["配列でない宣言", { state: "default", reason: "x" }, "unreachable-invalid"],
  [
    "capture.states に無い状態の宣言",
    [{ state: "hovr", reason: "x" }],
    "unreachable-unknown-state",
  ],
])("%sは、到達できない組として外さずに止める", (_name, declared, code) => {
  const result = compareShotSizes(
    layout({
      metadata: {
        instances: [{ id: "orders-search", unreachable_states: declared }],
        capture: { states: ["default"] },
      },
    }),
  );
  expect(result.structural).toBe(true);
  expect(codes(result)).toEqual([code]);
});

test("母集合に無い組の見本がカタログの側にあれば、基準の無い見本として止める", () => {
  const result = compareShotSizes(
    layout({
      catalog: {
        "orders-search/default": shot({ width: 100, height: 20 }),
        "orders-search/focus": shot({ width: 100, height: 20 }),
        "unknown-page/default": shot({ width: 100, height: 20 }),
      },
    }),
  );
  expect(result.structural).toBe(true);
  expect(result.findings.map((f) => `${f.code}:${f.instance}/${f.state}`).sort()).toEqual([
    "sample-without-baseline:orders-search/focus",
    "sample-without-baseline:unknown-page/default",
  ]);
});

test("到達できないと宣言した組に見本があれば、基準の無い見本として止める", () => {
  const result = compareShotSizes(
    layout({
      metadata: partlyUnreachable,
      baseline: partlyUnreachableShots(),
      catalog: partlyUnreachableShots({
        "orders-search/disabled": shot({ width: 100, height: 20 }),
      }),
    }),
  );
  expect(codes(result)).toEqual(["sample-without-baseline"]);
});

test("element.shot.json の無い余分な見本のディレクトリも、基準の無い見本として止める", () => {
  const { baselineDir, catalogDir } = layout();
  writeJson(join(catalogDir, "orders-search", "focus", "traits.json"), []);
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.findings.map((f) => `${f.code}:${f.instance}/${f.state}`)).toEqual([
    "sample-without-baseline:orders-search/focus",
  ]);
});

test("カタログの側の一覧を読めない（リンク先が無い）ときは、異常終了せずに判定できない入力として止める", () => {
  const { dir, baselineDir, catalogDir } = layout();
  symlinkSync(join(dir, "no-such-dir"), join(catalogDir, "dangling"));
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.structural).toBe(true);
  expect(codes(result)).toEqual(["catalog-unreadable"]);
});

test.each([
  ["metadata.json が読めない", "{", "metadata-unreadable"],
  ["capture.states が空", { instances: [{ id: "a" }], capture: { states: [] } }, "states-empty"],
  ["instances が空", { instances: [], capture: { states: ["default"] } }, "instances-empty"],
  [
    "状態名がパスとして不正",
    { instances: [{ id: "orders-search" }], capture: { states: ["default", "../x"] } },
    "state-invalid",
  ],
  [
    "id がパスとして不正",
    { instances: [{ id: "orders-search" }, { id: ".." }], capture: { states: ["default"] } },
    "instance-invalid",
  ],
  [
    "状態名が重複",
    { instances: [{ id: "orders-search" }], capture: { states: ["default", "default"] } },
    "state-invalid",
  ],
  [
    "id が重複",
    {
      instances: [{ id: "orders-search" }, { id: "orders-search" }],
      capture: { states: ["default"] },
    },
    "instance-invalid",
  ],
])("%s metadata.json は、判定できない入力として止める", (_name, metadata, code) => {
  const result = compareShotSizes(layout({ metadata }));
  expect(result.structural).toBe(true);
  expect(codes(result)).toContain(code);
});

test.each<[string, (baselineDir: string) => string]>([
  ["基準の baseline/ そのもの", (b) => join(b, "baseline")],
  ["基準の baseline/ の中", (b) => join(b, "baseline", "orders-search")],
  ["部品の成果物ディレクトリそのもの", (b) => b],
  ["new/<target> まで（catalog の 1 段上）", (b) => join(b, "new", "local")],
  ["new/<target>/catalog の下", (b) => join(b, "new", "local", "catalog", "orders-search")],
  ["別の部品の catalog", (b) => join(b, "..", "other", "new", "local", "catalog")],
])("--catalog が%sを指すと、比べずに止める", (_name, catalogOf) => {
  const { baselineDir } = layout();
  const result = compareShotSizes({ baselineDir, catalogDir: catalogOf(baselineDir) });
  expect(result).toMatchObject({ structural: true, compared: 0 });
  expect(codes(result)).toEqual(["catalog-path-invalid"]);
});

test("--catalog が形どおりでも、リンクで基準の baseline/ を指すなら比べずに止める", () => {
  const { baselineDir } = layout();
  mkdirSync(join(baselineDir, "new", "linked"), { recursive: true });
  symlinkSync(join(baselineDir, "baseline"), join(baselineDir, "new", "linked", "catalog"));
  const result = compareShotSizes({
    baselineDir,
    catalogDir: join(baselineDir, "new", "linked", "catalog"),
  });
  expect(codes(result)).toEqual(["catalog-path-invalid"]);
  expect(result.findings[0].detail).toMatch(/リンク/);
});

test("--baseline がリンクを通した道でも、形どおりの --catalog は受け付ける", () => {
  const { dir, baselineDir } = layout();
  const linkedBase = join(dir, "linked-component");
  symlinkSync(baselineDir, linkedBase);
  const result = compareShotSizes({
    baselineDir: linkedBase,
    catalogDir: join(linkedBase, "new", "local", "catalog"),
  });
  expect(result).toMatchObject({ structural: false, findings: [], compared: 1 });
});

test("基準の baseline/ が無ければ、組ごとに並べず 1 件の指摘で止める", () => {
  const result = compareShotSizes(
    layout({
      metadata: {
        instances: [{ id: "orders-search" }, { id: "users-create" }],
        capture: { states: ["default", "hover"] },
      },
      baseline: {},
      catalog: {},
    }),
  );
  expect(result.structural).toBe(true);
  expect(codes(result)).toEqual(["baseline-missing"]);
});

test("基準の baseline/ がファイルなら、無いとは書かずにディレクトリでないと報告する", () => {
  const { baselineDir, catalogDir } = layout({ baseline: {} });
  writeFileSync(join(baselineDir, "baseline"), "");
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(codes(result)).toEqual(["baseline-missing"]);
  expect(result.findings[0].detail).toMatch(/ディレクトリでない/);
});

test("判定できない組があっても、比べ終えた組の寸法の差を出力に含める", () => {
  const { baselineDir, catalogDir } = layout({
    metadata: {
      instances: [{ id: "orders-search" }, { id: "users-create" }],
      capture: { states: ["default"] },
    },
    baseline: {
      "orders-search/default": shot({ width: 100, height: 20 }),
      "users-create/default": shot({ width: 102, height: 28 }),
    },
    catalog: { "users-create/default": shot({ width: 110, height: 28 }) },
  });
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result).toMatchObject({ structural: true, pairs: 2, compared: 1 });
  expect(result.findings.map((f) => `${f.code}:${f.instance}`)).toEqual([
    "shot-unreadable:orders-search",
    "size-mismatch:users-create",
  ]);
});

test("記録のパスがリンクで基準の外を指すと、読まずに止める", () => {
  const { dir, baselineDir, catalogDir } = layout({ baseline: {} });
  const outside = join(dir, "outside");
  writeJson(join(outside, "element.shot.json"), shot({ width: 100, height: 20 }));
  mkdirSync(join(baselineDir, "baseline", "orders-search"), { recursive: true });
  symlinkSync(outside, join(baselineDir, "baseline", "orders-search", "default"));
  const result = compareShotSizes({ baselineDir, catalogDir });
  expect(result.findings).toEqual([
    expect.objectContaining({ code: "shot-unreadable", side: "baseline" }),
  ]);
  expect(result.findings[0].detail).toMatch(/外を指す/);
});

test("CLI: 一致で exit 0、寸法の差で exit 1、記録の欠けと引数の誤りは exit 2", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" });
  const same = layout();
  const ok = run(["--baseline", same.baselineDir, "--catalog", same.catalogDir]);
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({
    tool: "shot-size-compare",
    ok: true,
    excluded: [],
    counts: { pairs: 1, compared: 1, findings: 0 },
  });

  const wide = layout({ catalog: { "orders-search/default": shot({ width: 140, height: 20 }) } });
  const diff = run(["--baseline", wide.baselineDir, "--catalog", wide.catalogDir]);
  expect(diff.status).toBe(1);
  expect(JSON.parse(diff.stdout)).toMatchObject({ ok: false, findings: [{ axis: "width" }] });

  const missing = layout({ catalog: {} });
  const broken = run(["--baseline", missing.baselineDir, "--catalog", missing.catalogDir]);
  expect(broken.status).toBe(2);
  expect(JSON.parse(broken.stdout)).toMatchObject({
    ok: false,
    structural: true,
    counts: { pairs: 1, compared: 0 },
  });

  let err = "";
  const io = { write: () => {}, writeErr: (s: string) => (err += s) };
  expect(main([], io)).toBe(2);
  expect(err).toMatch(/必須/);
  err = "";
  expect(main(["--baseline", same.baselineDir, "--catalog", join(same.dir, "nope")], io)).toBe(2);
  expect(err).toMatch(/ディレクトリが無い/);
});
