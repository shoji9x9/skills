// ノイズ基準値の 2 回撮りで差が出た領域から、マスクの候補になる要素を探す（原本）。
// 原本はこのスキル側にあり、実行時はプロジェクトの `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う。
//
// なぜ要るか: 2 回撮りで差が出ても、差の量（pixel_diff など）しか記録しないと、どの要素が揺れたかが分からない。
// マスクを当てる場所を、人が差分の画像から探すことになる。
//
// 何をするか: 2 回目を撮った直後に、開いたままのページで次を行う。
//   1. 1 回目と 2 回目の PNG を比べ、しきい値なしで違う画素を、近いものどうしまとめた矩形（領域）にする（diffRegions）
//   2. 領域ごとに、領域を丸ごと覆う要素をページで探す。その要素か祖先に overflow で切り取る要素（overflow が visible 以外）があり、
//      それも領域を覆うなら、いちばん近いものを選ぶ。切り取る要素の中で動く中身（カルーセルの帯など）は、中身ではなく
//      切り取る枠にマスクを当てないと、塗る範囲が枠の外まで広がるからである（locateRegionsInPage）
//   3. 選んだ要素を 1 つだけ指す CSS セレクタを作る
// 要素を特定できないとき（html・body しか覆わない、セレクタが 1 つに決まらない）は、領域の座標だけを報告し、
// selector を null にする。特定できたことにしない。
//
// 2 回目を撮った直後に呼ぶのは、ページが撮ったときの状態のまま残っているからである。
// 全画面で撮った領域を探すときはページをスクロールするので、同じ組で他の採取をするなら、この後に置かない。
//
// 依存: pngjs（PNG のデコード）。pixel-strict-count.mjs と同じく、無ければ入れてよいかを利用者に確かめる（勝手にインストールしない）。
// Playwright はピア前提であり import しない（Page は引数で受け取る）。TypeScript 構文は使わない（型は JSDoc）。

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { PAGE_VERSION, locateRegionsInPage } from "./page/noise-masks.page.mjs";

/**
 * ツールのバージョン（原本）。領域のまとめ方・要素の選び方・出力の形を変えたら上げる。
 * 上げるときは、page/noise-masks.page.mjs の PAGE_VERSION も同じ値にする（違うと suggestNoiseMasks が探さずに止める）。
 * @type {string}
 */
export const VERSION = "1";

/**
 * page ファイルの PAGE_VERSION が、このスクリプトの VERSION と同じかを確かめる。違えば、片方だけを古いバージョンのまま
 * コピーしてあるので、探さずに失敗する。
 * @param {string} pageVersion
 */
export function assertPageVersion(pageVersion) {
  if (pageVersion !== VERSION) {
    throw new Error(
      `noise masks: page/noise-masks.page.mjs has PAGE_VERSION ${pageVersion} but noise-masks.mjs has VERSION ${VERSION}; copy both files from the same version`,
    );
  }
}

/** 近い差分の画素を 1 つの領域にまとめる升目の幅（CSS px）。升目が隣り合えば（斜めを含む）同じ領域にする。 */
export const CELL_CSS_PX = 8;

/** 報告する領域の上限。超えた分は件数だけを `omitted_regions` に残す。 */
export const MAX_REGIONS = 50;

/**
 * 矩形（PNG なら画素、ページなら CSS px）。
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/** @typedef {import("./page/noise-masks.page.mjs").LocatedRegion} LocatedRegion */

/**
 * マスクの候補。同じセレクタに当たった領域を 1 つにまとめる。
 * @typedef {{
 *   selector: string,
 *   basis: "clipping-ancestor" | "covering",
 *   element_rect: Rect,
 *   regions: Rect[],
 * }} MaskCandidate
 */

/** @typedef {import("./page/noise-masks.page.mjs").UnlocatedRegion} UnlocatedRegion */

/**
 * 升目の中の、違う画素を囲む矩形（両端を含む画素の座標）。
 * @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box
 */

/**
 * 画素 1 つが 2 枚で違うか（RGBA のどれかの値が違えば違う）。
 * @param {Uint8Array} first
 * @param {Uint8Array} second
 * @param {number} i - 画素の先頭の添字（画素の番号 × 4）
 * @returns {boolean}
 */
