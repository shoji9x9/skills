// region-names.mjs の回帰テスト（Issue #1018、#1025）。
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
// - mask-rects.json は、側ごとに、記録あり・無いと宣言・引数なし・形の誤り・パスの誤りである。
//   記録ありの側では、マスクの論理名が、矩形 1 つ・矩形が複数（1 つの名前が複数の要素に当たる）・空の rects・
//   面積が 0 の矩形だけ・記録に無い（traits.json から探す）、である。
//   両側の記録の組み合わせは、両側で同じ位置・両側で違う位置・片側だけ記録あり、である。
//   ほかの入力との組み合わせは、traits.json が無い側・--mask-bbox・--scale が 2 と 1.5、である。
//   記録の rects は、配列・null（iframe の中の要素）である。引数を渡さない側は、隣に mask-rects.json が在る・無い、である。
// - 座標の倍率（--scale）は、1・2 である。
// - 領域の種類は、regions・strict_only_regions である。
// - 引数は、必須の欠け・--scale が 0・--mask-bbox の形の誤りである。

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  classifyRegion,
  coveredByUnion,
  intersectionArea,
  overlappingNames,
  readMaskRects,
  readRegions,
  readTraits,
  snapMaskRect,
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
      // 関数を直接呼ぶテストでは、マスクを両側の同じ座標に当てる（--mask-bbox と同じ）。
      masks: (extra.masks ?? []).map((m) => ({
        label: m.label,
        bySide: { current: m.rects, new: m.rects },
      })),
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
  // mask-rects.json。undefined は引数を渡さない、null は無いことを宣言する、それ以外はファイルに書いて渡す。
  currentMask?: unknown;
  nextMask?: unknown;
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
  // traits.json を渡さない側は、無いことを宣言する引数で渡す。
  const sideArgs = (flag: string, path: string, value: unknown) => {
    if (value === undefined) return [`${flag}-missing`];
    writeFileSync(path, JSON.stringify(value));
    return [flag, path];
  };
  const maskArgs = (flag: string, path: string, value: unknown) => {
    if (value === undefined) return [];
    if (value === null) return [`${flag}-missing`];
    writeFileSync(path, JSON.stringify(value));
    return [flag, path];
  };
  const res = spawnSync(
    process.execPath,
    [
      SCRIPT,
      regionsPath,
      ...sideArgs("--current-traits", currentPath, scene.current),
      ...sideArgs("--new-traits", newPath, scene.next),
      ...maskArgs("--current-mask-rects", join(dir, "current-mask-rects.json"), scene.currentMask),
      ...maskArgs("--new-mask-rects", join(dir, "new-mask-rects.json"), scene.nextMask),
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
  // mask-rects.json の引数を渡さない呼び出しは、記録が無い側として扱う。
  expect(out).toHaveProperty("mask_rects", { current: "missing", new: "missing" });
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
      { name: "account-id", side: "current", reason: "absent" },
      { name: "account-id", side: "new", reason: "absent" },
    ],
  );
  expect(out).toHaveProperty(["regions", 1, "status"], "unknown");
  expect(res.stderr).toContain('mask "account-id" is not in the current traits.json');
});

test("CLI: マスクの論理名が traits.json にあっても面積が 0 なら、名前が無いのではなく面積が 0 だと出す", () => {
  const zero = [...TRAITS, { name: "account-id", rect: rect([90, 90, 0, 30]) }];
  const res = run({
    current: zero,
    next: zero,
    args: ["--scale", "1", "--mask-name", "account-id"],
  });
  expect(res.status).toBe(1);
  const out: unknown = JSON.parse(res.stdout);
  expect(out).toHaveProperty(["masks", "unlocated", 0, "reason"], "zero_area");
  expect(res.stderr).toContain('mask "account-id" has no area');
  expect(res.stderr).not.toContain("is not in the");
});

test("CLI: マスクの論理名の位置が両側で違えば、片側のマスクだけが覆う領域を masked にしない", () => {
  const current = [...TRAITS, { name: "ad", rect: rect([90, 90, 30, 30]) }];
  const next = [...TRAITS, { name: "ad", rect: rect([200, 200, 30, 30]) }];
  const res = run({ current, next, args: ["--scale", "1", "--mask-name", "ad"] });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{}, { status: "unnamed", masks: ["ad"] }],
  });
});

