// ノイズ基準値の strict 計数（parity-suite 同梱）の回帰テスト（PR #395 の codex レビュー 4 巡目 P2）。
// parity-diff の pixel-crops.mjs と同じ計数規則であることも、同じ入力で突き合わせて固定する。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const counter = await import(join(repoRoot, "skills/parity-suite/scripts/pixel-strict-count.mjs"));
const crops = await import(join(repoRoot, "skills/parity-diff/scripts/pixel-crops.mjs"));

const rgba = (pixels) => Uint8Array.from(pixels.flat());

test("しきい値なしの画素数と、マークされていない分を数える", () => {
  const first = rgba([
    [162, 101, 36, 255],
    [0, 0, 0, 255],
    [5, 5, 5, 255],
  ]);
  const second = rgba([
    [162, 102, 36, 255],
    [255, 255, 255, 255],
    [5, 5, 5, 255],
  ]);
  // 記録済みツールは 2 画素目だけをマークした（1/255 の差は飲んでいる）。
  const marked = Uint8Array.from([0, 1, 0]);

  const counted = counter.countStrictDiff(first, second, 3, marked);

  expect(counted.strict_pixels).toBe(2);
  expect(counted.strict_only_pixels).toBe(1);
  expect(counted.strict_only_max_channel_delta).toBe(1);
  expect(counted.strict_max_channel_delta).toBe(255);
});

test("差分画像を渡さなければ strict_only は null（0 と区別する）", () => {
  const first = rgba([[1, 2, 3, 255]]);
  const second = rgba([[1, 2, 4, 255]]);

  const counted = counter.countStrictDiff(first, second, 1);

  expect(counted.strict_pixels).toBe(1);
  expect(counted.strict_only_pixels).toBeNull();
  expect(counted.strict_only_max_channel_delta).toBeNull();
});

test("両側とも完全な透明なら差にしない（片側だけ透明なら数える）", () => {
  const hidden = counter.countStrictDiff(rgba([[10, 20, 30, 0]]), rgba([[90, 80, 70, 0]]), 1);
  const appeared = counter.countStrictDiff(rgba([[10, 20, 30, 255]]), rgba([[10, 20, 30, 0]]), 1);

  expect(hidden.strict_pixels).toBe(0);
  expect(appeared.strict_pixels).toBe(1);
});

// 同梱スクリプトは互いを import しないので、計数規則が割れていないことをテストで固定する
// （片方を直したらもう片方も直す、の検出点）。
test("parity-diff の pixel-crops.mjs と同じ画素数・最大チャンネル差を出す", () => {
  const first = rgba([
    [162, 101, 36, 255],
    [10, 20, 30, 0],
    [0, 0, 0, 255],
    [7, 7, 7, 255],
  ]);
  const second = rgba([
    [162, 102, 36, 255],
    [90, 80, 70, 0],
    [255, 255, 255, 255],
    [7, 7, 7, 255],
  ]);

  const mine = counter.countStrictDiff(first, second, 4);
  const theirs = crops.buildStrictMask(first, second, 4);

  expect(mine.strict_pixels).toBe(theirs.count);
  expect(mine.strict_max_channel_delta).toBe(theirs.maxChannelDelta);
});
