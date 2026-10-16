// pixel-crops.mjs の回帰テスト（Issue #384・#497・PR #395・#521）。
// 期待値は references/detect.md の「画素の比較」の取り決めから決める。
//
// 分岐ごとの入力は、PNG を読まない純関数を同じプロセスで呼んで確かめる。どの関数の戻り値も、main が stdout に出す
// { summary, regions, strict_only_regions } の一部と同じ意味を持つ。対応は次のとおりである。
//   - summarizePixels: summary
//   - filterAndMerge・absorbStrictIntoRegions: regions
//   - mergeThenFilter・selectStrictRegions: strict_only_regions と summary の strict_only_dropped_*
//   - countInBbox: regions[].strict_pixels
//   - adjacentRegionIds: overlaps_regions
//
// 引数から関数までのつなぎ・終了コード・stderr・書き出す crop は、CLI を子プロセスで起動して確かめる。
// pngjs はこのリポジトリに入れないので、子プロセスを `--import fake-pngjs-hooks.ts` で起動し、
// `pngjs` の import を偽物（fake-pngjs.ts）に向ける。スキルのスクリプトは書き換えず、そのまま実行する。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expect, test } from "vitest";
import {
  buildStrictMask,
  summarizePixels,
  countInBbox,
  buildDiffMask,
  hexToRgb,
  buildStrictOnlyMask,
  selectStrictRegions,
  clusterComponents,
  filterAndMerge,
  mergeThenFilter,
  absorbStrictIntoRegions,
  adjacentRegionIds,
} from "../../../skills/parity-diff/scripts/pixel-crops.mjs";
import type { Rect } from "../../../skills/parity-diff/scripts/pixel-crops.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { decodePng, encodePng } from "../../lib/testing/fake-pngjs.ts";

const SCRIPT = fileURLToPath(
  new URL("../../../skills/parity-diff/scripts/pixel-crops.mjs", import.meta.url),
);
const HOOKS = fileURLToPath(new URL("../../lib/testing/fake-pngjs-hooks.ts", import.meta.url));

type Region = {
  id: number;
  bbox: Rect;
  pixels: number;
  strict_pixels: number;
  threshold_bbox: Rect;
  absorbed_strict_only_pixels: number;
  crop_current: string;
  crop_new: string;
};
type StrictRegion = {
  id: string;
  bbox: Rect;
  strict_pixels: number;
  overlaps_regions: number[];
  crop_current: string;
  crop_new: string;
};
type Output = {
  summary: Record<string, number | null>;
  regions: Region[];
  strict_only_regions: StrictRegion[];
};
type Run = { code: number | null; stdout: string; stderr: string; out: string };

function isOutput(value: unknown): value is Output {
  if (typeof value !== "object" || value === null) return false;
  return "summary" in value && "regions" in value && "strict_only_regions" in value;
}

/** stdout の JSON を読む。形が違えばテストを落とす。 */
function parsed(run: Run): Output {
  const value: unknown = JSON.parse(run.stdout);
  assert(
    isOutput(value),
    `stdout が { summary, regions, strict_only_regions } でない: ${run.stdout}`,
  );
  return value;
}

/** 3 枚の画像のファイルを置いて CLI を実行する。fake を false にすると pngjs の無い環境で実行する。 */
function runFiles(
  dir: string,
  files: { current: Buffer; next: Buffer; diff: Buffer },
  args: string[] = [],
  fake = true,
): Run {
  const paths = [join(dir, "current.png"), join(dir, "new.png"), join(dir, "diff.png")];
  writeFileSync(paths[0] ?? "", files.current);
  writeFileSync(paths[1] ?? "", files.next);
  writeFileSync(paths[2] ?? "", files.diff);
  const out = join(dir, "out");
  const res = spawnSync(
    process.execPath,
    [...(fake ? ["--import", HOOKS] : []), SCRIPT, ...paths, "--out", out, ...args],
    { encoding: "utf8", env: process.env, timeout: 30_000 },
  );
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, out };
}

/** RGBA の画素の並び（[r,g,b,a] の配列）から 3 枚の画像を作って実行する。 */
function runRaw(
  width: number,
  height: number,
  images: { current: number[][]; next: number[][]; diff: number[][] },
  args: string[] = [],
): Run {
  const png = (pixels: number[][]) => encodePng(width, height, Uint8Array.from(pixels.flat()));
  return runFiles(
    makeTempDir("pixel-crops-"),
    { current: png(images.current), next: png(images.next), diff: png(images.diff) },
    args,
  );
}

const BASE = [162, 101, 36, 255];
const SUBTLE = [162, 102, 36, 255]; // 緑だけ 1/255 違う
const STRONG = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

/**
 * 差分の場面を画像にして実行する。
 * marked はツールが差分画像に印を付けた画素（new は current と大きく違う）、
 * subtle はしきい値の内側で 1/255 だけ違う画素（差分画像に印は無い）。
 */
function runScene(
  width: number,
  height: number,
  scene: { marked?: Uint8Array; subtle?: Uint8Array },
  args: string[] = [],
  dir = makeTempDir("pixel-crops-"),
): Run {
  const marked = scene.marked ?? new Uint8Array(width * height);
  const subtle = scene.subtle ?? new Uint8Array(width * height);
  const current = new Uint8Array(width * height * 4);
  const next = new Uint8Array(width * height * 4);
  const diff = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    current.set(BASE, i * 4);
    if (marked[i] === 1) next.set(STRONG, i * 4);
    else if (subtle[i] === 1) next.set(SUBTLE, i * 4);
    else next.set(BASE, i * 4);
    diff.set(marked[i] === 1 ? RED : WHITE, i * 4);
  }
  return runFiles(
    dir,
    {
      current: encodePng(width, height, current),
      next: encodePng(width, height, next),
      diff: encodePng(width, height, diff),
    },
    args,
  );
}