test("CLI: 標準入力は読まないので、- を入力のファイルとして受け付けない", () => {
  const dir = makeTempDir("region-names-stdin-");
  const traits = join(dir, "traits.json");
  writeFileSync(traits, JSON.stringify(TRAITS));
  const res = spawnSync(
    process.execPath,
    [SCRIPT, "-", "--current-traits", traits, "--new-traits", traits, "--scale", "1"],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS, input: "{}" },
  );
  expect(res.status).toBe(2);
  expect(res.stderr).not.toContain("not found");
  expect(res.stdout).toBe("");
});

test.each(["--current-traits", "--new-traits"])(
  "CLI: %s に - を渡すと、traits.json の無い組として扱わずに exit 2 にする",
  (flag) => {
    const dir = makeTempDir("region-names-dash-");
    const traits = join(dir, "traits.json");
    const crops = join(dir, "crops.json");
    writeFileSync(traits, JSON.stringify(TRAITS));
    writeFileSync(crops, JSON.stringify({ regions: [], strict_only_regions: [] }));
    const files: Record<string, string> = { "--current-traits": traits, "--new-traits": traits };
    files[flag] = "-";
    const res = spawnSync(
      process.execPath,
      [SCRIPT, crops, ...Object.entries(files).flat(), "--scale", "1"],
      { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("stdin is not read");
    expect(res.stdout).toBe("");
  },
);

test.each([
  [
    "パスのファイルが無い（綴りの誤り）",
    ["--current-traits", "TYPO", "--new-traits", "TRAITS"],
    "cannot read",
  ],
  [
    "パスと無いことの宣言の両方",
    ["--current-traits", "TRAITS", "--current-traits-missing", "--new-traits", "TRAITS"],
    "exactly one",
  ],
  ["パスも無いことの宣言も無い", ["--new-traits", "TRAITS"], "exactly one"],
])(
  "CLI: traits.json の指定が %s なら、無い組として扱わずに exit 2 にする",
  (_label, args, message) => {
    const dir = makeTempDir("region-names-sidearg-");
    const traits = join(dir, "traits.json");
    const crops = join(dir, "crops.json");
    writeFileSync(traits, JSON.stringify(TRAITS));
    writeFileSync(crops, JSON.stringify({ regions: [], strict_only_regions: [] }));
    const resolved = args.map((a) =>
      a === "TRAITS" ? traits : a === "TYPO" ? join(dir, "traits.jsno") : a,
    );
    const res = spawnSync(process.execPath, [SCRIPT, crops, ...resolved, "--scale", "1"], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain(message);
    expect(res.stdout).toBe("");
  },
);

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

test("mask-rects.json の要素の形が違うか、同じ名前を 2 回記録していれば、形の誤りにする", () => {
  expect(
    readMaskRects(
      [
        { name: "a", rects: [rect([1, 2, 3, 4]), rect([5, 6, 7, 8])] },
        { name: "b", rects: [] },
      ],
      "current",
    ),
  ).toEqual({
    byName: new Map([
      ["a", [rect([1, 2, 3, 4]), rect([5, 6, 7, 8])]],
      ["b", []],
    ]),
  });
  expect(readMaskRects({ a: [] }, "new")).toHaveProperty("error");
  expect(readMaskRects([{ name: "a", rects: null }], "new")).toEqual({
    byName: new Map([["a", null]]),
  });
  expect(readMaskRects([{ rects: [] }], "new")).toHaveProperty("error");
  expect(readMaskRects([{ name: "", rects: [] }], "new")).toHaveProperty("error");
  expect(readMaskRects([{ name: "a" }], "new")).toHaveProperty("error");
  expect(
    readMaskRects([{ name: "a", rects: [{ x: 0, y: 0, width: -1, height: 1 }] }], "new"),
  ).toHaveProperty("error");
  expect(
    readMaskRects(
      [
        { name: "a", rects: [] },
        { name: "a", rects: [rect([0, 0, 1, 1])] },
      ],
      "current",
    ),
  ).toHaveProperty("error", 'current mask rects[1]: "a" is recorded twice');
});

// --- CLI の粒度: mask-rects.json（Issue #1025） ---

// どの論理名とも重ならない領域 s1（100,100 の 4×4）から遠い位置のマスク。traits.json にはマスクの名前が無い。
const FAR_MASK = [{ name: "account-id", rects: [rect([300, 300, 20, 20])] }];
// 領域 s1 を覆うマスク。
const COVER_MASK = [{ name: "account-id", rects: [rect([90, 90, 30, 30])] }];
const MASK_ARGS = ["--scale", "1", "--mask-name", "account-id"];

test("CLI: 両側の mask-rects.json がマスクの位置を記録していれば、マスクから遠く論理名と重ならない領域は unnamed になる", () => {
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: FAR_MASK,
    nextMask: FAR_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  const out: unknown = JSON.parse(res.stdout);
  expect(out).toHaveProperty("mask_rects", { current: "present", new: "present" });
  expect(out).toHaveProperty(["masks", "unlocated"], []);
  expect(out).toMatchObject({
    regions: [
      { id: 1, status: "named", unresolved: [] },
      { id: "s1", status: "unnamed", masks: [], unresolved: [] },
    ],
  });
  expect(res.stderr).toBe("");
});

test("CLI: 両側の mask-rects.json がマスクの位置を記録していれば、traits.json に名前が無くてもマスクの中の領域を masked にする", () => {
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: COVER_MASK,
    nextMask: COVER_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    masks: { unlocated: [] },
    regions: [{}, { status: "masked", masks: ["account-id"], names: [], unresolved: [] }],
  });
});

test("CLI: mask-rects.json の位置が両側で違えば、片側のマスクだけが覆う領域を masked にしない", () => {
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: COVER_MASK,
    nextMask: FAR_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{}, { status: "unnamed", masks: ["account-id"], unresolved: [] }],
  });
});

