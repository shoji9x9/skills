// ノイズ基準値の画素計数（原本）。同一条件で 2 回撮った PNG から、しきい値なしの差分画素を数える。
// 原本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
//
// 何のためか: `metadata.json.noise_baseline[]` は `pixel_diff`（記録済みツールのしきい値つき）だけでなく
// `pixel_diff_strict` / `pixel_diff_strict_only` を持つ。`parity-diff` は現新差の strict な計数を
// **同じ軸の基準値**と対比するため、しきい値つきの値しか無いと通常の描画揺れが必ず超過になる。
//
// なぜ parity-suite に同梱するか: 本スキルの前提は `replace-strategy` と `golden-dataset` だけで、
// `parity-diff` は入っていないことがある。同じ数を出す実装が手元に無いと、この項目を決定論的に埋められない
// （配布スキルは、実行時に使う成果物を同梱する）。**`parity-diff` の `scripts/pixel-crops.mjs` に同じ計数がある**が、
// 同梱スクリプトは互いを import しない（インストール先が別々のため）。片方の計数規則を直したらもう片方も直す。
//
// 決定論的: 乱数・現在時刻に依存しない。PNG のデコードは pngjs を使う（記録済みツールが pixelmatch なら
// プロジェクトに入っていることが多い。無ければ導入をユーザーに確認する。本スクリプトは勝手にインストールしない）。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync } from "node:fs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";

/**
 * ツールのバージョン（原本）。計数規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/**
 * 差分色判定のチャンネル許容差（既定）。`parity-diff` の pixel-crops.mjs と同じ値にする。
 * @type {number}
 */
export const DEFAULT_COLOR_TOLERANCE = 96;

/**
 * 16 進カラー文字列（"ff0000" / "#ff0000"）を RGB に変換する。
 * @param {string} hex
 * @returns {{ r:number, g:number, b:number } | null}
 */
export function hexToRgb(hex) {
  const s = String(hex).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/**
 * 差分画像でマークされた画素のマスクを作る（`--diff` を渡したときだけ使う）。
 * @param {Uint8Array | Buffer} data - 長さ width*height*4 の RGBA
 * @param {number} pixels - width*height
 * @param {{ target: { r:number, g:number, b:number }, tol: number }} color - 差分色と許容差
 * @returns {Uint8Array}
 */
export function buildMarkedMask(data, pixels, { target, tol }) {
  const mask = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    mask[i] =
      Math.abs(data[o] - target.r) <= tol &&
      Math.abs(data[o + 1] - target.g) <= tol &&
      Math.abs(data[o + 2] - target.b) <= tol
        ? 1
        : 0;
  }
  return mask;
}

/**
 * 2 枚の RGBA バッファを**しきい値なしで**突き合わせて数える。
 *
 * 両側とも完全な透明な画素は、隠れている RGB が違っても画面には同じものが出るので差にしない
 * （片側だけ透明なら透明化そのものが見た目の差なので数える）。
 *
 * `markedMask` を渡すと、そのうちマークされていない分（＝しきい値の内側に隠れた差）も数える。
 * @param {Uint8Array | Buffer} aData
 * @param {Uint8Array | Buffer} bData
 * @param {{ pixels: number, markedMask?: Uint8Array | null }} options - pixels は width*height
 * @returns {{ total_pixels:number, strict_pixels:number, strict_only_pixels:(number|null),
 *             strict_max_channel_delta:number, strict_only_max_channel_delta:(number|null),
 *             strict_ratio:number }}
 */
export function countStrictDiff(aData, bData, { pixels, markedMask = null }) {
  let strict = 0;
  let strictOnly = 0;
  let maxDelta = 0;
  let maxStrictOnlyDelta = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    let delta = 0;
    const bothTransparent = aData[o + 3] === 0 && bData[o + 3] === 0;
    if (!bothTransparent) {
      for (let c = 0; c < 4; c += 1) {
        const d = Math.abs(aData[o + c] - bData[o + c]);
        if (d > delta) delta = d;
      }
    }
    if (delta === 0) continue;
    strict += 1;
    if (delta > maxDelta) maxDelta = delta;
    if (markedMask !== null && markedMask[i] === 0) {
      strictOnly += 1;
      if (delta > maxStrictOnlyDelta) maxStrictOnlyDelta = delta;
    }
  }
  return {
    total_pixels: pixels,
    strict_pixels: strict,
    strict_only_pixels: markedMask === null ? null : strictOnly,
    strict_max_channel_delta: maxDelta,
    strict_only_max_channel_delta: markedMask === null ? null : maxStrictOnlyDelta,
    strict_ratio: pixels === 0 ? 0 : Number(((strict / pixels) * 100).toFixed(4)),
  };
}

/**
 * pngjs を動的 import する（未導入なら null）。ここで使う `PNG.sync.read` の形だけを書く。
 * @returns {Promise<{ sync: { read(buf: Uint8Array): { width: number, height: number, data: Uint8Array } } } | null>}
 */
