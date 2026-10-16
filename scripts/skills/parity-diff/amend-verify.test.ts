// 部品改修後の撮り直しの機械判定（parity-diff 同梱 amend-verify.mjs）の回帰テスト（#454）。
// 判定の規則は judgePair で測る。judgePair は SKILL の references/component-change.md が決める合格の条件を、
// デコード済みの画像に当てる関数である。
// 領域の読み方（parseRegion・regionFromJson・expandRegion）と記録の合わせ方（mergeRecord）も、純関数を直接呼んで測る。
// 戻り値は、記録の declared_regions・regions・pairs と同じ意味を持つ。
// pngjs はこのリポジトリに入れない。CLI の記録（--out・stdout）と終了コードは、子プロセスの Node に
// resolve の Hook（scripts/lib/testing/fake-pngjs-hooks.ts）を登録し、"pngjs" を PNG を読み書きする偽物に差し替えて確かめる。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { encodePng } from "../../lib/testing/fake-pngjs.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import * as verify from "../../../skills/parity-diff/scripts/amend-verify.mjs";
import type { Image } from "../../../skills/parity-diff/scripts/amend-verify.mjs";

const pngjsAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve("pngjs");
    return true;
  } catch {
    return false;
  }
})();

/** 単色の画像を作る。 */
function solid(width: number, height: number, rgba: number[]): Image {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return { width, height, data };
}

function clone(img: Image): Image {
  return { width: img.width, height: img.height, data: Uint8Array.from(img.data) };
}

