// 部品改修後の撮り直しの機械判定（parity-diff 同梱 amend-verify.mjs）の回帰テスト（#454）。
// pngjs はこのリポジトリに入れないため、判定は純関数 judgePair で測り、CLI は入力不備（exit 2）の経路だけを測る。

import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const verify = await import(join(repoRoot, "skills/parity-diff/scripts/amend-verify.mjs"));

const pngjsAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve("pngjs");
    return true;
  } catch {
    return false;
  }
})();

/** 単色の画像を作る。 */
function solid(width, height, rgba) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return { width, height, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: Uint8Array.from(img.data) };
}

function setPixel(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

const WHITE = [255, 255, 255, 255];
const GREY = [128, 128, 128, 255];
const BLACK = [0, 0, 0, 255];

// 10x10。現行は (4,4) が灰。改修前の新側は白（1 画素違う）。
function scene() {
  const current = solid(10, 10, WHITE);
  setPixel(current, 4, 4, GREY);
  const prevNew = solid(10, 10, WHITE);
  return { current, prevNew };
}

const region = { x: 3, y: 3, width: 3, height: 3 };

test("領域の中が現行に近づき、外が変わらなければ pass", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  setPixel(next, 4, 4, GREY);

  const r = verify.judgePair({ prevNew, next, current, regions: [region] });

  expect(r.pass).toBe(true);
  expect(r.outside_identical).toBe(true);
  expect(r.outside_diff_pixels).toBe(0);
  expect(r.inside_diff_before).toBe(1);
  expect(r.inside_diff_after).toBe(0);
  expect(r.reasons).toEqual([]);
});

test("領域の中が同数（悪化していない）なら pass", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  // 違う画素へ差が移っただけ（数は同じ）。
  setPixel(next, 4, 4, GREY);
  setPixel(next, 5, 5, BLACK);

  const r = verify.judgePair({ prevNew, next, current, regions: [region] });

  expect(r.inside_diff_before).toBe(1);
  expect(r.inside_diff_after).toBe(1);
  expect(r.pass).toBe(true);
});

test("領域の中で現行との不一致が増えたら fail", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  setPixel(next, 3, 3, BLACK);

  const r = verify.judgePair({ prevNew, next, current, regions: [region] });

  expect(r.pass).toBe(false);
  expect(r.outside_identical).toBe(true);
  expect(r.inside_diff_before).toBe(1);
  expect(r.inside_diff_after).toBe(2);
  expect(r.reasons.join("\n")).toMatch(/grew: 1 -> 2/);
});

test("領域の外が 1 画素でも変われば、その数を出して fail", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  setPixel(next, 4, 4, GREY);
  setPixel(next, 0, 0, BLACK);
  setPixel(next, 9, 9, [255, 255, 254, 255]);

  const r = verify.judgePair({ prevNew, next, current, regions: [region] });

  expect(r.pass).toBe(false);
  expect(r.outside_identical).toBe(false);
  expect(r.outside_diff_pixels).toBe(2);
  expect(r.reasons.join("\n")).toMatch(/2 pixels changed outside/);
});

test("領域の外は隠れた RGB の違い（両側とも透明）も差にする", () => {
  const prevNew = solid(4, 4, [10, 20, 30, 0]);
  const next = clone(prevNew);
  setPixel(next, 0, 0, [90, 80, 70, 0]);
  const current = clone(prevNew);

  const r = verify.judgePair({
    prevNew,
    next,
    current,
    regions: [{ x: 3, y: 3, width: 1, height: 1 }],
  });

  expect(r.outside_diff_pixels).toBe(1);
  expect(r.pass).toBe(false);
});

test("領域の中の現行との比較は、両側とも完全な透明なら差にしない（pixel-strict-count と同じ）", () => {
  const current = solid(2, 2, [1, 2, 3, 0]);
  const prevNew = solid(2, 2, [9, 9, 9, 0]);
  const next = clone(prevNew);

  const r = verify.judgePair({
    prevNew,
    next,
    current,
    regions: [{ x: 0, y: 0, width: 2, height: 2 }],
  });

  expect(r.inside_diff_before).toBe(0);
  expect(r.inside_diff_after).toBe(0);
  expect(r.pass).toBe(true);
});

test("prev-new と new の寸法が違えば fail（外の一致を示せない）", () => {
  const { current, prevNew } = scene();
  const next = solid(10, 11, WHITE);

  const r = verify.judgePair({ prevNew, next, current, regions: [region] });

  expect(r.pass).toBe(false);
  expect(r.outside_diff_pixels).toBeNull();
  expect(r.reasons.join("\n")).toMatch(/dimensions changed: prev-new 10x10 vs new 10x11/);
});

