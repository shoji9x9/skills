// 画素の量を「しきい値つき」と「しきい値なし」の 2 本で報告する回帰テスト（Issue #384）。
// pngjs はこのリポジトリに入れないため、PNG を読まない純関数だけを対象にする
// （CLI 経路は pixel-crops.mjs の main が同じ関数を呼ぶ）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-diff/scripts/pixel-crops.mjs");
const { buildStrictMask, summarizePixels, countInBbox, buildDiffMask, hexToRgb } = await import(
  script
);

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