/** width×height のマスクに、矩形（x, y, w, h）の輪郭か塗りを立てる。 */
function maskWith(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number; ring?: boolean }[],
) {
  const mask = new Uint8Array(width * height);
  for (const { x, y, w, h, ring } of rects) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        const edge = yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1;
        if (!ring || edge) mask[yy * width + xx] = 1;
      }
    }
  }
  return mask;
}

/** width×height のマスクに、点の並び [[x, y], ...] を立てる。 */
function maskOfPoints(width: number, height: number, points: number[][]) {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of points) mask[(y ?? 0) * width + (x ?? 0)] = 1;
  return mask;
}

// --- 関数の粒度: 画素の量を 2 本で報告する（Issue #384）---

// RGBA バッファを作る。pixels は [r,g,b,a] の配列。
/** candidates が返す領域。取り込みの有無で、しきい値の bbox と取り込んだ画素数の欄があるかが変わる。 */
type CandidateRegion = {
  pixels: number;
  bbox: Rect;
  threshold_bbox?: Rect;
  absorbed_strict_only_pixels?: number;
};

const rgba = (pixels: number[][]) => Uint8Array.from(pixels.flat());

// 実測（Issue #384）: 枠色が #a26524 と #a26624 で緑が 1/255 違うと、pixelmatch の threshold 0.1 が
// 差を飲み、報告は 756 画素・0.0569% のまま 3,364 画素の色違いが隠れた。
test("しきい値が飲んだ 1/255 の差は strict_only_pixels に出る", () => {
  const current = rgba([
    [162, 101, 36, 255],
    [162, 101, 36, 255],
    [0, 0, 0, 255],
  ]);
  const next = rgba([
    [162, 102, 36, 255],
    [162, 102, 36, 255],
    [255, 255, 255, 255],
  ]);
  // 記録済みツールの差分画像は、飲んだ 2 画素をマークせず 3 画素目だけを赤で出す。
  const diff = rgba([
    [0, 0, 0, 255],
    [0, 0, 0, 255],
    [255, 0, 0, 255],
  ]);

  const red = hexToRgb("ff0000");
  assert.exists(red, "ff0000 を色に変換できない");
  const thresholdMask = buildDiffMask(diff, 3, 1, red, 96);
  const strict = buildStrictMask(current, next, 3, thresholdMask);
  const summary = summarizePixels(
    thresholdMask,
    strict.mask,
    strict.maxChannelDelta,
    strict.maxStrictOnlyChannelDelta,
  );

  expect(summary.threshold_pixels).toBe(1);
  expect(summary.strict_pixels).toBe(3);
  expect(summary.strict_only_pixels).toBe(2);
  // 全体の最大チャンネル差は、しきい値に出た 3 画素目（黒→白）の 255。
  expect(summary.strict_max_channel_delta).toBe(255);
  // 隠れた差の大きさはこちらで読む。全体の 1 本だけだと 1/255 の差が 255 と報告される。
  expect(summary.strict_only_max_channel_delta).toBe(1);
});

test("1 本だけでは「ほぼ一致」に見える差でも、しきい値なしの数と割合が並ぶ", () => {
  const current = rgba([
    [162, 101, 36, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
  ]);
  const next = rgba([
    [162, 102, 36, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
  ]);
  const thresholdMask = new Uint8Array(4); // ツールは 1 画素も出さない
  const strict = buildStrictMask(current, next, 4, thresholdMask);
  const summary = summarizePixels(
    thresholdMask,
    strict.mask,
    strict.maxChannelDelta,
    strict.maxStrictOnlyChannelDelta,
  );

  expect(summary.threshold_pixels).toBe(0);
  expect(summary.threshold_ratio).toBe(0);
  expect(summary.strict_pixels).toBe(1);
  expect(summary.strict_ratio).toBe(25);
  expect(summary.strict_only_pixels).toBe(1);
  expect(summary.strict_max_channel_delta).toBe(1);
  expect(summary.strict_only_max_channel_delta).toBe(1);
});

test("完全一致なら両方 0（「隠れた差がある」を常に言わない）", () => {
  const image = rgba([
    [1, 2, 3, 255],
    [4, 5, 6, 255],
  ]);
  const thresholdMask = new Uint8Array(2);
  const strict = buildStrictMask(image, image, 2, thresholdMask);
  const summary = summarizePixels(
    thresholdMask,
    strict.mask,
    strict.maxChannelDelta,
    strict.maxStrictOnlyChannelDelta,
  );

  expect(summary).toEqual({
    total_pixels: 2,
    threshold_pixels: 0,
    strict_pixels: 0,
    strict_only_pixels: 0,
    strict_max_channel_delta: 0,
    strict_only_max_channel_delta: 0,
    threshold_ratio: 0,
    strict_ratio: 0,
  });
});

test("透明度だけの差も厳密比較では差として数える", () => {
  const current = rgba([[10, 10, 10, 255]]);
  const next = rgba([[10, 10, 10, 128]]);
  const strict = buildStrictMask(current, next, 1);

  expect(strict.count).toBe(1);
  expect(strict.maxChannelDelta).toBe(127);
});

test("crop の bbox ごとに、しきい値の内側の差を含む画素数を数える", () => {
  // 2x2。左上だけがしきい値に出る差、右下は 1/255 の差。
  const current = rgba([
    [0, 0, 0, 255],
    [50, 50, 50, 255],
    [50, 50, 50, 255],
    [162, 101, 36, 255],
  ]);
  const next = rgba([
    [255, 255, 255, 255],
    [50, 50, 50, 255],
    [50, 50, 50, 255],
    [162, 102, 36, 255],
  ]);
  const strict = buildStrictMask(current, next, 4);

  expect(countInBbox(strict.mask, 2, { x: 0, y: 0, width: 1, height: 1 })).toBe(1);
  expect(countInBbox(strict.mask, 2, { x: 1, y: 1, width: 1, height: 1 })).toBe(1);
  expect(countInBbox(strict.mask, 2, { x: 0, y: 0, width: 2, height: 2 })).toBe(2);
});

// --- strict-only の候補生成（PR #395 の codex レビュー P1）---
// 数だけ報告すると、トリアージが入力にする crop 対が無く分類も差し戻しもできない。

test("しきい値の内側だけの差もクラスタになり、候補として出せる", () => {
  // 4x2。左上 2x2 がしきい値の内側で 1/255 違う。差分画像は 1 画素も出さない。
  const w = 4;
  const h = 2;
  const cur = new Uint8Array(w * h * 4);
  const next = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    cur.set([162, 101, 36, 255], i * 4);
    next.set([162, 101, 36, 255], i * 4);
  }
  for (const idx of [0, 1, 4, 5]) next[idx * 4 + 1] = 102; // 緑だけ 1/255 違う

  const thresholdMask = new Uint8Array(w * h);
  const strict = buildStrictMask(cur, next, w * h);
  const strictOnly = buildStrictOnlyMask(thresholdMask, strict.mask);

  expect([...strictOnly]).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);

  const clusters = filterAndMerge(clusterComponents(strictOnly, w, h), 4, 8);
  expect(clusters).toHaveLength(1);
  expect(clusters[0].pixels).toBe(4);
  expect(clusters[0].bbox).toEqual({ x: 0, y: 0, width: 2, height: 2 });
});