test("current の寸法が new と違えば fail", () => {
  const { prevNew } = scene();
  const current = solid(11, 10, WHITE);
  const next = clone(prevNew);

  const r = verify.judgePair({ prevNew, next, current, regions: [region] });

  expect(r.pass).toBe(false);
  expect(r.inside_diff_after).toBeNull();
  expect(r.reasons.join("\n")).toMatch(/current dimensions differ from new: 11x10 vs 10x10/);
});

test("margin で領域を広げる（広げた分の変化は外に数えない）", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  setPixel(next, 4, 4, GREY);
  // 影の外周: 矩形 (3,3)-(5,5) の 1px 外側。
  setPixel(next, 2, 4, [250, 250, 250, 255]);
  setPixel(next, 6, 4, [250, 250, 250, 255]);
  setPixel(current, 2, 4, [250, 250, 250, 255]);
  setPixel(current, 6, 4, [250, 250, 250, 255]);

  const without = verify.judgePair({ prevNew, next, current, regions: [region] });
  const withMargin = verify.judgePair({ prevNew, next, current, regions: [region], margin: 1 });

  expect(without.outside_diff_pixels).toBe(2);
  expect(without.pass).toBe(false);
  expect(withMargin.outside_diff_pixels).toBe(0);
  expect(withMargin.regions).toEqual([{ x: 2, y: 2, width: 5, height: 5 }]);
  expect(withMargin.inside_diff_before).toBe(3);
  expect(withMargin.inside_diff_after).toBe(0);
  expect(withMargin.pass).toBe(true);
});

test("複数の領域は和集合で扱う", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  setPixel(next, 4, 4, GREY);
  setPixel(next, 8, 1, BLACK);
  setPixel(current, 8, 1, BLACK);
  const second = { x: 8, y: 1, width: 1, height: 1 };

  const one = verify.judgePair({ prevNew, next, current, regions: [region] });
  const both = verify.judgePair({ prevNew, next, current, regions: [region, second] });

  expect(one.outside_diff_pixels).toBe(1);
  expect(both.outside_diff_pixels).toBe(0);
  expect(both.inside_diff_before).toBe(2);
  expect(both.inside_diff_after).toBe(0);
  expect(both.regions).toHaveLength(2);
  expect(both.pass).toBe(true);
});

test("画像の範囲に切り詰める・小数の矩形は外側へ丸める", () => {
  expect(verify.expandRegion({ x: -3, y: 8, width: 5, height: 10 }, 2, 10, 10)).toEqual({
    x: 0,
    y: 6,
    width: 4,
    height: 4,
  });
  expect(verify.expandRegion({ x: 1.5, y: 2.2, width: 2, height: 1.1 }, 0, 10, 10)).toEqual({
    x: 1,
    y: 2,
    width: 3,
    height: 2,
  });
  expect(verify.expandRegion({ x: 20, y: 0, width: 5, height: 5 }, 1, 10, 10)).toBeNull();
});

test("切り詰めた領域はマスクと記録に反映され、画像と重ならない領域だけなら fail", () => {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  setPixel(next, 9, 9, BLACK);

  const edge = verify.judgePair({
    prevNew,
    next,
    current,
    regions: [{ x: 8, y: 8, width: 10, height: 10 }],
  });
  const off = verify.judgePair({
    prevNew,
    next,
    current,
    regions: [{ x: 50, y: 50, width: 3, height: 3 }],
  });

  expect(edge.regions).toEqual([{ x: 8, y: 8, width: 2, height: 2 }]);
  expect(edge.outside_diff_pixels).toBe(0);
  expect(off.pass).toBe(false);
  expect(off.reasons.join("\n")).toMatch(/no region overlaps the image/);
});

test.each([
  ["1,2,3,4", { x: 1, y: 2, width: 3, height: 4 }],
  ["-1.5,0,2,2", { x: -1.5, y: 0, width: 2, height: 2 }],
  ["1,2,3", null],
  ["1,2,0,4", null],
  ["1,2,3,-4", null],
  ["a,2,3,4", null],
  ["1,,3,4", null],
])("parseRegion(%s)", (text, expected) => {
  expect(verify.parseRegion(text)).toEqual(expected);
});