function setPixel(img: Image, x: number, y: number, rgba: number[]) {
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

// 終了コードだけでは区別できない（この環境には pngjs が無く、どの入力不備も exit 2 になりうる）。
// 落ちた理由（stderr）まで固定する。
async function run(argv: string[]) {
  const written: string[] = [];
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
  // object でない要素は、欠けた欄の名前ではなく、要素そのものの形の誤りとして報告する。
  ["要素が null", [null], /--pairs\[0\] must be an object/],
  ["要素が数", [1], /--pairs\[0\] must be an object/],
  ["要素が配列", [["a", "b"]], /--pairs\[0\] must be an object/],
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
    "margin が負",
    [{ pair: "p", prev_new: "a", new: "b", current: "c", regions: [[0, 0, 1, 1]], margin: -1 }],
    /margin must be a non-negative number/,
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

test("--pairs が読めなければ exit 2", async () => {
  const dir = makeTempDir("amend-verify-");

  const { code, stderr } = await run(["--pairs", join(dir, "missing.json")]);

  expect(code).toBe(2);
  expect(stderr).toMatch(/cannot read --pairs/);
});

test("--pairs の組の margin が --margin と食い違えば exit 2（どちらで判定したかが曖昧になる）", async () => {
  const dir = makeTempDir("amend-verify-");
  const path = join(dir, "pairs.json");
  const item = { pair: "p", prev_new: "a", new: "b", current: "c", regions: [[0, 0, 1, 1]] };
  writeFileSync(path, JSON.stringify([{ ...item, margin: 2 }]));

  const { code, stderr } = await run(["--pairs", path, "--margin", "1"]);

  expect(code).toBe(2);
  expect(stderr).toMatch(/margin \(2\) conflicts with --margin \(1\)/);
});

test.each([
  ["JSON として読めない", "{", /cannot read existing --out record/],
  ["pairs が配列でない", JSON.stringify({ tool: "amend-verify", pairs: {} }), /has no pairs array/],
  ["object でない", JSON.stringify([]), /has no pairs array/],
])("--out の既存の記録が %s なら exit 2 で、記録を書き換えない", async (_name, before, message) => {
  const dir = makeTempDir("amend-verify-");
  const out = join(dir, "record.json");
  writeFileSync(out, before);

  const { code, stderr } = await run([...base, "--region", "0,0,1,1", "--out", out]);

  expect(code).toBe(2);
  expect(stderr).toMatch(message);
  expect(readFileSync(out, "utf8")).toBe(before);
});

// --- pngjs を偽のモジュールに差し替えて、CLI の記録と終了コードを確かめる ---

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-diff/scripts/amend-verify.mjs");
const HOOKS = fileURLToPath(new URL("../../lib/testing/fake-pngjs-hooks.ts", import.meta.url));

/** 画像を PNG で書く。 */
function writeImage(path: string, img: Image) {
  writeFileSync(path, encodePng(img.width, img.height, Uint8Array.from(img.data)));
}

/** scene() の 3 枚を書き、パスを返す。nextChange で撮り直した新側を変える。 */
function writeScene(dir: string, nextChange: (next: Image) => void = () => {}) {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  nextChange(next);
  const paths = {
    prev_new: join(dir, "prev-new.png"),
    new: join(dir, "new.png"),
    current: join(dir, "current.png"),
  };
  writeImage(paths.prev_new, prevNew);
  writeImage(paths.new, next);
  writeImage(paths.current, current);
  return paths;
}

function singleArgs(paths: ReturnType<typeof writeScene>, pair = "p|hover|desktop") {
  return [
    "--pair",
    pair,
    "--prev-new",
    paths.prev_new,
    "--new",
    paths.new,
    "--current",
    paths.current,
  ];
}

/** 偽の pngjs で CLI を子プロセスとして実行する（計測の環境変数は親から引き継ぐ）。 */
function runCli(argv: string[]) {
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(HOOKS).href, script, ...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

type PairRecord = {
  pair: string;
  pass: boolean;
  outside_diff_pixels: number | null;
  inside_diff_before: number | null;
  inside_diff_after: number | null;
  margin: number;
  declared_regions: unknown[];
  regions: unknown[];
  inputs: Record<string, { path: string; sha256: string }>;
  reasons: string[];
};
type AmendRecord = { tool: string; version: string; change_id?: string; pairs: PairRecord[] };

const parseRecord = (text: string) => parseJsonAs<AmendRecord>(text);

test("CLI: 全組 pass なら exit 0 で、記録を stdout に出す（広げる前の領域と広げた後の領域を両方残す）", () => {
  const dir = makeTempDir("amend-verify-");
  const paths = writeScene(dir, (next) => setPixel(next, 4, 4, GREY));

  const r = runCli([...singleArgs(paths), "--region", "3,3,3,3", "--margin", "1"]);

  expect(r.status).toBe(0);
  const record = parseRecord(r.stdout);
  expect(record).toMatchObject({ tool: "amend-verify" });
  expect(record).not.toHaveProperty("change_id");
  expect(record.pairs).toHaveLength(1);
  expect(record.pairs[0]).toMatchObject({
    pair: "p|hover|desktop",
    pass: true,
    outside_diff_pixels: 0,
    inside_diff_before: 1,
    inside_diff_after: 0,
    margin: 1,
    declared_regions: [{ x: 3, y: 3, width: 3, height: 3 }],
    regions: [{ x: 2, y: 2, width: 5, height: 5 }],
    reasons: [],
  });
});

test("CLI: 記録の inputs は渡したパスと画像のバイトの sha256 を持つ（鮮度の検査が突き合わせる）", () => {
  const dir = makeTempDir("amend-verify-");
  const paths = writeScene(dir);

  const r = runCli([...singleArgs(paths), "--region", "3,3,3,3"]);

  const { inputs } = parseRecord(r.stdout).pairs[0];
  for (const key of ["prev_new", "new", "current"] as const) {
    const digest = createHash("sha256").update(readFileSync(paths[key])).digest("hex");
    expect(inputs[key]).toEqual({ path: paths[key], sha256: digest });
  }
});

test("CLI: --pairs の領域は配列とオブジェクトのどちらでも読み、組ごとの margin を使う", () => {
  const dir = makeTempDir("amend-verify-");
  const paths = writeScene(dir, (next) => setPixel(next, 4, 4, GREY));
  const pairsPath = join(dir, "pairs.json");
  writeFileSync(
    pairsPath,
    JSON.stringify([
      { pair: "array", ...paths, regions: [[3, 3, 3, 3]] },
      { pair: "object", ...paths, regions: [{ x: 3, y: 3, width: 3, height: 3 }], margin: 1 },
    ]),
  );

  const r = runCli(["--pairs", pairsPath]);

  expect(r.status).toBe(0);
  const pairs = parseRecord(r.stdout).pairs;
  expect(pairs.map((p) => p.pair)).toEqual(["array", "object"]);
  for (const p of pairs) expect(p.declared_regions).toEqual([{ x: 3, y: 3, width: 3, height: 3 }]);
  expect(pairs[0]).toMatchObject({ margin: 0, regions: [{ x: 3, y: 3, width: 3, height: 3 }] });
  expect(pairs[1]).toMatchObject({ margin: 1, regions: [{ x: 2, y: 2, width: 5, height: 5 }] });
});

test("CLI: fail の組があれば exit 1 で、--out には記録を書き、stdout には組ごとの判定と理由を出す", () => {
  const dir = makeTempDir("amend-verify-");
  const paths = writeScene(dir, (next) => setPixel(next, 0, 0, BLACK));
  const out = join(dir, "nested", "record.json");

  const r = runCli([
    ...singleArgs(paths),
    "--region",
    "3,3,3,3",
    "--change-id",
    "c1",
    "--out",
    out,
  ]);

  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(
    /^FAIL p\|hover\|desktop: 1 pixels changed outside the declared regions\n$/,
  );
  const record = parseRecord(readFileSync(out, "utf8"));
  expect(record.change_id).toBe("c1");
  expect(record.pairs[0]).toMatchObject({ pass: false, outside_diff_pixels: 1 });
});

test("CLI: 画像が読めない組があれば、どの組かを出して exit 2（判定していないので合格にしない）", () => {
  const dir = makeTempDir("amend-verify-");
  const paths = writeScene(dir);
  writeFileSync(paths.current, "not an image");

  const r = runCli([...singleArgs(paths), "--region", "3,3,3,3"]);

  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/cannot read PNG inputs of pair p\|hover\|desktop/);
  expect(r.stdout).toBe("");
});