test("しきい値でマークされた画素は strict-only から外れる", () => {
  const run = runScene(4, 1, {
    marked: maskOfPoints(4, 1, [[0, 0]]),
    subtle: maskOfPoints(4, 1, [[1, 0]]),
  });

  const { summary } = parsed(run);
  expect(summary.threshold_pixels).toBe(1);
  expect(summary.strict_pixels).toBe(2);
  expect(summary.strict_only_pixels).toBe(1);
});

test("孤立画素は --strict-min-cluster で落ちる（アンチエイリアスで候補が溢れない）", () => {
  const w = 4;
  const h = 2;
  const strictOnly = new Uint8Array(w * h);
  strictOnly[3] = 1; // 1 画素だけ

  expect(filterAndMerge(clusterComponents(strictOnly, w, h), 4, 8)).toHaveLength(0);
  expect(filterAndMerge(clusterComponents(strictOnly, w, h), 1, 8)).toHaveLength(1);
});

test("上限を超えた候補は画素数の多い順に選ばれ、出力は (y, x) 昇順で決定論的", () => {
  const regions = [
    { pixels: 5, bbox: { x: 10, y: 40, width: 2, height: 2 } },
    { pixels: 40, bbox: { x: 0, y: 30, width: 4, height: 4 } },
    { pixels: 20, bbox: { x: 5, y: 10, width: 3, height: 3 } },
  ];
  const picked = selectStrictRegions(regions, 2);

  expect(picked.map((r) => r.pixels)).toEqual([20, 40]); // 選抜は 40/20、並びは y 昇順
  expect(picked.map((r) => r.bbox.y)).toEqual([10, 30]);
  expect(selectStrictRegions(regions, 10)).toHaveLength(3);
});

// --- 下限未満の strict-only を警告なしに捨てない（PR #395 の codex レビュー 2 巡目 P1）---
// 落としてからマージすると、1〜3 画素に散った差が合流する前に全部消え、
// strict_only_pixels > 0 なのに候補ゼロ・exit 0 で合格になる状態に戻る。

test("近接した 1 画素の成分は、先にマージしてから下限に掛ける", () => {
  const subtle = maskOfPoints(12, 1, [
    [0, 0],
    [3, 0],
    [6, 0],
    [9, 0],
  ]);

  const run = runScene(12, 1, { subtle });

  const out = parsed(run);
  expect(out.strict_only_regions.map((r) => [r.bbox, r.strict_pixels])).toEqual([
    [{ x: 0, y: 0, width: 10, height: 1 }, 4],
  ]);
  expect(out.summary.strict_only_dropped_clusters).toBe(0);
});

test("マージしても下限に届かない分は件数と画素数で報告する（警告なしに捨てない）", () => {
  const components = [
    { pixels: 1, bbox: { x: 0, y: 0, width: 1, height: 1 } },
    { pixels: 2, bbox: { x: 200, y: 200, width: 2, height: 1 } },
  ];

  const merged = mergeThenFilter(components, 4, 8);
  expect(merged.kept).toHaveLength(0);
  expect(merged.droppedClusters).toBe(2);
  expect(merged.droppedPixels).toBe(3);
});

// --- 3 巡目の codex レビュー（P2 2 件）---

test("両方が完全な透明なら、隠れている RGB が違っても差にしない", () => {
  const current = rgba([
    [10, 20, 30, 0],
    [1, 2, 3, 255],
  ]);
  const next = rgba([
    [90, 80, 70, 0],
    [1, 2, 3, 255],
  ]);

  const strict = buildStrictMask(current, next, 2);
  expect(strict.count).toBe(0);
  expect(strict.maxChannelDelta).toBe(0);
});