test.each([
  ["無いと宣言した", null],
  ["引数を渡さない", undefined],
])(
  "CLI: 片側だけ mask-rects.json が記録し、もう片側は%s側で traits.json に名前が無ければ、もう片側を mask_unlocated にする",
  (_label, nextMask) => {
    const res = run({
      current: TRAITS,
      next: TRAITS,
      currentMask: COVER_MASK,
      nextMask,
      args: MASK_ARGS,
    });
    expect(res.status).toBe(1);
    const out: unknown = JSON.parse(res.stdout);
    expect(out).toHaveProperty("mask_rects", { current: "present", new: "missing" });
    expect(out).toHaveProperty(
      ["masks", "unlocated"],
      [{ name: "account-id", side: "new", reason: "absent" }],
    );
    expect(out).toMatchObject({
      regions: [
        {},
        { status: "unknown", masks: ["account-id"], unresolved: ["mask_unlocated:new:account-id"] },
      ],
    });
    expect(res.stderr).toContain('mask "account-id" is not in the new traits.json;');
  },
);

test("CLI: 両側とも mask-rects.json が無いと宣言すれば、traits.json だけで判定し、マスクの名前が無ければ mask_unlocated と unknown を出す", () => {
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: null,
    nextMask: null,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(1);
  const out: unknown = JSON.parse(res.stdout);
  expect(out).toHaveProperty("mask_rects", { current: "missing", new: "missing" });
  expect(out).toHaveProperty(
    ["masks", "unlocated"],
    [
      { name: "account-id", side: "current", reason: "absent" },
      { name: "account-id", side: "new", reason: "absent" },
    ],
  );
  expect(out).toHaveProperty(["regions", 1, "status"], "unknown");
});

test("CLI: 1 つの名前が複数の要素に当たるマスクは、記録したすべての矩形の和で覆うかを決める", () => {
  // 領域 s1（x が 100〜104）を、左の矩形（〜102）と右の矩形（102〜）の和だけが覆う。
  const split = [{ name: "account-id", rects: [rect([90, 90, 12, 30]), rect([102, 90, 20, 30])] }];
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: split,
    nextMask: split,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{}, { status: "masked", masks: ["account-id"] }],
  });
});

test.each([
  ["空の rects（ロケータが 0 件に当たった）", []],
  ["面積が 0 の矩形だけ", [rect([100, 100, 0, 10])]],
])(
  "CLI: mask-rects.json の記録が%sなら、その側ではマスクが何も塗らなかったとして扱い、mask_unlocated を出さない",
  (_label, rects) => {
    const res = run({
      current: TRAITS,
      next: TRAITS,
      currentMask: [{ name: "account-id", rects }],
      nextMask: COVER_MASK,
      args: MASK_ARGS,
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      masks: { unlocated: [] },
      regions: [{}, { status: "unnamed", masks: ["account-id"], unresolved: [] }],
    });
  },
);

test("CLI: mask-rects.json に名前が無ければ、その側は traits.json から探し、無ければ mask_unlocated を出す", () => {
  const other = [{ name: "ad", rects: [rect([300, 300, 20, 20])] }];
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: other,
    nextMask: COVER_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout)).toMatchObject({
    masks: { unlocated: [{ name: "account-id", side: "current", reason: "absent" }] },
    regions: [{}, { status: "unknown", unresolved: ["mask_unlocated:current:account-id"] }],
  });
  expect(res.stderr).toContain("(not recorded in the current mask-rects.json)");
  expect(res.stderr).toContain('current mask-rects.json records "ad", which is not given');
});

