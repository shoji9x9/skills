// region-names.mjs の回帰テスト（Issue #1018）。
// 期待値は references/detect.md の「領域に論理名を対応づける」の取り決めから決める。
//
// 入力の状態を軸ごとに挙げ、各状態を少なくとも 1 件のテストにする。
// - 重なる論理名の数は、0 件・1 件・複数件である。
// - bbox と rect の位置は、辺が接する・角が接する・領域が要素を含む・要素が領域を含む・一部が重なる、である。
// - 論理名の面積は、0（width か height が 0）・正である。
// - traits.json は、両側あり・現側だけ無い・新側だけ無い・両側とも無い・形の誤りである。
// - 論理名の在る側は、両側・片側だけである。
// - マスクは、無し・論理名で全体を覆う・bbox の和で全体を覆う・一部だけ重なる、である。
// - マスクの論理名の位置は、両側の traits.json に無い・片側の traits.json にだけある、である。
// - 座標の倍率（--scale）は、1・2 である。
// - 領域の種類は、regions・strict_only_regions である。
// - 引数は、必須の欠け・--scale が 0・--mask-bbox の形の誤りである。

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  classifyRegion,
  coveredByUnion,
  intersectionArea,
  overlappingNames,
  readRegions,
  readTraits,
} from "../../../skills/parity-diff/scripts/region-names.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const SCRIPT = fileURLToPath(
  new URL("../../../skills/parity-diff/scripts/region-names.mjs", import.meta.url),
);

type Rect = { x: number; y: number; width: number; height: number };
type Entry = { name: string; rect: Rect };

const rect = ([x, y, width, height]: [number, number, number, number]): Rect => ({
  x,
  y,
  width,
  height,
});

const present = (side: "current" | "new", entries: Entry[]) =>
  ({ side, missing: false, entries }) as const;
const missing = (side: "current" | "new") => ({ side, missing: true }) as const;

const classify = (
  bbox: Rect,
  sides: ReturnType<typeof present | typeof missing>[],
  extra: {
    masks?: Array<{ label: string; rects: Rect[] }>;
    reasons?: string[];
    scale?: number;
  } = {},
) =>
  classifyRegion(
    { id: 1, kind: "threshold", bbox },
    {
      sides,
      scale: extra.scale ?? 1,
      masks: extra.masks ?? [],
      maskNames: new Set(extra.masks?.map((m) => m.label) ?? []),
      reasons: extra.reasons ?? [],
    },
  );

// --- 関数の粒度: 重なりの定義 ---

test("辺や角が接するだけの矩形は重ならない（交わりの面積が 0）", () => {
  const region = rect([10, 10, 10, 10]);
  expect(intersectionArea(region, rect([20, 10, 5, 5]))).toBe(0);
  expect(intersectionArea(region, rect([0, 0, 10, 10]))).toBe(0);
  expect(intersectionArea(region, rect([19, 19, 5, 5]))).toBe(1);
});

test("重なる論理名が 0 件の領域は unnamed になる（両側の traits.json があり、マスクが無い）", () => {
  const sides = [
    present("current", [{ name: "header", rect: rect([0, 0, 100, 10]) }]),
    present("new", [{ name: "header", rect: rect([0, 0, 100, 10]) }]),
  ];
  const result = classify(rect([0, 10, 50, 5]), sides);
  expect(result.status).toBe("unnamed");
  expect(result.names).toEqual([]);
});

test("重なる論理名が 1 件の領域は named になり、名前と両側が出る", () => {
  const sides = [
    present("current", [{ name: "save-button", rect: rect([10, 10, 20, 10]) }]),
    present("new", [{ name: "save-button", rect: rect([10, 10, 20, 10]) }]),
  ];
  const result = classify(rect([12, 12, 4, 4]), sides);
  expect(result.status).toBe("named");
  expect(result.names).toEqual([
    {
      name: "save-button",
      sides: ["current", "new"],
      overlap_px: 16,
      region_coverage: 1,
      element_coverage: 0.08,
    },
  ]);
});