test("片側だけ透明なら差として残る（透明化そのものは見た目の差）", () => {
  const current = rgba([[10, 20, 30, 255]]);
  const next = rgba([[10, 20, 30, 0]]);

  expect(buildStrictMask(current, next, 1).count).toBe(1);
});

test("候補の id は上限を上げても振り直されない", () => {
  // 入力の並びは (y, x) 昇順と違える。入力順で採番する実装だと、この順序差で id がずれる。
  const regions = [
    { pixels: 20, bbox: { x: 0, y: 50, width: 3, height: 3 } },
    { pixels: 5, bbox: { x: 0, y: 10, width: 2, height: 2 } },
    { pixels: 40, bbox: { x: 0, y: 30, width: 4, height: 4 } },
  ];

  const capped = selectStrictRegions(regions, 2);
  const raised = selectStrictRegions(regions, 3);

  // 上限 2 では画素数の多い 2 件（40 / 20）が出る。id は全体の (y, x) 並びから決まる。
  expect(capped.map((r) => [r.id, r.pixels])).toEqual([
    ["s2", 40],
    ["s3", 20],
  ]);
  // 上限を上げると手前の領域が s1 として増えるだけで、既存の id は同じ bbox を指したまま。
  expect(raised.map((r) => [r.id, r.pixels])).toEqual([
    ["s1", 5],
    ["s2", 40],
    ["s3", 20],
  ]);
  for (const region of capped) {
    const same = raised.find((r) => r.id === region.id);
    assert.exists(same, `raised に ${region.id} が無い`);
    expect(same.bbox).toEqual(region.bbox);
  }
});

test("候補の id は下限を下げても振り直されない（採番は両フィルタの前）", () => {
  // 入力の並びは (y, x) 昇順と違える。1 画素の成分は既定の下限では落ちるが、id は全体の並びで決まる。
  const components = [
    { pixels: 40, bbox: { x: 0, y: 30, width: 4, height: 4 } },
    { pixels: 1, bbox: { x: 0, y: 5, width: 1, height: 1 } },
  ];

  const strict = mergeThenFilter(components, 4, 8);
  const loose = mergeThenFilter(components, 1, 8);

  expect(strict.kept.map((r) => r.id)).toEqual(["s2"]);
  expect(strict.droppedClusters).toBe(1);
  expect(loose.kept.map((r) => r.id)).toEqual(["s1", "s2"]);

  const strictIds = selectStrictRegions(strict.kept, 10).map((r) => [r.id, r.pixels]);
  const looseIds = selectStrictRegions(loose.kept, 10).map((r) => [r.id, r.pixels]);
  expect(strictIds).toEqual([["s2", 40]]);
  expect(looseIds).toEqual([
    ["s1", 1],
    ["s2", 40],
  ]);
});

// --- 同じ場所の差を 1 つの候補にする（Issue #497）---
// 芯はしきい値を超え縁はしきい値の内側に収まる差（アイコンの輪郭のにじみ）が、regions に小さい bbox、
// strict_only_regions に大きい bbox で 2 件出ていた。台帳（画素の例外）は bbox の一致で照合するので、
// どちらを書いても片方が unexplained に残り、両方を書くと件数と承認の N が倍になる。

/** main と同じ段取りで regions / strict-only を作る（PNG を読まない部分）。 */
function candidates(
  thresholdMask: Uint8Array,
  strictOnlyMask: Uint8Array,
  width: number,
  height: number,
  withAbsorb = true,
  minCluster = 4,
): {
  regions: CandidateRegion[];
  strict: ReturnType<typeof mergeThenFilter>;
  absorbedPixels: number;
} {
  const thresholdRegions = filterAndMerge(clusterComponents(thresholdMask, width, height), 1, 8);
  if (!withAbsorb) {
    const strict = mergeThenFilter(clusterComponents(strictOnlyMask, width, height), minCluster, 8);
    return { regions: thresholdRegions, strict, absorbedPixels: 0 };
  }
  const absorbed = absorbStrictIntoRegions(thresholdRegions, strictOnlyMask, width, height, 8);
  const strict = mergeThenFilter(
    clusterComponents(absorbed.remainingMask, width, height),
    minCluster,
    8,
  );
  return { regions: absorbed.regions, strict, absorbedPixels: absorbed.absorbedPixels };
}

// 実測の形: 漏斗の芯 6×9 がしきい値つき、そのまわりの 11×11 の縁がしきい値の内側。
const W = 60;
const H = 40;
const core = { x: 12, y: 11, w: 6, h: 9 };
const halo = { x: 8, y: 10, w: 11, h: 11, ring: true };
// グリッドのスクロールバーのつまみ: しきい値つきの差が近くに無い、しきい値の内側だけの差。
const thumb = { x: 45, y: 30, w: 9, h: 5 };

test("芯と縁が重なる差は、外側の bbox を持つ 1 つの候補になる", () => {
  const thresholdMask = maskWith(W, H, [core]);
  const strictOnly = buildStrictOnlyMask(thresholdMask, maskWith(W, H, [core, halo]));

  const { regions, strict, absorbedPixels } = candidates(thresholdMask, strictOnly, W, H);

  expect(regions).toHaveLength(1);
  expect(regions[0].bbox).toEqual({ x: 8, y: 10, width: 11, height: 11 });
  expect(regions[0].threshold_bbox).toEqual({ x: 12, y: 11, width: 6, height: 9 });
  expect(regions[0].pixels).toBe(54); // しきい値つきの画素数は芯のまま
  expect(regions[0].absorbed_strict_only_pixels).toBe(countInBbox(strictOnly, W, regions[0].bbox));
  expect(absorbedPixels).toBe(regions[0].absorbed_strict_only_pixels);
  expect(strict.kept).toHaveLength(0);
  expect(strict.droppedClusters).toBe(0);
});

