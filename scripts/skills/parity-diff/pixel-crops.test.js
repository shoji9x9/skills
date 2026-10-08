// 画素の量を「しきい値つき」と「しきい値なし」の 2 本で報告する回帰テスト（Issue #384）。
// pngjs はこのリポジトリに入れないため、PNG を読まない純関数だけを対象にする
// （CLI から呼んだ場合も、pixel-crops.mjs の main が同じ関数を呼ぶ）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-diff/scripts/pixel-crops.mjs");
const {
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
} = await import(script);

// RGBA バッファを作る。pixels は [r,g,b,a] の配列。
const rgba = (pixels) => Uint8Array.from(pixels.flat());

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

  const thresholdMask = buildDiffMask(diff, 3, 1, hexToRgb("ff0000"), 96);
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
  // しきい値マスクを渡さない呼び出しでは「内側」の集合が定まらない。0 として扱うと
  // 「隠れた差は無い」と読めてしまうので null を返す。
  expect(strict.maxStrictOnlyChannelDelta).toBeNull();
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
  const thresholdMask = Uint8Array.from([1, 0, 0, 0]);
  const strictMask = Uint8Array.from([1, 1, 0, 0]);

  expect([...buildStrictOnlyMask(thresholdMask, strictMask)]).toEqual([0, 1, 0, 0]);
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
  const components = [
    { pixels: 1, bbox: { x: 0, y: 0, width: 1, height: 1 } },
    { pixels: 1, bbox: { x: 3, y: 0, width: 1, height: 1 } },
    { pixels: 1, bbox: { x: 6, y: 0, width: 1, height: 1 } },
    { pixels: 1, bbox: { x: 9, y: 0, width: 1, height: 1 } },
  ];

  const merged = mergeThenFilter(components, 4, 8);
  expect(merged.kept).toHaveLength(1);
  expect(merged.kept[0].pixels).toBe(4);
  expect(merged.droppedClusters).toBe(0);

  // 同じ入力を「落としてからマージ」に掛けると 1 件も残らない（旧実装の失敗）。
  expect(filterAndMerge(components, 4, 8)).toHaveLength(0);
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
  // 入力の並びは (y, x) 昇順と違える——入力順で採番する実装だと、この順序差で id がずれる。
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

/** width×height のマスクに、矩形（x, y, w, h）の輪郭か塗りを立てる。 */
function maskWith(width, height, rects) {
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

/** main と同じ段取りで regions / strict-only を作る（PNG を読まない部分）。 */
function candidates(
  thresholdMask,
  strictOnlyMask,
  width,
  height,
  withAbsorb = true,
  minCluster = 4,
) {
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

/** width×height のマスクに、点の並び [[x, y], ...] を立てる。 */
function maskOfPoints(width, height, points) {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of points) mask[y * width + x] = 1;
  return mask;
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

test("取り込まなければ同じ差が 2 件になる（検出されることの確認: 取り込みが機能していること）", () => {
  const thresholdMask = maskWith(W, H, [core]);
  const strictOnly = buildStrictOnlyMask(thresholdMask, maskWith(W, H, [core, halo]));

  const { regions, strict } = candidates(thresholdMask, strictOnly, W, H, false);

  expect(regions).toHaveLength(1);
  expect(regions[0].bbox).toEqual({ x: 12, y: 11, width: 6, height: 9 });
  expect(strict.kept).toHaveLength(1);
  expect(strict.kept[0].bbox).toEqual({ x: 8, y: 10, width: 11, height: 11 });
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
  expect(loose.kept.find((r) => r.id === "s1").bbox).toEqual(strict.kept[0].bbox);
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