test("CLI: mask-rects.json に名前が無くても、traits.json にあればその rect をマスクの位置にする", () => {
  const traits = [...TRAITS, { name: "account-id", rect: rect([90, 90, 30, 30]) }];
  const res = run({
    current: traits,
    next: TRAITS,
    currentMask: [],
    nextMask: COVER_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    masks: { unlocated: [] },
    regions: [{}, { status: "masked" }],
  });
});

test("CLI: mask-rects.json の矩形にも --scale を掛けて比べる", () => {
  // CSS の px で (45,45) から 15×15。--scale 2 で画像の画素の (90,90) から 30×30 になり、領域 s1 を覆う。
  const half = [{ name: "account-id", rects: [rect([45, 45, 15, 15])] }];
  const res = run({
    current: [],
    next: [],
    currentMask: half,
    nextMask: half,
    args: ["--scale", "2", "--mask-name", "account-id"],
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{ status: "unnamed" }, { status: "masked" }],
  });
});

test("CLI: traits.json が無い側でも、mask-rects.json の記録でマスクの中の領域を masked にする", () => {
  const res = run({
    next: TRAITS,
    currentMask: COVER_MASK,
    nextMask: COVER_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    masks: { unlocated: [] },
    regions: [{ status: "named" }, { status: "masked", unresolved: ["traits_missing:current"] }],
  });
});

test("CLI: --mask-bbox と mask-rects.json のマスクは、側ごとの和で覆うかを決める", () => {
  // 領域 s1（x が 100〜104）を、記録した矩形（〜102）と --mask-bbox（102〜）の和だけが覆う。
  const left = [{ name: "account-id", rects: [rect([90, 90, 12, 30])] }];
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: left,
    nextMask: left,
    args: [...MASK_ARGS, "--mask-bbox", "102,90,20,30"],
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [{}, { status: "masked", masks: ["account-id", "102,90,20,30"] }],
  });
});