test("--pad 0 では芯の外の縁を取り込まず、同じ差が 2 件に分かれて overlaps_regions で結ばれる", () => {
  const run = runScene(W, H, { marked: maskWith(W, H, [core]), subtle: maskWith(W, H, [halo]) }, [
    "--pad",
    "0",
  ]);

  const out = parsed(run);
  expect(out.regions.map((r) => r.bbox)).toEqual([{ x: 12, y: 11, width: 6, height: 9 }]);
  expect(out.strict_only_regions.map((r) => [r.bbox, r.overlaps_regions])).toEqual([
    [{ x: 8, y: 10, width: 11, height: 11 }, [1]],
  ]);
  expect(out.summary.strict_only_overlapping_regions).toBe(1);
  expect(run.stderr).toMatch(/1 strict-only candidate\(s\) overlap or touch a threshold region/);
});

test("しきい値つきの差が近くに無い領域だけが strict_only に残り、id は下限を変えても変わらない", () => {
  const thresholdMask = maskWith(W, H, [core]);
  const strictOnly = buildStrictOnlyMask(thresholdMask, maskWith(W, H, [core, halo, thumb]));

  const strict = candidates(thresholdMask, strictOnly, W, H, true, 4).strict;
  const loose = candidates(thresholdMask, strictOnly, W, H, true, 1).strict;

  expect(strict.kept.map((r) => [r.id, r.bbox])).toEqual([
    ["s1", { x: 45, y: 30, width: 9, height: 5 }],
  ]);
  // 採番は取り込みの後・下限の前（下限を下げても同じ領域が同じ id を指す）。
  const looseS1 = loose.kept.find((r) => r.id === "s1");
  assert.exists(looseS1, "loose.kept に s1 が無い");
  expect(looseS1.bbox).toEqual(strict.kept[0].bbox);
});

test("取り込んだ縁は下限未満でも「捨てた」に数えない（候補の一部として出ている）", () => {
  const thresholdMask = maskWith(W, H, [core]);
  // 縁が 2 画素だけ（--strict-min-cluster 4 に届かない）。
  const strictOnly = maskOfPoints(W, H, [
    [11, 10],
    [12, 10],
  ]);

  const { regions, strict, absorbedPixels } = candidates(thresholdMask, strictOnly, W, H);

  expect(strict.droppedClusters).toBe(0);
  expect(absorbedPixels).toBe(2);
  expect(regions[0].bbox).toEqual({ x: 11, y: 10, width: 7, height: 10 });
});

test("芯を --pad だけ広げた範囲の外の画素は取り込まず、strict_only に残す（連鎖しない）", () => {
  const thresholdMask = maskWith(W, H, [{ x: 0, y: 0, w: 2, h: 2 }]);
  // 芯の右隣から x=20 まで続く 1 本の差（1 つの連結成分）。芯＋8 の範囲は x<=9。
  const strictOnly = maskOfPoints(
    W,
    H,
    Array.from({ length: 19 }, (_, i) => [2 + i, 0]),
  );

  const { regions, strict, absorbedPixels } = candidates(thresholdMask, strictOnly, W, H);

  expect(regions[0].bbox).toEqual({ x: 0, y: 0, width: 10, height: 2 });
  expect(absorbedPixels).toBe(8);
  expect(strict.kept.map((r) => r.bbox)).toEqual([{ x: 10, y: 0, width: 11, height: 1 }]);
});

test("縁を取り込んだ領域同士が近接したら 1 つにまとめ、重なる範囲の画素を二重に数えない", () => {
  const thresholdMask = maskWith(W, H, [
    { x: 0, y: 0, w: 2, h: 2 },
    { x: 16, y: 0, w: 2, h: 2 },
  ]);
  // 2 つの芯の間を埋める縁。両方の芯の広げた範囲（x<=9 と x>=8）が x=8,9 で重なる。
  const points = Array.from({ length: 13 }, (_, i) => [3 + i, 0]);
  const strictOnly = maskOfPoints(W, H, points);

  const { regions, strict, absorbedPixels } = candidates(thresholdMask, strictOnly, W, H);

  expect(regions).toHaveLength(1);
  expect(regions[0].bbox).toEqual({ x: 0, y: 0, width: 18, height: 2 });
  expect(regions[0].pixels).toBe(8);
  expect(absorbedPixels).toBe(points.length);
  expect(regions[0].absorbed_strict_only_pixels).toBe(points.length);
  expect(strict.kept).toHaveLength(0);
  expect(regions[0]).not.toHaveProperty("members");
});