test("重なる論理名が複数件なら、領域を覆う割合の大きい順に並ぶ（領域が要素を含む・要素が領域を含む・一部が重なる）", () => {
  const entries = [
    { name: "page", rect: rect([0, 0, 200, 200]) },
    { name: "icon", rect: rect([12, 12, 4, 4]) },
    { name: "label", rect: rect([18, 10, 20, 10]) },
  ];
  const result = classify(rect([10, 10, 10, 10]), [
    present("current", entries),
    present("new", entries),
  ]);
  expect(result.status).toBe("named");
  expect(result.names.map((n) => n.name)).toEqual(["page", "label", "icon"]);
  expect(result.names.map((n) => n.region_coverage)).toEqual([1, 0.2, 0.16]);
});

test("面積が 0 の論理名は、領域の内側にあっても重ならない", () => {
  const entries = [{ name: "hidden", rect: rect([12, 12, 0, 5]) }];
  const result = classify(rect([10, 10, 10, 10]), [
    present("current", entries),
    present("new", entries),
  ]);
  expect(result.status).toBe("unnamed");
});

test("片側にだけ重なる論理名は、その側だけを sides に持つ", () => {
  const names = overlappingNames(rect([0, 0, 10, 10]), {
    sides: [
      present("current", [{ name: "badge", rect: rect([5, 5, 10, 10]) }]),
      present("new", [{ name: "badge", rect: rect([50, 50, 10, 10]) }]),
    ],
    scale: 1,
    maskNames: new Set(),
  });
  expect(names.map((n) => [n.name, n.sides])).toEqual([["badge", ["current"]]]);
});

test("--scale を掛けた rect で比べる（CSS の px と画像の画素）", () => {
  const entries = [{ name: "chip", rect: rect([10, 10, 5, 5]) }];
  const sides = [present("current", entries), present("new", entries)];
  expect(classify(rect([22, 22, 4, 4]), sides, { scale: 1 }).status).toBe("unnamed");
  expect(classify(rect([22, 22, 4, 4]), sides, { scale: 2 }).status).toBe("named");
});

test("判定できない理由があり、どの論理名とも重ならない領域は unknown になり、unnamed にならない", () => {
  const sides = [present("current", []), missing("new")];
  const result = classify(rect([0, 0, 5, 5]), sides, { reasons: ["traits_missing:new"] });
  expect(result.status).toBe("unknown");
  expect(result.unresolved).toEqual(["traits_missing:new"]);
});

test("判定できない理由があっても、重なる論理名があれば named で、理由も残る", () => {
  const sides = [present("current", [{ name: "nav", rect: rect([0, 0, 10, 10]) }]), missing("new")];
  const result = classify(rect([0, 0, 5, 5]), sides, { reasons: ["traits_missing:new"] });
  expect(result.status).toBe("named");
  expect(result.unresolved).toEqual(["traits_missing:new"]);
});

test("マスクの矩形の和に全体が覆われる領域は masked になる（重なる論理名より先に決まる）", () => {
  const entries = [{ name: "card", rect: rect([0, 0, 100, 100]) }];
  const sides = [present("current", entries), present("new", entries)];
  const masks = [
    { label: "0,0,10,20", rects: [rect([0, 0, 10, 20])] },
    { label: "10,0,10,20", rects: [rect([10, 0, 10, 20])] },
  ];
  const result = classify(rect([2, 2, 15, 10]), sides, { masks });
  expect(result.status).toBe("masked");
  expect(result.masks).toEqual(["0,0,10,20", "10,0,10,20"]);
});

test("マスクに一部だけ重なる領域は masked にならず、重なったマスクを masks に持つ", () => {
  const entries = [{ name: "card", rect: rect([0, 0, 100, 100]) }];
  const sides = [present("current", entries), present("new", entries)];
  const result = classify(rect([5, 5, 10, 10]), sides, {
    masks: [{ label: "0,0,10,10", rects: [rect([0, 0, 10, 10])] }],
  });
  expect(result.status).toBe("named");
  expect(result.masks).toEqual(["0,0,10,10"]);
});