test("regionFromJson は配列とオブジェクトを読み、欠けたものは null", () => {
  expect(verify.regionFromJson([1, 2, 3, 4])).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  expect(verify.regionFromJson({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
    x: 1,
    y: 2,
    width: 3,
    height: 4,
  });
  expect(verify.regionFromJson({ x: 1, y: 2, width: 3 })).toBeNull();
  expect(verify.regionFromJson("1,2,3,4")).toBeNull();
});

test("sha256File はファイル内容の sha256 を返す", () => {
  const dir = makeTempDir("amend-verify-");
  const path = join(dir, "x.bin");
  writeFileSync(path, "abc");
  expect(verify.sha256File(path)).toBe(createHash("sha256").update("abc").digest("hex"));
});

test("mergeRecord は同じ pair id の組を置き換え、新しい組を末尾に足す", () => {
  const existing = {
    tool: "amend-verify",
    version: "0",
    change_id: "c1",
    pairs: [
      { pair: "a|hover|desktop", pass: false },
      { pair: "b|hover|desktop", pass: true },
    ],
  };

  const merged = verify.mergeRecord(
    existing,
    [
      { pair: "a|hover|desktop", pass: true },
      { pair: "c|hover|desktop", pass: true },
    ],
    undefined,
  );

  expect(merged.version).toBe(verify.VERSION);
  expect(merged.change_id).toBe("c1");
  expect(merged.pairs).toEqual([
    { pair: "a|hover|desktop", pass: true },
    { pair: "b|hover|desktop", pass: true },
    { pair: "c|hover|desktop", pass: true },
  ]);
  expect(verify.mergeRecord(null, [], undefined)).not.toHaveProperty("change_id");
});

// 終了コードだけでは弁別できない（この環境には pngjs が無く、どの入力不備も exit 2 になりうる）。
// 落ちた理由（stderr）まで固定する。
async function run(argv) {
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    const code = await verify.main(argv);
    return { code, stderr: written.join("") };
  } finally {
    process.stderr.write = original;
  }
}

const base = [
  "--pair",
  "p|hover|desktop",
  "--prev-new",
  "a.png",
  "--new",
  "b.png",
  "--current",
  "c.png",
];

test.each([
  ["領域が無い", base, /at least one --region is required/],
  ["領域の幅が 0", [...base, "--region", "1,1,0,3"], /--region must be x,y,w,h/],
  ["領域が読めない", [...base, "--region", "1,1,3"], /--region must be x,y,w,h/],
  [
    "--new が無い",
    ["--pair", "p", "--prev-new", "a.png", "--current", "c.png", "--region", "0,0,1,1"],
    /--new is required/,
  ],
  ["値が無い", [...base, "--region"], /--region requires a value/],
  ["値が空白だけ", [...base, "--region", "  "], /--region requires a value/],
  [
    "margin が負",
    [...base, "--region", "0,0,1,1", "--margin", "-1"],
    /--margin must be a non-negative number/,
  ],
  ["知らない引数", [...base, "--region", "0,0,1,1", "--foo", "x"], /unknown argument: --foo/],
  ["--pairs と --pair の併用", ["--pairs", "x.json", "--pair", "p"], /cannot be combined/],
])("%s なら exit 2（その理由で落ちる）", async (_name, argv, message) => {
  const { code, stderr } = await run(argv);

  expect(code).toBe(2);
  expect(stderr).toMatch(message);
});

test.each([
  ["空の配列", [], /non-empty JSON array/],
  [
    "領域が空",
    [{ pair: "p", prev_new: "a", new: "b", current: "c", regions: [] }],
    /regions must be a non-empty array/,
  ],
  [
    "領域が読めない",
    [{ pair: "p", prev_new: "a", new: "b", current: "c", regions: [[1, 2]] }],
    /unreadable region/,
  ],
  [
    "current が無い",
    [{ pair: "p", prev_new: "a", new: "b", regions: [[0, 0, 1, 1]] }],
    /current must be a non-empty string/,
  ],
  [
    "pair id の重複",
    [
      { pair: "p", prev_new: "a", new: "b", current: "c", regions: [[0, 0, 1, 1]] },
      { pair: "p", prev_new: "a", new: "b", current: "c", regions: [[0, 0, 1, 1]] },
    ],
    /pair is duplicated/,
  ],
])("--pairs が %s なら exit 2", async (_name, list, message) => {
  const dir = makeTempDir("amend-verify-");
  const path = join(dir, "pairs.json");
  writeFileSync(path, JSON.stringify(list));

  const { code, stderr } = await run(["--pairs", path]);

  expect(code).toBe(2);
  expect(stderr).toMatch(message);
});

test("--out の既存記録が別の change_id なら exit 2（別の変更宣言の記録へ混ぜない）", async () => {
  const dir = makeTempDir("amend-verify-");
  const out = join(dir, "record.json");
  const before = JSON.stringify({
    tool: "amend-verify",
    version: "1",
    change_id: "old",
    pairs: [],
  });
  writeFileSync(out, before);

  const { code, stderr } = await run([
    ...base,
    "--region",
    "0,0,1,1",
    "--change-id",
    "new",
    "--out",
    out,
  ]);

  expect(code).toBe(2);
  expect(stderr).toMatch(/differs from the existing record's change_id old/);
  expect(readFileSync(out, "utf8")).toBe(before);
});

test.skipIf(pngjsAvailable)(
  "pngjs が無ければ導入を促して exit 2（勝手にインストールしない）",
  async () => {
    const { code, stderr } = await run([...base, "--region", "0,0,1,1"]);

    expect(code).toBe(2);
    expect(stderr).toMatch(/pngjs is not installed/);
  },
);