test("ページ全体に広がる 1 つの差が、離れた領域を画面大の候補 1 件に潰さない", () => {
  // PR #521 のレビュー（3 巡目）の再現: 背景色の 1 階調のずれのように全面がしきい値の内側で違い、
  // 離れた 2 か所にしきい値つきの差がある。塊ごと取り込むと 800×600 の領域 1 件になる。
  const w = 800;
  const h = 600;
  const cores = [
    { x: 10, y: 10, w: 4, h: 4 },
    { x: 700, y: 500, w: 4, h: 4 },
  ];
  const thresholdMask = maskWith(w, h, cores);
  const strictOnly = buildStrictOnlyMask(thresholdMask, new Uint8Array(w * h).fill(1));

  const { regions, strict } = candidates(thresholdMask, strictOnly, w, h);

  expect(regions.map((r) => r.bbox)).toEqual([
    { x: 2, y: 2, width: 20, height: 20 },
    { x: 692, y: 492, width: 20, height: 20 },
  ]);
  expect(strict.kept).toHaveLength(1);
  expect(strict.kept[0].bbox).toEqual({ x: 0, y: 0, width: 800, height: 600 });
});

test("疎に散った差は、芯から離れていれば取り込まない（離れた芯が 1 件に潰れない）", () => {
  // PR #521 のレビュー（2 巡目）の再現: 3px 間隔の L 字に並ぶ 1 画素の差。芯はどれからも 90px 以上離れている。
  const w = 801;
  const h = 599;
  const points = [];
  for (let y = 10; y <= 598; y += 3) points.push([0, y]);
  for (let x = 3; x <= 800; x += 3) points.push([x, 598]);
  const thresholdMask = maskWith(w, h, [
    { x: 100, y: 100, w: 4, h: 4 },
    { x: 700, y: 500, w: 4, h: 4 },
  ]);
  const strictOnly = maskOfPoints(w, h, points);

  const { regions, strict, absorbedPixels } = candidates(thresholdMask, strictOnly, w, h);

  expect(regions.map((r) => r.bbox)).toEqual([
    { x: 100, y: 100, width: 4, height: 4 },
    { x: 700, y: 500, width: 4, height: 4 },
  ]);
  expect(absorbedPixels).toBe(0);
  expect(strict.kept).toHaveLength(1);
  expect(strict.kept[0].pixels).toBe(points.length);
});

test("まとめた領域の bbox の角に残る画素も取り込み、候補の内側に別の strict-only 候補を出さない", () => {
  // PR #521 のレビュー（4 巡目）の再現: 斜めに離れた 2 つの芯が縁を介してまとまると、包む bbox の角
  // （どちらの芯＋pad にも入らない (9,0)(9,1)）の画素が strict_only に残り、同じ場所の差が 2 件に分かれていた。
  const w = 20;
  const h = 20;
  const thresholdRegions = [
    { pixels: 1, bbox: { x: 0, y: 0, width: 1, height: 1 } },
    { pixels: 1, bbox: { x: 10, y: 10, width: 1, height: 1 } },
  ];
  const strictOnly = maskOfPoints(w, h, [
    [4, 4],
    [6, 6],
    [9, 0],
    [9, 1],
  ]);

  const out = absorbStrictIntoRegions(thresholdRegions, strictOnly, w, h, 4);

  expect(out.regions.map((r) => r.bbox)).toEqual([{ x: 0, y: 0, width: 11, height: 11 }]);
  expect(out.absorbedPixels).toBe(4);
  expect(out.regions[0].absorbed_strict_only_pixels).toBe(4);
  expect([...out.remainingMask].every((v) => v === 0)).toBe(true);
});

test("縁が --pad より外まで続く差は、外側の strict-only 候補に隣り合う領域の id が付く", () => {
  // PR #521 のレビュー（5 巡目）の再現: pad 2、4×4 の芯の周囲 6px に続く縁。
  // 取り込みは芯＋pad に限るので 2 件に分かれるが、分かれたことを overlaps_regions で見えるようにする。
  const w = 40;
  const h = 40;
  const thresholdMask = maskWith(w, h, [{ x: 18, y: 18, w: 4, h: 4 }]);
  const strictOnly = buildStrictOnlyMask(
    thresholdMask,
    maskWith(w, h, [{ x: 12, y: 12, w: 16, h: 16 }]),
  );
  const thresholdRegions = filterAndMerge(clusterComponents(thresholdMask, w, h), 1, 2);
  const absorbed = absorbStrictIntoRegions(thresholdRegions, strictOnly, w, h, 2);
  const strict = mergeThenFilter(clusterComponents(absorbed.remainingMask, w, h), 4, 2);
  const regions = absorbed.regions.map((r, i) => ({ ...r, id: i + 1 }));

  expect(regions.map((r) => r.bbox)).toEqual([{ x: 16, y: 16, width: 8, height: 8 }]);
  expect(strict.kept.map((r) => r.bbox)).toEqual([{ x: 12, y: 12, width: 16, height: 16 }]);
  expect(adjacentRegionIds(strict.kept, regions)).toEqual([[1]]);
});

test("離れた strict-only 候補には隣り合う領域を付けない（隣の画素に接していれば付け、1px でも隙間があれば付けない）", () => {
  const regions = [{ id: 1, bbox: { x: 0, y: 0, width: 4, height: 4 } }];
  const touching = { bbox: { x: 4, y: 0, width: 2, height: 2 } }; // 隣の画素 = 接する
  const apart = { bbox: { x: 5, y: 0, width: 2, height: 2 } }; // 1px の隙間
  expect(adjacentRegionIds([touching, apart], regions)).toEqual([[1], []]);
});