test("矩形の和の覆い方は、隙間が 1 画素でも残れば覆っていない", () => {
  expect(coveredByUnion(rect([0, 0, 10, 10]), [rect([0, 0, 5, 10]), rect([6, 0, 4, 10])])).toBe(
    false,
  );
  expect(coveredByUnion(rect([0, 0, 10, 10]), [rect([0, 0, 5, 10]), rect([5, 0, 5, 10])])).toBe(
    true,
  );
});

test("マスクの論理名そのものは、重なる論理名に数えない", () => {
  const entries = [
    { name: "token", rect: rect([0, 0, 10, 10]) },
    { name: "row", rect: rect([0, 0, 50, 10]) },
  ];
  const result = classify(
    rect([8, 2, 4, 4]),
    [present("current", entries), present("new", entries)],
    {
      masks: [{ label: "token", rects: [rect([0, 0, 10, 10])] }],
    },
  );
  expect(result.names.map((n) => n.name)).toEqual(["row"]);
});

test("pixel-crops.mjs の出力は regions と strict_only_regions の両方を読み、種類を付ける", () => {
  const read = readRegions({
    regions: [{ id: 1, bbox: rect([0, 0, 1, 1]) }],
    strict_only_regions: [{ id: "s1", bbox: rect([2, 2, 1, 1]) }],
  });
  expect(read).toEqual({
    regions: [
      { id: 1, kind: "threshold", bbox: rect([0, 0, 1, 1]) },
      { id: "s1", kind: "strict_only", bbox: rect([2, 2, 1, 1]) },
    ],
  });
  expect(readRegions({ regions: [] })).toHaveProperty("error");
  expect(
    readRegions({ regions: [{ id: 1, bbox: rect([0, 0, 0, 1]) }], strict_only_regions: [] }),
  ).toHaveProperty("error");
});

test("traits.json の要素に名前か rect が無ければ、形の誤りにする", () => {
  expect(readTraits([{ name: "a", rect: rect([0, 0, 1, 1]) }], "current")).toEqual({
    entries: [{ name: "a", rect: rect([0, 0, 1, 1]) }],
  });
  expect(readTraits([{ rect: rect([0, 0, 1, 1]) }], "current")).toHaveProperty("error");
  expect(
    readTraits([{ name: "a", rect: { x: 0, y: 0, width: -1, height: 1 } }], "new"),
  ).toHaveProperty("error");
  expect(readTraits({}, "new")).toHaveProperty("error");
});

// --- CLI の粒度 ---

type Scene = {
  regions?: unknown;
  current?: unknown;
  next?: unknown;
  args?: string[];
};

function run(scene: Scene) {
  const dir = makeTempDir("region-names-");
  const regionsPath = join(dir, "crops.json");
  const currentPath = join(dir, "current-traits.json");
  const newPath = join(dir, "new-traits.json");
  writeFileSync(
    regionsPath,
    JSON.stringify(
      scene.regions ?? {
        regions: [{ id: 1, bbox: rect([10, 10, 4, 4]) }],
        strict_only_regions: [{ id: "s1", bbox: rect([100, 100, 4, 4]) }],
      },
    ),
  );
  if (scene.current !== undefined) writeFileSync(currentPath, JSON.stringify(scene.current));
  if (scene.next !== undefined) writeFileSync(newPath, JSON.stringify(scene.next));
  const res = spawnSync(
    process.execPath,
    [
      SCRIPT,
      regionsPath,
      "--current-traits",
      currentPath,
      "--new-traits",
      newPath,
      ...(scene.args ?? ["--scale", "1"]),
    ],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const TRAITS = [{ name: "save-button", rect: rect([8, 8, 10, 10]) }];

test("CLI: 両側の traits.json があれば exit 0 で、領域ごとに named と unnamed を出す", () => {
  const res = run({ current: TRAITS, next: TRAITS });
  expect(res.status).toBe(0);
  const out: unknown = JSON.parse(res.stdout);
  expect(out).toHaveProperty("traits", { current: "present", new: "present" });
  expect(out).toHaveProperty("summary", {
    regions: 2,
    named: 1,
    unnamed: 1,
    masked: 0,
    unknown: 0,
  });
  expect(out).toMatchObject({
    regions: [
      { id: 1, kind: "threshold", status: "named" },
      { id: "s1", kind: "strict_only", status: "unnamed" },
    ],
  });
});

test.each([
  ["現側", { next: TRAITS }, "traits_missing:current"],
  ["新側", { current: TRAITS }, "traits_missing:new"],
])(
  "CLI: %sの traits.json が無ければ、論理名と重ならない領域を unknown にして exit 1 で警告する",
  (_label, files, reason) => {
    const res = run(files);
    expect(res.status).toBe(1);
    const out: unknown = JSON.parse(res.stdout);
    expect(out).toHaveProperty(["regions", 1, "status"], "unknown");
    expect(out).toHaveProperty(["regions", 1, "unresolved"], [reason]);
    expect(out).toHaveProperty(["regions", 0, "status"], "named");
    expect(res.stderr).toContain("traits.json is missing");
  },
);

test("CLI: 両側とも traits.json が無ければ、すべての領域が unknown になる", () => {
  const res = run({});
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout)).toHaveProperty("summary", {
    regions: 2,
    named: 0,
    unnamed: 0,
    masked: 0,
    unknown: 2,
  });
});

