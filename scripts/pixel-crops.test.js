// 画素の量を「しきい値つき」と「しきい値なし」の 2 本で報告する回帰テスト（Issue #384）。
// pngjs はこのリポジトリに入れないため、PNG を読まない純関数だけを対象にする
// （CLI 経路は pixel-crops.mjs の main が同じ関数を呼ぶ）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  // しきい値マスクを渡さない呼び出しでは「内側」の集合が定まらない。0 に倒すと
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

// --- 下限未満の strict-only を黙って捨てない（PR #395 の codex レビュー 2 巡目 P1）---
// 落としてからマージすると、1〜3 画素に散った差が合流する前に全部消え、
// strict_only_pixels > 0 なのに候補ゼロ・exit 0 という fail-open に戻る。

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

test("マージしても下限に届かない分は件数と画素数で報告する（黙って捨てない）", () => {
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