test("まとめた bbox に別の領域が入るなら、その領域もまとめる（候補の内側に候補を残さない）", () => {
  // PR #521 のレビュー（6 巡目）の再現: pad 10、(0,0) と (25,25) が縁でつながってまとまると、
  // bbox `(0,0,36,36)` の角にある `(25,0)` の領域が、どの構成要素からも pad より離れたまま別の候補として残っていた。
  const w = 40;
  const h = 40;
  const regions = [
    { pixels: 121, bbox: { x: 0, y: 0, width: 11, height: 11 } },
    { pixels: 44, bbox: { x: 25, y: 0, width: 11, height: 4 } },
    { pixels: 121, bbox: { x: 25, y: 25, width: 11, height: 11 } },
  ];
  // (0,0) と (25,25) を斜めにつなぐ縁。(13,13) は前者の芯＋pad、(22,22) は後者の芯＋pad に入り、互いに pad 以内。
  // (25,0) の領域はどの芯・縁からも pad より離れている。
  const strictOnly = maskOfPoints(w, h, [
    [13, 13],
    [22, 22],
  ]);

  const out = absorbStrictIntoRegions(regions, strictOnly, w, h, 10);

  expect(out.regions.map((r) => r.bbox)).toEqual([{ x: 0, y: 0, width: 36, height: 36 }]);
  expect(out.regions[0].pixels).toBe(286);
});

// --- CLI の粒度: 引数から関数までのつなぎ・終了コード・stderr・crop ---

test("CLI: 差が無ければ候補も警告も出さず exit 0", () => {
  const image = [
    [1, 2, 3, 255],
    [4, 5, 6, 255],
  ];
  const run = runRaw(2, 1, { current: image, next: image, diff: [WHITE, WHITE] });

  expect(run.code).toBe(0);
  expect(run.stderr).toBe("");
  const out = parsed(run);
  expect(out.summary).toMatchObject({
    total_pixels: 2,
    threshold_pixels: 0,
    strict_pixels: 0,
    strict_only_pixels: 0,
    strict_max_channel_delta: 0,
    strict_only_max_channel_delta: 0,
    threshold_ratio: 0,
    strict_ratio: 0,
    strict_only_regions_total: 0,
    strict_only_dropped_clusters: 0,
  });
  expect(out.regions).toEqual([]);
  expect(out.strict_only_regions).toEqual([]);
});

test("CLI: しきい値が飲んだ差は summary に数え、stderr に警告して exit 1", () => {
  // 記録済みツールの差分画像は、飲んだ 2 画素をマークせず 3 画素目だけを赤で出す。
  const run = runRaw(3, 1, {
    current: [BASE, BASE, [0, 0, 0, 255]],
    next: [SUBTLE, SUBTLE, STRONG],
    diff: [WHITE, WHITE, RED],
  });

  expect(run.code).toBe(1);
  const { summary } = parsed(run);
  expect(summary.threshold_pixels).toBe(1);
  expect(summary.strict_pixels).toBe(3);
  expect(summary.strict_only_pixels).toBe(2);
  // 全体の最大チャンネル差は、しきい値に出た 3 画素目（黒→白）の 255。
  expect(summary.strict_max_channel_delta).toBe(255);
  // 隠れた差の大きさはこちらで読む。全体の 1 本だけだと 1/255 の差が 255 と報告される。
  expect(summary.strict_only_max_channel_delta).toBe(1);
  expect(run.stderr).toMatch(/2 pixels differ below the recorded threshold/);
});

test("CLI: しきい値の内側だけの差の候補は crop 対を書き出し、exit 1", () => {
  // 4x2。左上 2x2 がしきい値の内側で 1/255 違う。差分画像は 1 画素も出さない。
  const run = runScene(4, 2, { subtle: maskWith(4, 2, [{ x: 0, y: 0, w: 2, h: 2 }]) });

  expect(run.code).toBe(1);
  const out = parsed(run);
  expect(out.regions).toEqual([]);
  expect(out.strict_only_regions.map((r) => [r.id, r.bbox, r.strict_pixels])).toEqual([
    ["s1", { x: 0, y: 0, width: 2, height: 2 }, 4],
  ]);
  const [candidate] = out.strict_only_regions;
  assert.exists(candidate, "strict_only_regions が空");
  expect(candidate.crop_current).toBe(join(run.out, "crop-s1-current.png"));
  expect(existsSync(candidate.crop_current)).toBe(true);
  expect(existsSync(candidate.crop_new)).toBe(true);
});

test("CLI: 下限に届かず候補にしなかった差が残れば、stderr に件数を出して exit 1", () => {
  const subtle = maskWith(210, 210, [
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 200, y: 200, w: 2, h: 1 },
  ]);

  const run = runScene(210, 210, { subtle });

  expect(run.code).toBe(1);
  const out = parsed(run);
  expect(out.strict_only_regions).toHaveLength(0);
  expect(out.summary.strict_only_dropped_clusters).toBe(2);
  expect(out.summary.strict_only_dropped_pixels).toBe(3);
  expect(run.stderr).toMatch(
    /2 strict-only cluster\(s\) \(3 pixels\) stayed below --strict-min-cluster 4/,
  );
});

test("crop 対は bbox を --crop-margin だけ広げ、画像の内側に切り詰めて current と new から切り出す", () => {
  const run = runScene(
    10,
    10,
    {
      marked: maskOfPoints(10, 10, [
        [0, 0],
        [7, 7],
      ]),
    },
    ["--pad", "0", "--crop-margin", "2"],
  );

  const out = parsed(run);
  expect(run.code).toBe(1);
  // 左上の領域は画像の端で切り詰める（x0 = 0、幅 = 1 + 2）。右下は両側に 2 ずつ広げる（5×5）。
  const sizes = out.regions.map((r) => {
    const crop = decodePng(readFileSync(r.crop_current));
    return [r.bbox, crop.width, crop.height];
  });
  expect(sizes).toEqual([
    [{ x: 0, y: 0, width: 1, height: 1 }, 3, 3],
    [{ x: 7, y: 7, width: 1, height: 1 }, 5, 5],
  ]);
  // crop の中心（元の (7,7)）は、current では元の色、new では差分の色になる。
  const second = out.regions[1];
  assert.exists(second, "2 件目の領域が無い");
  const cur = decodePng(readFileSync(second.crop_current));
  const next = decodePng(readFileSync(second.crop_new));
  const center = (2 * 5 + 2) * 4;
  expect([...cur.data.subarray(center, center + 4)]).toEqual(BASE);
  expect([...next.data.subarray(center, center + 4)]).toEqual(STRONG);
});