async function loadPng() {
  try {
    const mod = await import("pngjs");
    return mod.PNG;
  } catch {
    return null;
  }
}

const USAGE =
  "usage: node pixel-strict-count.mjs <pass1.png> <pass2.png> [--diff <diff.png>] [--diff-color <hex>]\n";

/**
 * CLI の引数。
 * @typedef {{ positionals: string[], diffPath: string | undefined, diffRequested: boolean, diffColor: string }} CliArgs
 */

/**
 * 引数を読む。
 * @param {string[]} argv
 * @returns {CliArgs}
 */
function parseArgs(argv) {
  const positionals = [];
  let diffPath;
  // 「--diff を渡していない」と「--diff の値が空」を区別する。区別しないと、値が空に展開された呼び出しが
  // strict_only_pixels: null のまま exit 0 で通り、基準値を埋められないまま 2 回目の採取物が消える。
  let diffRequested = false;
  let diffColor = "ff0000";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--diff") {
      diffRequested = true;
      diffPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--diff-color") {
      diffColor = argv[i + 1];
      i += 1;
    } else {
      positionals.push(argv[i]);
    }
  }
  return { positionals, diffPath, diffRequested, diffColor };
}

/**
 * 引数の誤りを確かめる。誤りは stderr に書いて null を返し、無ければ差分色の RGB を返す。
 * @param {CliArgs} args
 * @returns {{ r:number, g:number, b:number } | null}
 */
function checkArgs({ positionals, diffPath, diffRequested, diffColor }) {
  if (positionals.length !== 2) {
    process.stderr.write(USAGE);
    return null;
  }
  if (diffRequested && (diffPath === undefined || String(diffPath).trim() === "")) {
    process.stderr.write("error: --diff requires a path to the recorded tool's diff image\n");
    return null;
  }
  const target = hexToRgb(diffColor);
  if (!target) {
    process.stderr.write("error: --diff-color must be a 6-digit hex color (e.g. ff0000)\n");
    return null;
  }
  return target;
}

/**
 * 2 枚の撮影と差分画像（渡したときだけ）を読み、寸法が揃うかを確かめる。誤りは stderr に書いて null を返す。
 * @param {{ sync: { read(buf: Uint8Array): { width: number, height: number, data: Uint8Array } } }} PNG
 * @param {string[]} positionals - 2 枚の撮影のパス
 * @param {string | undefined} diffPath
 * @returns {{ first: { width: number, height: number, data: Uint8Array }, second: { width: number, height: number, data: Uint8Array }, diff: { width: number, height: number, data: Uint8Array } | null } | null}
 */
function readCaptures(PNG, positionals, diffPath) {
  let first;
  let second;
  let diff = null;
  try {
    first = PNG.sync.read(readFileSync(positionals[0]));
    second = PNG.sync.read(readFileSync(positionals[1]));
    if (diffPath) diff = PNG.sync.read(readFileSync(diffPath));
  } catch (err) {
    const message = errorMessage(err);
    process.stderr.write(`error: cannot read PNG inputs: ${message}\n`);
    return null;
  }
  if (first.width !== second.width || first.height !== second.height) {
    process.stderr.write(
      `error: PNG dimensions differ (must match): ${first.width}x${first.height} vs ${second.width}x${second.height}\n`,
    );
    return null;
  }
  if (diff && (diff.width !== first.width || diff.height !== first.height)) {
    process.stderr.write("error: --diff PNG dimensions must match the two captures\n");
    return null;
  }
  return { first, second, diff };
}

/**
 * CLI エントリ。
 * `node pixel-strict-count.mjs <pass1.png> <pass2.png> [--diff <diff.png>] [--diff-color <hex>]`
 * 数えた結果を JSON で出力する。`--diff`（記録済みツールが出した差分画像）を渡すと
 * `strict_only_pixels` も出る。exit 0=計数した / 2=入力エラー（計数そのものは合否ではない）。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const args = parseArgs(argv);
  const target = checkArgs(args);
  if (!target) return 2;
  const PNG = await loadPng();
  if (!PNG) {
    process.stderr.write(
      "error: pngjs is not installed. install it in the project or confirm with the user before proceeding\n",
    );
    return 2;
  }
  const captures = readCaptures(PNG, args.positionals, args.diffPath);
  if (!captures) return 2;
  const { first, second, diff } = captures;
  const pixels = first.width * first.height;
  const markedMask = diff
    ? buildMarkedMask(diff.data, pixels, { target, tol: DEFAULT_COLOR_TOLERANCE })
    : null;
  const counted = countStrictDiff(first.data, second.data, { pixels, markedMask });
  process.stdout.write(JSON.stringify(counted, null, 2) + "\n");
  return 0;
}

if (isCliEntry(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      const message = errorMessage(err);
      process.stderr.write(`error: ${message}\n`);
      process.exit(2);
    });
}