test("CLI: マスクの論理名が traits.json に無ければ、論理名と重ならない領域を unknown にする", () => {
  const res = run({
    current: TRAITS,
    next: TRAITS,
    args: ["--scale", "1", "--mask-name", "account-id"],
  });
  expect(res.status).toBe(1);
  const out: unknown = JSON.parse(res.stdout);
  expect(out).toHaveProperty(
    ["masks", "unlocated"],
    [
      { name: "account-id", side: "current" },
      { name: "account-id", side: "new" },
    ],
  );
  expect(out).toHaveProperty(["regions", 1, "status"], "unknown");
  expect(res.stderr).toContain('mask "account-id"');
});

test("CLI: マスクの論理名を traits.json で見つけ、領域を覆えば masked にする", () => {
  const traits = [...TRAITS, { name: "account-id", rect: rect([90, 90, 30, 30]) }];
  const res = run({
    current: traits,
    next: traits,
    args: ["--scale", "1", "--mask-name", "account-id"],
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{}, { status: "masked", masks: ["account-id"], names: [] }],
  });
});

test("CLI: マスクの論理名の位置を片側でしか確かめられなければ、覆われた領域を masked にせず unknown にする", () => {
  const withMask = [...TRAITS, { name: "account-id", rect: rect([90, 90, 30, 30]) }];
  const res = run({
    current: withMask,
    next: TRAITS,
    args: ["--scale", "1", "--mask-name", "account-id"],
  });
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [
      {},
      { status: "unknown", masks: ["account-id"], unresolved: ["mask_unlocated:new:account-id"] },
    ],
  });
});

test("CLI: --mask-bbox で渡した画素の矩形も、マスクとして扱う", () => {
  const res = run({
    current: TRAITS,
    next: TRAITS,
    args: ["--scale", "1", "--mask-bbox", "96,96,20,20"],
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{}, { status: "masked", masks: ["96,96,20,20"] }],
  });
});

test.each([
  ["--scale が無い", { current: TRAITS, next: TRAITS, args: [] }, "usage"],
  ["--scale が 0", { current: TRAITS, next: TRAITS, args: ["--scale", "0"] }, "--scale"],
  [
    "--mask-bbox の幅が 0",
    { current: TRAITS, next: TRAITS, args: ["--scale", "1", "--mask-bbox", "1,1,0,1"] },
    "--mask-bbox",
  ],
  [
    "traits.json の形の誤り",
    { current: { name: "x" }, next: TRAITS },
    "current traits must be an array",
  ],
  [
    "crops の形の誤り",
    { regions: { regions: [] }, current: TRAITS, next: TRAITS },
    "strict_only_regions",
  ],
])("CLI: %s は exit 2", (_label, scene, message) => {
  const res = run(scene);
  expect(res.status).toBe(2);
  expect(res.stderr).toContain(message);
  expect(res.stdout).toBe("");
});