test.each([
  [
    "パスと無いことの宣言の両方",
    ["--current-mask-rects", "MASK", "--current-mask-rects-missing"],
    "at most one",
  ],
  ["- を渡す", ["--new-mask-rects", "-"], "stdin is not read"],
  ["パスのファイルが無い（綴りの誤り）", ["--new-mask-rects", "TYPO"], "cannot read"],
  ["形の誤り", ["--current-mask-rects", "BAD"], "current mask rects must be an array"],
])(
  "CLI: mask-rects.json の指定が%sなら、記録の無い側として扱わずに exit 2 にする",
  (_label, args, message) => {
    const dir = makeTempDir("region-names-maskarg-");
    const traits = join(dir, "traits.json");
    const crops = join(dir, "crops.json");
    const mask = join(dir, "mask-rects.json");
    const bad = join(dir, "bad.json");
    writeFileSync(traits, JSON.stringify(TRAITS));
    writeFileSync(crops, JSON.stringify({ regions: [], strict_only_regions: [] }));
    writeFileSync(mask, JSON.stringify(COVER_MASK));
    writeFileSync(bad, JSON.stringify({ name: "account-id" }));
    const resolved = args.map((a) =>
      a === "MASK" ? mask : a === "BAD" ? bad : a === "TYPO" ? join(dir, "mask-rects.jsno") : a,
    );
    const res = spawnSync(
      process.execPath,
      [
        SCRIPT,
        crops,
        "--current-traits",
        traits,
        "--new-traits",
        traits,
        ...resolved,
        ...MASK_ARGS,
      ],
      { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toContain(message);
    expect(res.stdout).toBe("");
  },
);

test("記録したマスクの矩形の縁は、CSS の px の整数に四捨五入する（Chromium の mask が塗る画素）", () => {
  // 実測した要素の矩形と、mask が塗った位置（deviceScaleFactor 1）。
  expect(snapMaskRect({ x: 10.5, y: 1200.25, width: 20.5, height: 10.5 })).toEqual(
    rect([11, 1200, 20, 11]),
  );
  expect(snapMaskRect({ x: 33.3, y: 1250.7, width: 7.4, height: 5.6 })).toEqual(
    rect([33, 1251, 8, 5]),
  );
  expect(snapMaskRect({ x: 5, y: 5, width: 0.4, height: 3 })).toEqual(rect([5, 5, 0, 3]));
});

test("CLI: mask-rects.json の小数の縁は、四捨五入した位置で覆うかを決める", () => {
  // 縁を四捨五入すると (90,100) から 30×30 になり、領域 s1（100,100 の 4×4）を覆う。
  // 四捨五入しないと、y が 100〜100.25 の帯が覆われていないと判定される。
  const fractional = [
    { name: "account-id", rects: [{ x: 89.6, y: 100.25, width: 30, height: 29.5 }] },
  ];
  const res = run({
    current: TRAITS,
    next: TRAITS,
    currentMask: fractional,
    nextMask: fractional,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({ regions: [{}, { status: "masked" }] });
});

test("CLI: iframe の中の要素なので矩形を記録できなかった名前（rects: null）は、traits.json を探さず in_frame として位置が分からないマスクにする", () => {
  // traits.json の rect は iframe の中の座標なので、名前が在っても画像の位置として使わない。
  const traits = [...TRAITS, { name: "account-id", rect: rect([90, 90, 30, 30]) }];
  const res = run({
    current: traits,
    next: traits,
    currentMask: [{ name: "account-id", rects: null }],
    nextMask: COVER_MASK,
    args: MASK_ARGS,
  });
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout)).toMatchObject({
    masks: { unlocated: [{ name: "account-id", side: "current", reason: "in_frame" }] },
    regions: [{}, { status: "unknown", unresolved: ["mask_unlocated:current:account-id"] }],
  });
  expect(res.stderr).toContain('mask "account-id" is in an iframe');
});

// 現側と新側の traits.json を別のディレクトリに置き、mask-rects.json をその隣に置くかを選ぶ。
function runWithSiblings(opts: { siblings: boolean; extra?: string[] }) {
  const dir = makeTempDir("region-names-sibling-");
  const crops = join(dir, "crops.json");
  writeFileSync(
    crops,
    JSON.stringify({
      regions: [{ id: 1, bbox: rect([10, 10, 4, 4]) }],
      strict_only_regions: [{ id: "s1", bbox: rect([100, 100, 4, 4]) }],
    }),
  );
  const paths: string[] = [];
  for (const side of ["current", "new"]) {
    const sideDir = join(dir, side);
    mkdirSync(sideDir);
    writeFileSync(join(sideDir, "traits.json"), JSON.stringify(TRAITS));
    if (opts.siblings) writeFileSync(join(sideDir, "mask-rects.json"), JSON.stringify(FAR_MASK));
    paths.push(`--${side}-traits`, join(sideDir, "traits.json"));
  }
  const res = spawnSync(
    process.execPath,
    [SCRIPT, crops, ...paths, ...MASK_ARGS, ...(opts.extra ?? [])],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("CLI: mask-rects.json の引数を渡さない側は、traits.json の隣の mask-rects.json を読む", () => {
  const res = runWithSiblings({ siblings: true });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    mask_rects: { current: "present", new: "present" },
    masks: { unlocated: [] },
    regions: [{}, { status: "unnamed", unresolved: [] }],
  });
});

test("CLI: 隣に mask-rects.json があっても、無いと宣言した側では読まない", () => {
  const res = runWithSiblings({ siblings: true, extra: ["--current-mask-rects-missing"] });
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout)).toMatchObject({
    mask_rects: { current: "missing", new: "present" },
    masks: { unlocated: [{ name: "account-id", side: "current", reason: "absent" }] },
  });
});

test("CLI: 引数を渡さず、traits.json の隣に mask-rects.json も無い側は、記録の無い側として扱う", () => {
  const res = runWithSiblings({ siblings: false });
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout)).toMatchObject({
    mask_rects: { current: "missing", new: "missing" },
    regions: [{}, { status: "unknown" }],
  });
});

test("CLI: deviceScaleFactor が 1.5 で縁が半画素になるとき、塗られた画素は覆い、半分だけ覆う縁の画素は覆わない", () => {
  // CSS の px で (11,10) から 20×10。--scale 1.5 で画像の画素の (16.5,15)〜(46.5,30) になる。
  // Chromium の mask は x が 17〜45 の画素を塗る（実測）。x が 16 と 46 の画素は半分しか覆われない。
  const mask = [{ name: "account-id", rects: [rect([11, 10, 20, 10])] }];
  const res = run({
    regions: {
      regions: [
        { id: "inside", bbox: rect([17, 15, 29, 15]) },
        { id: "left-edge", bbox: rect([16, 15, 1, 15]) },
        { id: "right-edge", bbox: rect([46, 15, 1, 15]) },
      ],
      strict_only_regions: [],
    },
    current: [],
    next: [],
    currentMask: mask,
    nextMask: mask,
    args: ["--scale", "1.5", "--mask-name", "account-id"],
  });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: [
      { id: "inside", status: "masked" },
      { id: "left-edge", status: "unnamed" },
      { id: "right-edge", status: "unnamed" },
    ],
  });
});