function pixelDiffers(first, second, i) {
  return (
    first[i] !== second[i] ||
    first[i + 1] !== second[i + 1] ||
    first[i + 2] !== second[i + 2] ||
    first[i + 3] !== second[i + 3]
  );
}

/**
 * 升目ごとに、違う画素を囲む矩形を集める（違う画素の無い升目は null）。
 * @param {Uint8Array} first
 * @param {Uint8Array} second
 * @param {{ width: number, height: number, cell: number, cols: number, rows: number }} grid
 * @returns {(Box | null)[]}
 */
function cellBoxes(first, second, { width, height, cell, cols, rows }) {
  /** @type {(Box | null)[]} */
  const boxes = Array.from({ length: cols * rows }, () => null);
  for (let y = 0; y < height; y += 1) {
    const rowStart = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x += 1) {
      if (!pixelDiffers(first, second, (y * width + x) * 4)) continue;
      const index = rowStart + Math.floor(x / cell);
      const box = boxes[index];
      // 行を上から順に読むので、y0 は最初の画素で決まり、y1 は今の行になる
      if (box === null) boxes[index] = { x0: x, y0: y, x1: x, y1: y };
      else {
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.y1 = y;
      }
    }
  }
  return boxes;
}

/**
 * 升目の隣（斜めを含む 8 方向）のうち、格子の中にある升目の番号。
 * @param {number} index
 * @param {number} cols
 * @param {number} rows
 * @returns {number[]}
 */
function neighborCells(index, cols, rows) {
  const cx = index % cols;
  const cy = Math.floor(index / cols);
  /** @type {number[]} */
  const found = [];
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) found.push(ny * cols + nx);
  }
  return found;
}

/**
 * start の升目から、隣り合う差分のある升目をたどり、まとめた矩形を返す。たどった升目には印を付ける。
 * @param {(Box | null)[]} boxes
 * @param {Uint8Array} seen
 * @param {{ start: number, startBox: Box, cols: number, rows: number }} from - startBox は boxes[start]
 * @returns {Box}
 */
function mergeConnected(boxes, seen, { start, startBox, cols, rows }) {
  seen[start] = 1;
  const stack = [start];
  const union = { ...startBox };
  for (let index = stack.pop(); index !== undefined; index = stack.pop()) {
    const box = boxes[index];
    if (box === null) continue;
    union.x0 = Math.min(union.x0, box.x0);
    union.y0 = Math.min(union.y0, box.y0);
    union.x1 = Math.max(union.x1, box.x1);
    union.y1 = Math.max(union.y1, box.y1);
    for (const neighbor of neighborCells(index, cols, rows)) {
      if (boxes[neighbor] === null || seen[neighbor] === 1) continue;
      seen[neighbor] = 1;
      stack.push(neighbor);
    }
  }
  return union;
}

/**
 * 2 枚の RGBA の画像で、しきい値なしで違う画素を、升目でまとめた領域にする。
 * 升目（cell × cell 画素）のどれかの画素が違えば、その升目を差分ありとし、隣り合う（斜めを含む）升目を 1 つの領域にする。
 * 領域の矩形は、升目ではなく、実際に違う画素を囲む最小の矩形にする。
 * @param {Uint8Array} first - 長さ width*height*4
 * @param {Uint8Array} second - 長さ width*height*4
 * @param {{ width: number, height: number, cell: number }} size
 * @returns {Rect[]} 画素の座標の矩形。上から、同じ高さなら左から並べる
 */
