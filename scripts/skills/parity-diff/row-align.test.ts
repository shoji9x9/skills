// row-align.mjs と、対応づけを読む pixel-crops.mjs・region-names.mjs の回帰テスト（Issue #1107）。
// 期待値は references/detect.md「全画面の組で、ずれた行を対応づける」と Issue #1107 の受け入れ条件から決める。
//
// 場面は、行ごとに違う模様を持つ全画面の画像で作る（ラベルの違う行は内容が違い、どの行も 2 色以上を含む）。
// 記録済みの画素差分ツールの代わりに、チャンネルの差が 1 つでもある画素に赤の印を付ける差分画像をテストの中で作る。
// pngjs はこのリポジトリに入れないので、子プロセスを `--import fake-pngjs-hooks.ts` で起動し、偽物に向ける。

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expect, test } from "vitest";
import {
  alignRows,
  checkAlignmentRecord,
  deriveAlignment,
  longestIncreasing,
  mapCurrentRect,
  shiftedRuns,
  toBlocks,
  VERSION,
} from "../../../skills/parity-diff/scripts/row-align.mjs";
import { addForcedRows, linkShifts } from "../../../skills/parity-diff/scripts/pixel-crops.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { decodePng, encodePng } from "../../lib/testing/fake-pngjs.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { isRecord } from "../../lib/guards.ts";
import { HOOKS } from "./pixel-crops-helpers.ts";

const scriptPath = (name: string) =>
  fileURLToPath(new URL(`../../../skills/parity-diff/scripts/${name}`, import.meta.url));
const ROW_ALIGN = scriptPath("row-align.mjs");
const PIXEL_CROPS = scriptPath("pixel-crops.mjs");
const REGION_NAMES = scriptPath("region-names.mjs");

const WIDTH = 40;

type Img = { width: number; height: number; data: Uint8Array };
type Rect = { x: number; y: number; width: number; height: number };

/** ラベルの列から画像を作る。ラベルごとに行の模様が決まる（同じラベルの行は同じ内容）。 */
function page(labels: number[], { width = WIDTH }: { width?: number } = {}): Img {
  const data = new Uint8Array(width * labels.length * 4);
  labels.forEach((label, y) => {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      data[o] = (label * 37 + x * 11) % 256;
      data[o + 1] = (label * 53 + 7) % 256;
      data[o + 2] = (x * 29 + label) % 256;
      data[o + 3] = 255;
    }
  });
  return { width, height: labels.length, data };
}

/** from から to-1 までのラベル。 */
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** 画素 (x, y) の色を変える（ずれた帯の中の色の違いを作る）。 */
function paint(img: Img, rect: Rect, rgba: number[]): Img {
  const data = Uint8Array.from(img.data);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) data.set(rgba, (y * img.width + x) * 4);
  }
  return { ...img, data };
}

/** 記録済みのツールの代わり。チャンネルの差がある画素に赤、無い画素に白を置いた差分画像を作る。 */
function toolDiff(a: Img, b: Img): Img {
  const data = new Uint8Array(a.data.length);
  for (let o = 0; o < data.length; o += 4) {
    let differs = false;
    for (let c = 0; c < 4; c += 1) if (a.data[o + c] !== b.data[o + c]) differs = true;
    data.set(differs ? [255, 0, 0, 255] : [255, 255, 255, 255], o);
  }
  return { width: a.width, height: a.height, data };
}

function save(path: string, img: Img) {
  writeFileSync(path, encodePng(img.width, img.height, img.data));
}

function load(path: string): Img {
  return decodePng(readFileSync(path));
}

function isCropsOut(v: unknown): v is CropsOut {
  return (
    isRecord(v) &&
    "summary" in v &&
    "regions" in v &&
    "strict_only_regions" in v &&
    "alignment" in v
  );
}

/** JSON の文字列をオブジェクトとして読む。オブジェクトでなければテストを落とす。 */
function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  assert(isRecord(value), `JSON のオブジェクトでない: ${text}`);
  return value;
}