test("--diff-color で印の色を変えると、その色の画素だけを差分として数える（# 付きも受け付ける）", () => {
  const run = runRaw(
    2,
    1,
    { current: [BASE, BASE], next: [STRONG, STRONG], diff: [[0, 255, 0, 255], RED] },
    ["--diff-color", "#00ff00"],
  );

  const out = parsed(run);
  expect(out.summary.threshold_pixels).toBe(1);
  expect(out.regions.map((r) => r.threshold_bbox)).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
});

// --- 入力の誤り（exit 2）---

test.each([
  ["位置引数が 2 つ", ["a.png", "b.png", "--out", "o"], /^usage: /],
  ["--out が無い", ["a.png", "b.png", "c.png"], /^usage: /],
])("引数が足りなければ使い方を出して exit 2（%s）", (_label, argv, message) => {
  const res = spawnSync(process.execPath, ["--import", HOOKS, SCRIPT, ...argv], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(message);
  expect(res.stdout).toBe("");
});

const ONE_PIXEL = { current: [BASE], next: [BASE], diff: [WHITE] };

test.each([
  [["--min-cluster", "0"], /--min-cluster must be >= 1/],
  [["--pad", "-1"], /--min-cluster must be >= 1, --pad and --crop-margin must be >= 0/],
  [["--crop-margin", "abc"], /--pad and --crop-margin must be >= 0/],
  [["--strict-min-cluster", "0"], /--strict-min-cluster and --strict-max-regions must be >= 1/],
  [["--strict-max-regions", "x"], /--strict-min-cluster and --strict-max-regions must be >= 1/],
  [["--diff-color", "red"], /--diff-color must be a 6-digit hex color/],
])("数値と色の引数の誤りは exit 2（%j）", (args, message) => {
  const run = runRaw(1, 1, ONE_PIXEL, args);
  expect(run.code).toBe(2);
  expect(run.stderr).toMatch(message);
  expect(run.stdout).toBe("");
});

test("pngjs が無ければ導入を確かめるよう促して exit 2（勝手にインストールしない）", () => {
  const png = encodePng(1, 1, Uint8Array.from(BASE));
  const run = runFiles(
    makeTempDir("pixel-crops-"),
    { current: png, next: png, diff: png },
    [],
    false,
  );

  expect(run.code).toBe(2);
  expect(run.stderr).toMatch(/pngjs is not installed/);
  expect(existsSync(run.out)).toBe(false);
});

test("PNG として読めない入力は exit 2", () => {
  const png = encodePng(1, 1, Uint8Array.from(BASE));
  const run = runFiles(makeTempDir("pixel-crops-"), {
    current: png,
    next: Buffer.from("not a png"),
    diff: png,
  });

  expect(run.code).toBe(2);
  expect(run.stderr).toMatch(/cannot read PNG inputs/);
});

test.each([
  ["new の幅が違う", { current: [2, 1], next: [1, 1], diff: [2, 1] }],
  ["diff の高さが違う", { current: [2, 1], next: [2, 1], diff: [2, 2] }],
])("3 枚の寸法が揃わなければ exit 2（%s）", (_label, sizes) => {
  const png = ([w, h]: number[]) =>
    encodePng(w ?? 0, h ?? 0, new Uint8Array((w ?? 0) * (h ?? 0) * 4).fill(255));
  const run = runFiles(makeTempDir("pixel-crops-"), {
    current: png(sizes.current),
    next: png(sizes.next),
    diff: png(sizes.diff),
  });

  expect(run.code).toBe(2);
  expect(run.stderr).toMatch(/PNG dimensions differ \(must match\)/);
});

test("--out にディレクトリを作れなければ exit 2", () => {
  const dir = makeTempDir("pixel-crops-");
  const png = encodePng(1, 1, Uint8Array.from(BASE));
  writeFileSync(join(dir, "out"), "ファイルがあるのでディレクトリを作れない");

  const run = runFiles(dir, { current: png, next: png, diff: png });

  expect(run.code).toBe(2);
  expect(run.stderr).toMatch(/cannot create out dir/);
});

test.each([
  ["しきい値つきの領域", "crop-1-current.png", { marked: maskOfPoints(4, 4, [[0, 0]]) }],
  [
    "strict-only の候補",
    "crop-s1-current.png",
    { subtle: maskWith(4, 4, [{ x: 0, y: 0, w: 2, h: 2 }]) },
  ],
])("crop を書けなければ exit 2（%s）", (_label, blocked, scene) => {
  const dir = makeTempDir("pixel-crops-");
  // 書き出す先と同じ名前のディレクトリを置き、crop の書き込みを失敗させる。
  mkdirSync(join(dir, "out", blocked), { recursive: true });
  const run = runScene(4, 4, scene, [], dir);

  expect(run.code).toBe(2);
  expect(run.stderr).toMatch(/cannot write crops/);
});