export function diffRegions(first, second, { width, height, cell }) {
  if (first.length !== width * height * 4 || second.length !== width * height * 4) {
    throw new Error(`image data length does not match ${width}x${height}`);
  }
  if (!Number.isInteger(cell) || cell < 1) {
    throw new Error(`cell must be a positive integer (got ${cell})`);
  }
  // 2 回撮りでは差の無い組が多いので、画素を 1 つずつ比べる前にまとめて比べる
  if (Buffer.from(first.buffer, first.byteOffset, first.byteLength).equals(second)) return [];
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const boxes = cellBoxes(first, second, { width, height, cell, cols, rows });
  const seen = new Uint8Array(cols * rows);
  /** @type {Rect[]} */
  const regions = [];
  for (let start = 0; start < boxes.length; start += 1) {
    const startBox = boxes[start];
    if (startBox === null || seen[start] === 1) continue;
    const union = mergeConnected(boxes, seen, { start, startBox, cols, rows });
    regions.push({
      x: union.x0,
      y: union.y0,
      width: union.x1 - union.x0 + 1,
      height: union.y1 - union.y0 + 1,
    });
  }
  return regions.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * 画素の矩形を CSS px の矩形にする。外側へ丸める（領域を狭めない）。
 * @param {Rect} rect
 * @param {number} dpr
 * @returns {Rect}
 */
export function toCssRect(rect, dpr) {
  const x = Math.floor(rect.x / dpr);
  const y = Math.floor(rect.y / dpr);
  return {
    x,
    y,
    width: Math.ceil((rect.x + rect.width) / dpr) - x,
    height: Math.ceil((rect.y + rect.height) / dpr) - y,
  };
}

/**
 * ページで探した結果を、セレクタごとの候補と、特定できなかった領域に分ける。
 * 候補は最初に現れた順、領域はページで探した順に並べる。
 * @param {LocatedRegion[]} located
 * @returns {{ candidates: MaskCandidate[], unlocated: UnlocatedRegion[] }}
 */
export function groupLocatedRegions(located) {
  /** @type {Map<string, MaskCandidate>} */
  const bySelector = new Map();
  /** @type {UnlocatedRegion[]} */
  const unlocated = [];
  for (const entry of located) {
    if ("reason" in entry) {
      unlocated.push(entry);
      continue;
    }
    const known = bySelector.get(entry.selector);
    if (known === undefined) {
      bySelector.set(entry.selector, {
        selector: entry.selector,
        basis: entry.basis,
        element_rect: entry.element_rect,
        regions: [entry.region],
      });
    } else {
      known.regions.push(entry.region);
    }
  }
  return { candidates: [...bySelector.values()], unlocated };
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

/**
 * 2 回撮りの PNG を比べ、差の領域ごとにマスクの候補を返す。2 回目を撮った直後に、同じページで呼ぶ。
 * 返した値は、2 回目の組のディレクトリへ `mask-candidates.json` として書き、ノイズ基準値の記録で
 * `noise_baseline[].mask_candidates` に転記する。形の原本は parity-suite の references/baseline.md「揺れた要素からマスクの候補を出す」である。
 * 要素を特定できなかった領域は、`candidates` に入れず、座標と理由だけを `unlocated` に入れる。
 * 2 枚の寸法が違えば比べられないので、`status: "size-mismatch"` を返し、候補を出さない。
 * @param {{
 *   evaluate<A, R>(fn: (arg: A) => R, arg: A): Promise<R>,
 *   evaluate<R>(fn: () => R): Promise<R>,
 * }} page
 * @param {{ baseline: string, pass2: string, fullPage: boolean }} input - 1 回目と 2 回目の PNG のパス
 * @returns {Promise<{
 *   version: string,
 *   status: "ok" | "size-mismatch",
 *   candidates: MaskCandidate[],
 *   unlocated: UnlocatedRegion[],
 *   omitted_regions: number,
 * }>}
 */
export async function suggestNoiseMasks(page, { baseline, pass2, fullPage }) {
  assertPageVersion(PAGE_VERSION);
  const PNG = await loadPng();
  if (PNG === null) {
    throw new Error(
      "pngjs is not installed: install it in the project or confirm with the user before proceeding",
    );
  }
  const first = PNG.sync.read(readFileSync(baseline));
  const second = PNG.sync.read(readFileSync(pass2));
  if (first.width !== second.width || first.height !== second.height) {
    return {
      version: VERSION,
      status: "size-mismatch",
      candidates: [],
      unlocated: [],
      omitted_regions: 0,
    };
  }
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const cell = Math.max(1, Math.round(CELL_CSS_PX * dpr));
  const regions = diffRegions(first.data, second.data, {
    width: first.width,
    height: first.height,
    cell,
  }).map((rect) => toCssRect(rect, dpr));
  const reported = regions.slice(0, MAX_REGIONS);
  // 差が無ければページで探さない（全画面の撮影では探すときにスクロールするので、要らない操作をしない）
  const located =
    reported.length === 0
      ? []
      : await page.evaluate(locateRegionsInPage, { regions: reported, fullPage });
  return {
    version: VERSION,
    status: "ok",
    ...groupLocatedRegions(located),
    omitted_regions: regions.length - reported.length,
  };
}