function run(script: string, args: string[]) {
  const res = spawnSync(process.execPath, ["--import", HOOKS, script, ...args], {
    encoding: "utf8",
    env: process.env,
    timeout: CHILD_TIMEOUT_MS,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

type Shift = {
  id: string;
  new_y: number;
  height: number;
  dy: number;
  cause_rows: { new_y: number; height: number };
  cause_regions?: number[];
};
type CropsOut = {
  summary: Record<string, number | null>;
  regions: Array<{
    id: number;
    bbox: Rect;
    causes_shifts?: string[];
    alignment_forced_pixels?: number;
  }>;
  strict_only_regions: Array<{ id: string; bbox: Rect }>;
  alignment: null | { shifted: Shift[]; file: string };
};

/**
 * 1 つの組を、detect.md の手順どおりに通す。row-align.mjs → ツール（並べ直した画像と new）→ pixel-crops.mjs。
 * 対応づけなかった組（exit 1）は、元の 2 枚をツールで比べて pixel-crops.mjs に渡す（寸法が違えば渡さない）。
 */
function pipeline(current: Img, next: Img) {
  const dir = makeTempDir("row-align-");
  save(join(dir, "current.png"), current);
  save(join(dir, "new.png"), next);
  const out = join(dir, "align");
  const align = run(ROW_ALIGN, [join(dir, "current.png"), join(dir, "new.png"), "--out", out]);
  const record = parseObject(align.stdout);
  let crops: ReturnType<typeof run> | null = null;
  if (align.code === 0) {
    const aligned = load(join(out, "current-aligned.png"));
    save(join(dir, "diff.png"), toolDiff(aligned, next));
    crops = run(PIXEL_CROPS, [
      join(out, "current-aligned.png"),
      join(dir, "new.png"),
      join(dir, "diff.png"),
      "--out",
      join(dir, "crops"),
      "--alignment",
      join(out, "alignment.json"),
      "--original-current",
      join(dir, "current.png"),
    ]);
  } else if (current.width === next.width && current.height === next.height) {
    save(join(dir, "diff.png"), toolDiff(current, next));
    crops = run(PIXEL_CROPS, [
      join(dir, "current.png"),
      join(dir, "new.png"),
      join(dir, "diff.png"),
      "--out",
      join(dir, "crops"),
    ]);
  }
  let parsed: CropsOut | null = null;
  if (crops && crops.code !== 2) {
    const value: unknown = JSON.parse(crops.stdout);
    assert(isCropsOut(value), `pixel-crops.mjs の出力の形が違う: ${crops.stdout}`);
    parsed = value;
  }
  return { dir, out, align, record, crops, parsed };
}

// 上の要素（ラベル 0〜9）が 8 行伸び、下の本文（ラベル 100〜149）が 8 行押し下げられた組。
const HEADER = range(0, 10);
const BODY = range(100, 150);
const GROWN = [...HEADER, ...range(200, 208), ...BODY];

test("上の要素の高さだけを変えた組では、ずれた本文は候補にならず、原因の候補に dy 付きで結びつく", () => {
  const { align, record, crops, parsed } = pipeline(page([...HEADER, ...BODY]), page(GROWN));
  expect(align.code, align.stderr).toBe(0);
  expect(record).toMatchObject({
    aligned: true,
    shifted: [{ id: "d1", new_y: 18, height: 50, dy: 8, cause_rows: { new_y: 10, height: 8 } }],
    inserted: [{ new_y: 10, rows: 8 }],
  });
  assert(parsed && crops, "pixel-crops.mjs が出力を出していない");
  expect(crops.code).toBe(1);
  // 候補は伸びた 8 行の 1 件だけで、ずれた本文（new の 18 行目から下）に候補は無い。
  expect(parsed.regions.map((r) => r.bbox)).toEqual([{ x: 0, y: 10, width: WIDTH, height: 8 }]);
  expect(parsed.strict_only_regions).toEqual([]);
  expect(parsed.regions[0]?.causes_shifts).toEqual(["d1"]);
  expect(parsed.alignment?.shifted[0]).toMatchObject({ id: "d1", dy: 8, cause_regions: [1] });
});

test("ずれた本文の中の色の違いは、原因に結びつかない独立した候補として出る", () => {
  const changed = paint(page(GROWN), { x: 5, y: 40, width: 6, height: 3 }, [0, 0, 0, 255]);
  const { parsed } = pipeline(page([...HEADER, ...BODY]), changed);
  assert(parsed, "pixel-crops.mjs が出力を出していない");
  expect(parsed.regions.map((r) => r.bbox)).toEqual([
    { x: 0, y: 10, width: WIDTH, height: 8 },
    { x: 5, y: 40, width: 6, height: 3 },
  ]);
  expect(parsed.regions.map((r) => r.causes_shifts)).toEqual([["d1"], []]);
  expect(parsed.alignment?.shifted.map((s) => s.cause_regions)).toEqual([[1]]);
});

test("上の要素が縮んだ組では、削除の境目の行が原因の候補になり、ずれは負の dy で結びつく", () => {
  const current = page([...HEADER, ...BODY]);
  const next = page([...range(0, 6), ...BODY]);
  const { record, parsed } = pipeline(current, next);
  expect(record).toMatchObject({ removed: [{ new_y: 6, current_y: 6, rows: 4 }] });
  expect(record).toHaveProperty("shifted", [
    { id: "d1", new_y: 6, height: 50, dy: -4, cause_rows: { new_y: 4, height: 4 } },
  ]);
  assert(parsed, "pixel-crops.mjs が出力を出していない");
  // ツールは並べ直した画像に差を出さないので、候補は境目の上下 2 行（足した画素）だけである。
  expect(parsed.summary.threshold_pixels).toBe(4 * WIDTH);
  expect(parsed.summary.alignment_forced_pixels).toBe(4 * WIDTH);
  expect(parsed.regions).toHaveLength(1);
  expect(parsed.regions[0]).toMatchObject({
    bbox: { x: 0, y: 4, width: WIDTH, height: 4 },
    causes_shifts: ["d1"],
    alignment_forced_pixels: 4 * WIDTH,
  });
});

test("原因の行の候補を --min-cluster で捨てた組は、ほかに候補が無くても exit 1 にし、捨てた行とずれを出力に残す", () => {
  const current = page([...HEADER, ...BODY]);
  const next = page([...range(0, 6), ...BODY]);
  const { dir, out } = pipeline(current, next);
  const res = run(PIXEL_CROPS, [
    join(out, "current-aligned.png"),
    join(dir, "new.png"),
    join(dir, "diff.png"),
    "--out",
    join(dir, "crops-min"),
    "--alignment",
    join(out, "alignment.json"),
    "--original-current",
    join(dir, "current.png"),
    // 境目の候補は 4 行 × 40 画素 = 160 画素なので、下限 200 で捨てられる。
    "--min-cluster",
    "200",
  ]);
  expect(res.code).toBe(1);
  const parsedOut = parseObject(res.stdout);
  expect(parsedOut).toMatchObject({
    regions: [],
    alignment: { uncaused_shifts: ["d1"], uncovered_forced_rows: [{ new_y: 4, rows: 4 }] },
  });
  expect(res.stderr).toContain("have no candidate on their cause rows");
  expect(res.stderr).toContain("are in no candidate");
});

test("幅が違う組は対応づけず、理由を付けて exit 1 で返し、並べ直した画像を書かない", () => {
  const { align, record, out } = pipeline(page([...HEADER, ...BODY]), page(GROWN, { width: 41 }));
  expect(align.code).toBe(1);
  expect(record).toMatchObject({ aligned: false, reason: "width_mismatch" });
  expect(existsSync(join(out, "current-aligned.png"))).toBe(false);
  expect(existsSync(join(out, "alignment.json"))).toBe(true);
});

test("内容が大きく変わった組は対応づけず、従来どおり同じ座標の候補が出る", () => {
  // 同じ高さで、共通の行が 2 割しかない組。手がかりはあるが、対応の付く行が下限（5 割）に届かない。
  const current = page([...range(0, 12), ...range(300, 348)]);
  const next = page([...range(0, 12), ...range(400, 448)]);
  const { align, record, parsed } = pipeline(current, next);
  expect(align.code).toBe(1);
  expect(record).toMatchObject({ aligned: false, reason: "low_coverage", coverage: 0.2 });
  assert(parsed, "従来の pixel-crops.mjs の出力が無い");
  expect(parsed.alignment).toBeNull();
  expect(parsed.regions.map((r) => r.bbox)).toEqual([{ x: 0, y: 12, width: WIDTH, height: 48 }]);
  expect(parsed.regions[0]?.causes_shifts).toBeUndefined();
});

test("共通の行が 1 つも無い組は no_anchor、ずれの無い組は no_shift として対応づけない", () => {
  expect(alignRows(page(range(0, 20)), page(range(50, 70)), { minCoverage: 0.5 })).toMatchObject({
    aligned: false,
    reason: "no_anchor",
  });
  const same = page(range(0, 20));
  expect(
    alignRows(same, paint(same, { x: 1, y: 3, width: 2, height: 1 }, [0, 0, 0, 255]), {
      minCoverage: 0.5,
    }),
  ).toMatchObject({
    aligned: false,
    reason: "no_shift",
  });
});

test("対応の付いた行の割合は、丸める前の値でしきい値と比べる（丸めると下限に届いたことになる組を通さない）", () => {
  // 3 行のうち 2 行が対応する組。割合 0.66666… は丸めると 0.6667 になり、下限 0.6667 に届いたように見える。
  const result = alignRows(page([0, 1, 2]), page([0, 1, 9]), { minCoverage: 0.6667 });
  expect(result).toMatchObject({ aligned: false, reason: "low_coverage", coverage: 0.6667 });
});

test("対応づけなかった組では、同じ --out に前の実行が残した並べ直した画像を消す", () => {
  const dir = makeTempDir("row-align-");
  const out = join(dir, "align");
  save(join(dir, "current.png"), page([...HEADER, ...BODY]));
  save(join(dir, "new.png"), page(GROWN));
  const first = run(ROW_ALIGN, [join(dir, "current.png"), join(dir, "new.png"), "--out", out]);
  expect(first.code).toBe(0);
  expect(existsSync(join(out, "current-aligned.png"))).toBe(true);
  // 2 回目はずれの無い組（no_shift）で、同じ --out に書く。
  save(join(dir, "new.png"), page([...HEADER, ...BODY]));
  const second = run(ROW_ALIGN, [join(dir, "current.png"), join(dir, "new.png"), "--out", out]);
  expect(second.code).toBe(1);
  expect(parseObject(second.stdout)).toMatchObject({ aligned: false, reason: "no_shift" });
  expect(existsSync(join(out, "current-aligned.png"))).toBe(false);
});

test("最長増加部分列は、順序の合わない手がかりを除く", () => {
  expect(
    longestIncreasing([
      [0, 0],
      [5, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]),
  ).toEqual([
    [0, 0],
    [1, 2],
    [2, 3],
    [3, 4],
  ]);
  expect(longestIncreasing([])).toEqual([]);
});

test("ずれは dy が変わった帯ごとに分け、間の行を原因の行にする。dy が 0 に戻った帯はずれにしない", () => {
  // 0〜9 は dy 0、10〜29 は dy 5、30〜39 は dy 0（5 行の削除で戻った）、40〜49 は dy 3。
  const source = [
    ...range(0, 10),
    ...Array(5).fill(-1),
    ...range(10, 30),
    ...range(35, 45),
    ...Array(3).fill(-1),
    ...range(45, 55),
  ];
  const blocks = toBlocks(source);
  expect(shiftedRuns(blocks, source.length)).toEqual([
    { id: "d1", new_y: 15, height: 20, dy: 5, cause_rows: { new_y: 10, height: 5 } },
    { id: "d2", new_y: 48, height: 10, dy: -7 + 10, cause_rows: { new_y: 45, height: 3 } },
  ]);
  expect(deriveAlignment(source, { currentHeight: 55 }).removed).toEqual([
    { new_y: 35, current_y: 30, rows: 5 },
  ]);
});

test("現側の矩形は、帯ごとに new の座標へ動かし、削除された行の部分は落とす（小数の座標も保つ）", () => {
  const blocks = toBlocks([...range(0, 10), ...Array(4).fill(-1), ...range(14, 30)]);
  // current の 8〜16 行（9 行 + 半端）。10〜13 は削除されたので落ち、8〜9 と 14〜16.5 が残る。
  expect(mapCurrentRect({ x: 2, y: 8, width: 3, height: 8.5 }, blocks)).toEqual([
    { x: 2, y: 8, width: 3, height: 2 },
    { x: 2, y: 14, width: 3, height: 2.5 },
  ]);
});

test("pixel-crops.mjs は、ずれの原因の行に縦の範囲が重なる候補だけを結びつける", () => {
  const regions: Array<{ id: number; bbox: Rect; causes_shifts?: string[] }> = [
    { id: 1, bbox: { x: 0, y: 2, width: 4, height: 3 } },
    { id: 2, bbox: { x: 0, y: 5, width: 4, height: 1 } },
  ];
  const shifted = linkShifts([{ id: "d1", cause_rows: { new_y: 4, height: 1 } }], regions);
  expect(shifted[0]?.cause_regions).toEqual([1]);
  expect(regions.map((r) => r.causes_shifts)).toEqual([["d1"], []]);
  // new の 0 行目は挿入、current の最後の行は削除（境目は new の下端）。足す行は挿入の 1 行と、境目の上の 2 行である。
  const derived = deriveAlignment([-1, 0, 1, 2, 3, 4], { currentHeight: 6 });
  expect(derived.forced_rows).toEqual([
    { new_y: 0, rows: 1 },
    { new_y: 4, rows: 2 },
  ]);
  const toolMask = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const { mask, forcedOnly } = addForcedRows(toolMask, 2, derived.forced_rows);
  expect(Array.from(mask)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  // ツールが印を付けた画素は、足した画素に数えない。
  expect(Array.from(forcedOnly)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
});

test("記録を読む側は、source から導き直した値と食い違う記録と、書き手の不変条件を破る記録を拒む", () => {
  const result = alignRows(page([...HEADER, ...BODY]), page(GROWN), { minCoverage: 0.5 });
  assert(result.aligned, "対応づけられていない");
  const record = {
    version: VERSION,
    current: { width: WIDTH, height: 60 },
    new: { width: WIDTH, height: 68 },
    fill_color: "ff00ff",
    ...result,
  };
  expect("error" in checkAlignmentRecord(record)).toBe(false);
  const broken: Array<[string, Record<string, unknown>]> = [
    ["version", { ...record, version: "0" }],
    ["aligned", { ...record, aligned: false }],
    ["width", { ...record, new: { width: WIDTH + 1, height: 68 } }],
    ["fill", { ...record, fill_color: "magenta" }],
    ["source の長さ", { ...record, source: result.source.slice(1) }],
    ["source の範囲", { ...record, source: [...result.source.slice(0, -1), 60] }],
    ["source の順序", { ...record, source: [1, 0, ...result.source.slice(2)] }],
    ["shifted", { ...record, shifted: [{ ...result.shifted[0], dy: 7 }] }],
    ["blocks", { ...record, blocks: [] }],
  ];
  for (const [label, rec] of broken) {
    expect("error" in checkAlignmentRecord(rec), label).toBe(true);
  }
  // 帯・挿入・削除・ずれを、不正な source から導き直した値で書いた記録（導き直した値の突き合わせは通る）。
  // source の範囲と順序の検査だけが、この記録を拒む。
  const selfConsistent = (source: number[]) => ({
    ...record,
    source,
    ...deriveAlignment(source, { currentHeight: 60 }),
  });
  for (const [label, source] of [
    ["current に無い行", [...result.source.slice(0, -1), 60]],
    ["逆順の対応", [1, 0, ...result.source.slice(2)]],
    ["同じ行への 2 回の対応", [0, 0, ...result.source.slice(2)]],
  ] as const) {
    expect("error" in checkAlignmentRecord(selfConsistent([...source])), label).toBe(true);
  }
  // pixel-crops.mjs が足した cause_regions は、比べない。
  const withCauses = {
    ...record,
    shifted: result.shifted.map((s) => ({ ...s, cause_regions: [1] })),
  };
  expect("error" in checkAlignmentRecord(withCauses)).toBe(false);
});

test("pixel-crops.mjs は、対応づけの引数の片方だけ・並べ直していない current・対応づけなかった記録を exit 2 で拒む", () => {
  const { dir, out } = pipeline(page([...HEADER, ...BODY]), page(GROWN));
  const base = [
    join(out, "current-aligned.png"),
    join(dir, "new.png"),
    join(dir, "diff.png"),
    "--out",
    join(dir, "x"),
  ];
  const onlyOne = run(PIXEL_CROPS, [...base, "--alignment", join(out, "alignment.json")]);
  expect(onlyOne.code).toBe(2);
  expect(onlyOne.stderr).toContain("must be given together");

  // 並べ直した画像の 1 画素を変えたものを位置引数に渡す（記録から作り直した画像と食い違う）。
  const tampered = paint(
    load(join(out, "current-aligned.png")),
    { x: 0, y: 30, width: 1, height: 1 },
    [1, 2, 3, 255],
  );
  save(join(dir, "tampered.png"), tampered);
  const mismatch = run(PIXEL_CROPS, [
    join(dir, "tampered.png"),
    ...base.slice(1),
    "--alignment",
    join(out, "alignment.json"),
    "--original-current",
    join(dir, "current.png"),
  ]);
  expect(mismatch.code).toBe(2);
  expect(mismatch.stderr).toContain("row 30 differs");

  const rec = parseObject(readFileSync(join(out, "alignment.json"), "utf8"));
  writeFileSync(join(dir, "not-aligned.json"), JSON.stringify({ ...rec, aligned: false }));
  const notAligned = run(PIXEL_CROPS, [
    ...base,
    "--alignment",
    join(dir, "not-aligned.json"),
    "--original-current",
    join(dir, "current.png"),
  ]);
  expect(notAligned.code).toBe(2);
  expect(notAligned.stderr).toContain("alignment.aligned is not true");
});

test("region-names.mjs は、対応づけた組では現側の rect を new の座標へ動かしてから重なりを決める", () => {
  const changed = paint(page(GROWN), { x: 5, y: 40, width: 6, height: 3 }, [0, 0, 0, 255]);
  const { dir } = pipeline(page([...HEADER, ...BODY]), changed);
  const crops = join(dir, "crops.json");
  // 色の違いは new の 40 行目で、current では 32 行目にあった要素（card）の中にある。
  const pixelOut = run(PIXEL_CROPS, [
    join(dir, "align", "current-aligned.png"),
    join(dir, "new.png"),
    join(dir, "diff.png"),
    "--out",
    join(dir, "crops"),
    "--alignment",
    join(dir, "align", "alignment.json"),
    "--original-current",
    join(dir, "current.png"),
  ]);
  writeFileSync(crops, pixelOut.stdout);
  const traits = (rect: Rect) => JSON.stringify([{ name: "card", rect }]);
  writeFileSync(join(dir, "current-traits.json"), traits({ x: 0, y: 30, width: WIDTH, height: 6 }));
  writeFileSync(join(dir, "new-traits.json"), traits({ x: 0, y: 38, width: WIDTH, height: 6 }));
  const res = run(REGION_NAMES, [
    crops,
    "--current-traits",
    join(dir, "current-traits.json"),
    "--new-traits",
    join(dir, "new-traits.json"),
    "--current-mask-rects-missing",
    "--new-mask-rects-missing",
    "--scale",
    "1",
  ]);
  expect(res.code, res.stderr).toBe(0);
  const out = parseObject(res.stdout);
  expect(out).toMatchObject({ aligned: true });
  // 色の違い（new の 40 行目）の領域に、両側の card が重なる。現側の rect を動かさないと、現側は重ならない。
  expect(out.regions).toContainEqual(
    expect.objectContaining({
      bbox: { x: 5, y: 40, width: 6, height: 3 },
      names: [expect.objectContaining({ name: "card", sides: ["current", "new"] })],
    }),
  );
});
