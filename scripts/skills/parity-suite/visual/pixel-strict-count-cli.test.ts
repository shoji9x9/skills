// ノイズ基準値の strict 計数（pixel-strict-count.mjs）の CLI の回帰テスト。
// pngjs はこのリポジトリに入れないので、子プロセスの `pngjs` の import を、PNG を読み書きする偽物
// （scripts/lib/testing/fake-pngjs.ts）に向ける。偽物が置き換えるのは PNG の読み書きだけで、
// 引数の解釈・寸法の照合・差分画像のマーク・計数は、スキルのスクリプトがそのまま行う。

import { expect, test } from "vitest";
import { join } from "node:path";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { writeImage, run } from "./pixel-strict-count-cli-helpers.ts";

/** main が出す計数の JSON。 */
type Counted = {
  total_pixels: number;
  strict_pixels: number;
  strict_only_pixels: number | null;
  strict_max_channel_delta: number;
  strict_only_max_channel_delta: number | null;
  strict_ratio: number;
};

const RED = [255, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

// 1 画素目は 1/255 の差（しきい値つきのツールは飲む）、2 画素目は黒と白、3・4 画素目は同じ。
const FIRST = [
  [162, 101, 36, 255],
  [0, 0, 0, 255],
  [5, 5, 5, 255],
  [9, 9, 9, 255],
];
const SECOND = [
  [162, 102, 36, 255],
  [255, 255, 255, 255],
  [5, 5, 5, 255],
  [9, 9, 9, 255],
];

test("2 回の撮影と差分画像から、しきい値なしの画素数とマークされていない分を JSON で出す", () => {
  const dir = makeTempDir("pixel-strict-");
  const a = writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  const b = writeImage(dir, "pass2.png", { width: 2, pixels: SECOND });
  // 記録済みツールは 2 画素目だけを赤でマークした。赤からの差が 96 以内（200, 40, 40）もマークとして数える
  const diff = writeImage(dir, "diff.png", {
    width: 2,
    pixels: [WHITE, [200, 40, 40, 255], WHITE, WHITE],
  });

  const r = run([a, b, "--diff", diff]);

  expect(r.code).toBe(0);
  expect(parseJsonAs<Counted>(r.stdout)).toEqual({
    total_pixels: 4,
    strict_pixels: 2,
    strict_only_pixels: 1,
    strict_max_channel_delta: 255,
    strict_only_max_channel_delta: 1,
    strict_ratio: 50,
  });
});

test("差分の色が赤から 96 を超えて離れた画素はマークとして数えない", () => {
  const dir = makeTempDir("pixel-strict-far-");
  const a = writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  const b = writeImage(dir, "pass2.png", { width: 2, pixels: SECOND });
  // 2 画素目の (150, 0, 0) は R の差が 105 で、マークの外になる
  const diff = writeImage(dir, "diff.png", {
    width: 2,
    pixels: [WHITE, [150, 0, 0, 255], WHITE, WHITE],
  });

  const r = run([a, b, "--diff", diff]);

  expect(r.code).toBe(0);
  expect(parseJsonAs<Counted>(r.stdout)).toMatchObject({
    strict_pixels: 2,
    strict_only_pixels: 2,
    strict_only_max_channel_delta: 255,
  });
});

test("--diff-color でマークの色を変える（# 付きも受ける）", () => {
  const dir = makeTempDir("pixel-strict-color-");
  const a = writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  const b = writeImage(dir, "pass2.png", { width: 2, pixels: SECOND });
  // 記録済みツールは 1・2 画素目を緑でマークした
  const green = [0, 255, 0, 255];
  const diff = writeImage(dir, "diff.png", { width: 2, pixels: [green, green, RED, WHITE] });

  const r = run([a, b, "--diff", diff, "--diff-color", "#00FF00"]);

  expect(r.code).toBe(0);
  expect(parseJsonAs<Counted>(r.stdout)).toMatchObject({
    strict_pixels: 2,
    strict_only_pixels: 0,
    strict_only_max_channel_delta: 0,
  });
});

test("差分画像を渡さなければ strict_only は null で出す（0 と区別する）", () => {
  const dir = makeTempDir("pixel-strict-nodiff-");
  const a = writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  const b = writeImage(dir, "pass2.png", { width: 2, pixels: SECOND });

  const r = run([a, b]);

  expect(r.code).toBe(0);
  expect(parseJsonAs<Counted>(r.stdout)).toMatchObject({
    strict_pixels: 2,
    strict_only_pixels: null,
    strict_only_max_channel_delta: null,
  });
});

test("2 回の撮影の寸法が違えば、計数せず exit 2", () => {
  const dir = makeTempDir("pixel-strict-size-");
  const a = writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  const b = writeImage(dir, "pass2.png", { width: 4, pixels: SECOND });

  const r = run([a, b]);

  expect(r.code).toBe(2);
  expect(r.stderr).toContain("PNG dimensions differ (must match): 2x2 vs 4x1");
  expect(r.stdout).toBe("");
});

test("差分画像の寸法が撮影と違えば、計数せず exit 2", () => {
  const dir = makeTempDir("pixel-strict-diffsize-");
  const a = writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  const b = writeImage(dir, "pass2.png", { width: 2, pixels: SECOND });
  const diff = writeImage(dir, "diff.png", { width: 1, pixels: [RED, RED, RED, RED] });

  const r = run([a, b, "--diff", diff]);

  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--diff PNG dimensions must match the two captures");
  expect(r.stdout).toBe("");
});

test.each([
  ["1 回目の撮影が無い", ["missing.png", "pass2.png"]],
  ["差分画像が無い", ["pass1.png", "pass2.png", "--diff", "missing.png"]],
])("入力の PNG を読めなければ（%s）、計数せず exit 2", (_label, names) => {
  const dir = makeTempDir("pixel-strict-unreadable-");
  writeImage(dir, "pass1.png", { width: 2, pixels: FIRST });
  writeImage(dir, "pass2.png", { width: 2, pixels: SECOND });
  const argv = names.map((n) => (n.endsWith(".png") ? join(dir, n) : n));

  const r = run(argv);

  expect(r.code).toBe(2);
  expect(r.stderr).toContain("error: cannot read PNG inputs:");
  expect(r.stdout).toBe("");
});
