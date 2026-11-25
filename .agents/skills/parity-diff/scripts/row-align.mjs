// 全画面の撮影の組で、現行と新側の行を対応づける（原本）。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する。プロジェクトへはコピーしない。
//
// 上の要素の高さが変わると、その下の内容はすべて縦にずれ、同じ座標で比べると下の全域が差分になる。
// そこで、両側の行を対応づけてから比べる。考え方は imuratalpay/ui-diff（MIT）の src/align.ts に倣う。
// - 各行の内容のハッシュを取り、両側に 1 回だけ現れる行（1 色だけの行を除く）を手がかりにする。
//   手がかりの組のうち、current の行の番号が増え続ける最も長い並び（LIS）だけを残す（patience diff と同じ考え方）。
// - 手がかりから上下に、行が同じとみなせる間だけ対応を広げる。アンチエイリアス程度の差は同じとみなす。
// - 対応の付いた行が続く範囲を帯（block）にし、帯の間の行は上をそろえて対応づける（普通の比較と同じ）。
//
// このスクリプトは差を検出しない。new の各行を current のどの行と比べるかを決め、
// current の行を new の座標に並べ直した画像（current-aligned.png）を書くだけである。
// 比べるのは、記録済みの画素差分ツール（metadata.json の differ.pixel_tool）としきい値で、呼び出し側が行う。
// current に対応する行が無い new の行（挿入された行）は、埋め色（--fill-color）で塗る。
// どの new の行も、current の行か埋め色とツールが比べるので、対応づけは差を消さない。
//
// 対応づけをしない組は、理由（reason）を付けて exit 1 で返す。呼び出し側は従来どおり同じ座標で比べる。
// 乱数と現在時刻に依存しない。入力が同じなら出力も同じになる。
// PNG のデコードとエンコードには pngjs を使う。無ければ、導入してよいかを利用者に確認する（勝手にインストールしない）。
// TypeScript の構文は使わない（型は JSDoc で書く）。

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isPlainObject } from "./lib/guards.mjs";
import { isArray } from "./lib/is-array.mjs";
import { canonicalize } from "./lib/json.mjs";
import { loadPng } from "./lib/png.mjs";

/**
 * ツールのバージョン（原本）。対応づけの規則や出力の形を変えたら上げる。
 * diff-metadata.json の differ_versions.row_align に記録する値はこれを使う（手入力にしない）。
 * pixel-crops.mjs は、対応づけの記録の version がこの値と違えば読まない。
 *
 * @type {string}
 */
export const VERSION = "1";

/**
 * 2 つの行を同じとみなす画素の差の上限（RGBA の 4 チャンネルの差の和）と、それを超えてよい画素の割合。
 * 値は ui-diff の similarRows と同じで、このリポジトリで実測から決めた値ではない。
 * ここで同じとみなした行も、ツールは並べ直した画像で画素ごとに比べるので、差は検出の対象に残る。
 */
const SIMILAR_PIXEL_DELTA = 48;
const SIMILAR_ROW_BUDGET_RATIO = 0.003;

/** 対応の付いた行が new の行のこの割合に届かなければ、内容が大きく変わったとして対応づけない（デフォルト）。 */
export const DEFAULT_MIN_COVERAGE = 0.5;

/** 挿入された行を塗る色（デフォルト）。ページに現れにくく、差分画像の印の赤と違う色にする。 */
export const DEFAULT_FILL_COLOR = "ff00ff";

/** 削除だけで高さが変わった位置の、原因の行として扱う上下の幅（行）。 */
const REMOVAL_BAND = 2;

/** @typedef {{ width:number, height:number, data:Uint8Array }} PngImage */
/** @typedef {{ current_y:number, new_y:number, height:number, dy:number }} Block */
/** @typedef {{ id:string, new_y:number, height:number, dy:number, cause_rows:{ new_y:number, height:number } }} Shift */
/**
 * 対応づけから導く値（帯・挿入・削除・ずれ）。source と両側の高さだけから決まる。
 * @typedef {{ blocks:Block[], inserted:Array<{ new_y:number, rows:number }>,
 *   removed:Array<{ new_y:number, current_y:number, rows:number }>,
 *   forced_rows:Array<{ new_y:number, rows:number }>, shifted:Shift[] }} Derived
 */

/**
 * 行ごとのハッシュと、2 色以上を含む行かを返す。1 色だけの行（余白など）は手がかりにしない。
 *
 * @param {PngImage} img
 * @returns {{ hashes:string[], informative:Uint8Array }}
 */
export function rowInfo(img) {
  const stride = img.width * 4;
  /** @type {string[]} */
  const hashes = [];
  const informative = new Uint8Array(img.height);
  for (let y = 0; y < img.height; y += 1) {
    const row = img.data.subarray(y * stride, (y + 1) * stride);
    hashes.push(createHash("sha1").update(row).digest("base64"));
    informative[y] = hasTwoColors(row) ? 1 : 0;
  }
  return { hashes, informative };
}

/**
 * 行の中に、先頭の画素と違う画素があるか。
 *
 * @param {Uint8Array} row
 * @returns {boolean}
 */
function hasTwoColors(row) {
  for (let i = 4; i < row.length; i += 1) {
    if (row[i] !== row[i % 4]) return true;
  }
  return false;
}

/**
 * current の行 cy と new の行 ny を同じとみなせるか。ハッシュが同じか、差の大きい画素が上限の数以内なら同じとみなす。
 *
 * @param {{ current:PngImage, next:PngImage, ci:{ hashes:string[] }, ni:{ hashes:string[] } }} ctx
 * @param {number} cy
 * @param {number} ny
 * @returns {boolean}
 */
export function similarRows({ current, next, ci, ni }, cy, ny) {
  if (ci.hashes[cy] === ni.hashes[ny]) return true;
  const width = current.width;
  const budget = Math.max(1, Math.floor(width * SIMILAR_ROW_BUDGET_RATIO));
  const oc = cy * width * 4;
  const on = ny * width * 4;
  let off = 0;
  for (let x = 0; x < width * 4; x += 4) {
    let d = 0;
    for (let c = 0; c < 4; c += 1) d += Math.abs(current.data[oc + x + c] - next.data[on + x + c]);
    if (d > SIMILAR_PIXEL_DELTA) {
      off += 1;
      if (off > budget) return false;
    }
  }
  return true;
}

/**
 * [current の行, new の行] の組（new の行の昇順）から、current の行が増え続ける最も長い並びを返す。
 *
 * @param {Array<[number, number]>} pairs
 * @returns {Array<[number, number]>}
 */
export function longestIncreasing(pairs) {
  /** @type {number[]} */
  const tails = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k += 1) {
    const v = pairs[k][0];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]) {
    out.push(pairs[k]);
  }
  return out.reverse();
}

/**
 * 2 色以上を含む行のハッシュごとの出現回数と、最後に出た行を数える。
 *
 * @param {{ hashes:string[], informative:Uint8Array }} info
 */
function countInformative(info) {
  /** @type {Map<string, number>} */
  const count = new Map();
  /** @type {Map<string, number>} */
  const position = new Map();
  info.hashes.forEach((h, y) => {
    if (info.informative[y] === 0) return;
    count.set(h, (count.get(h) ?? 0) + 1);
    position.set(h, y);
  });
  return { count, position };
}

/**
 * 両側に 1 回だけ現れる行の組を、順序の合うものだけに絞って返す（手がかり）。
 *
 * @param {{ hashes:string[], informative:Uint8Array }} ci
 * @param {{ hashes:string[], informative:Uint8Array }} ni
 * @returns {Array<[number, number]>}
 */
export function findAnchors(ci, ni) {
  const c = countInformative(ci);
  const n = countInformative(ni);
  /** @type {Array<[number, number]>} */
  const pairs = [];
  ni.hashes.forEach((h, y) => {
    const cy = c.position.get(h);
    if (
      ni.informative[y] === 1 &&
      n.count.get(h) === 1 &&
      c.count.get(h) === 1 &&
      cy !== undefined
    ) {
      pairs.push([cy, y]);
    }
  });
  return longestIncreasing(pairs);
}

/**
 * 手がかりから上下に、行が同じとみなせる間だけ対応を広げる。new の行ごとの対応先（無ければ -1）を返す。
 *
 * @param {Array<[number, number]>} anchors
 * @param {{ current:PngImage, next:PngImage, ci:{ hashes:string[] }, ni:{ hashes:string[] } }} ctx
 * @returns {Int32Array}
 */
export function extendAnchors(anchors, ctx) {
  const ch = ctx.current.height;
  const nh = ctx.next.height;
  const toNew = new Int32Array(ch).fill(-1);
  const toCurrent = new Int32Array(nh).fill(-1);
  for (const [cy, ny] of anchors) {
    toNew[cy] = ny;
    toCurrent[ny] = cy;
  }
  /** @param {number} cy @param {number} ny */
  const free = (cy, ny) =>
    cy >= 0 && ny >= 0 && cy < ch && ny < nh && toNew[cy] < 0 && toCurrent[ny] < 0;
  for (const [c0, n0] of anchors) {
    for (const step of [1, -1]) {
      for (let cy = c0 + step, ny = n0 + step; free(cy, ny) && similarRows(ctx, cy, ny);) {
        toNew[cy] = ny;
        toCurrent[ny] = cy;
        cy += step;
        ny += step;
      }
    }
  }
  return toCurrent;
}

/**
 * 対応の付いた行を帯にまとめる（new の行の順）。
 *
 * @param {Int32Array | number[]} matched - new の行ごとの対応先（無ければ -1）
 * @returns {Block[]}
 */
export function toBlocks(matched) {
  /** @type {Block[]} */
  const blocks = [];
  for (let ny = 0; ny < matched.length; ny += 1) {
    const cy = matched[ny];
    if (cy < 0) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.new_y + last.height === ny && last.current_y + last.height === cy) {
      last.height += 1;
    } else {
      blocks.push({ current_y: cy, new_y: ny, height: 1, dy: ny - cy });
    }
  }
  return blocks;
}

/**
 * 帯の間の行を上をそろえて対応づけ、new の行ごとの比べる相手（current の行。無ければ -1）を返す。
 *
 * @param {Block[]} blocks
 * @param {{ currentHeight:number, newHeight:number }} heights
 * @returns {number[]}
 */
export function fillGaps(blocks, { currentHeight, newHeight }) {
  const source = Array.from({ length: newHeight }, () => -1);
  let pc = 0;
  let pn = 0;
  /** @param {number} endC @param {number} endN */
  const gap = (endC, endN) => {
    const lenC = Math.max(0, endC - pc);
    for (let t = 0; t < endN - pn; t += 1) source[pn + t] = t < lenC ? pc + t : -1;
  };
  for (const b of blocks) {
    gap(b.current_y, b.new_y);
    for (let t = 0; t < b.height; t += 1) source[b.new_y + t] = b.current_y + t;
    pc = b.current_y + b.height;
    pn = b.new_y + b.height;
  }
  gap(currentHeight, newHeight);
  return source;
}

/**
 * source から、挿入された行（new にだけある行）の並びを返す。
 *
 * @param {number[]} source
 * @returns {Array<{ new_y:number, rows:number }>}
 */
function insertedRuns(source) {
  /** @type {Array<{ new_y:number, rows:number }>} */
  const runs = [];
  source.forEach((cy, ny) => {
    if (cy >= 0) return;
    const last = runs[runs.length - 1];
    if (last && last.new_y + last.rows === ny) last.rows += 1;
    else runs.push({ new_y: ny, rows: 1 });
  });
  return runs;
}

/**
 * source から、削除された行（current にだけある行）の並びを返す。new_y は、削除された行の直後に来る new の行である。
 *
 * @param {number[]} source
 * @param {number} currentHeight
 * @returns {Array<{ new_y:number, current_y:number, rows:number }>}
 */
function removedRuns(source, currentHeight) {
  /** @type {Array<{ new_y:number, current_y:number, rows:number }>} */
  const runs = [];
  let expected = 0;
  source.forEach((cy, ny) => {
    if (cy < 0) return;
    if (cy > expected) runs.push({ new_y: ny, current_y: expected, rows: cy - expected });
    expected = cy + 1;
  });
  if (currentHeight > expected) {
    runs.push({ new_y: source.length, current_y: expected, rows: currentHeight - expected });
  }
  return runs;
}

/**
 * ずれた帯（dy が 0 でない帯。dy が同じで隣り合う帯は 1 つにまとめる）と、そのずれの原因になった new の行を返す。
 * 原因の行は、直前の dy が違う帯の終わりから、ずれた帯の始まりまでの行である（挿入された行と、上をそろえた行）。
 * 削除だけで dy が変わった位置は、その間に new の行が無いので、境目の上下 REMOVAL_BAND 行を原因の行にする。
 *
 * @param {Block[]} blocks - sourceBlocks の結果
 * @param {number} newHeight
 * @returns {Shift[]}
 */
export function shiftedRuns(blocks, newHeight) {
  /** @type {Shift[]} */
  const runs = [];
  let prevEnd = 0;
  let prevDy = 0;
  for (const b of blocks) {
    const last = runs.at(-1);
    if (b.dy === prevDy && last && last.dy === b.dy) {
      // 帯を延ばしても、原因の行（帯の始まりより上）は変わらない。
      last.height = b.new_y + b.height - last.new_y;
    } else if (b.dy !== prevDy && b.dy !== 0) {
      const id = `d${runs.length + 1}`;
      const cause_rows = causeRows(prevEnd, b.new_y, newHeight);
      runs.push({ id, new_y: b.new_y, height: b.height, dy: b.dy, cause_rows });
    }
    prevEnd = b.new_y + b.height;
    prevDy = b.dy;
  }
  return runs;
}

/**
 * ツールの差分画像に印が無くても候補にする new の行を返す。挿入された行と、削除された行の境目の上下 REMOVAL_BAND 行である。
 * 削除だけで高さが変わった位置には new の行が無く、ツールは差を出さないので、境目を原因の候補にする。
 *
 * @param {Array<{ new_y:number, rows:number }>} inserted
 * @param {Array<{ new_y:number }>} removed
 * @param {number} newHeight
 * @returns {Array<{ new_y:number, rows:number }>}
 */
function forcedRows(inserted, removed, newHeight) {
  const bands = removed.map((r) => {
    const top = Math.max(0, r.new_y - REMOVAL_BAND);
    return { new_y: top, rows: Math.min(newHeight, r.new_y + REMOVAL_BAND) - top };
  });
  return [...inserted, ...bands].filter((r) => r.rows > 0).sort((a, b) => a.new_y - b.new_y);
}

/**
 * ずれの原因の行の範囲を返す。間に行が無ければ、境目の上下 REMOVAL_BAND 行にする。
 *
 * @param {number} start
 * @param {number} end
 * @param {number} newHeight
 */
function causeRows(start, end, newHeight) {
  if (end > start) return { new_y: start, height: end - start };
  const top = Math.max(0, end - REMOVAL_BAND);
  const bottom = Math.min(newHeight, end + REMOVAL_BAND);
  return { new_y: top, height: Math.max(0, bottom - top) };
}

/**
 * source と両側の高さから、帯・挿入・削除・ずれを導く。pixel-crops.mjs も同じ関数で導き直して、記録と突き合わせる。
 *
 * @param {number[]} source
 * @param {{ currentHeight:number }} heights
 * @returns {Derived}
 */
export function deriveAlignment(source, { currentHeight }) {
  // 帯は source から作る。帯の間の上をそろえた行も、比べる相手が 1 行ずつ増える限り同じ帯に入る。
  const blocks = toBlocks(source);
  const inserted = insertedRuns(source);
  const removed = removedRuns(source, currentHeight);
  return {
    blocks,
    inserted,
    removed,
    forced_rows: forcedRows(inserted, removed, source.length),
    shifted: shiftedRuns(blocks, source.length),
  };
}

/**
 * 2 枚の画像の行を対応づける。対応づけない組は reason を返す。
 *
 * @param {PngImage} current
 * @param {PngImage} next
 * @param {{ minCoverage:number }} options
 * @returns {{ aligned:false, reason:string, coverage:(number|null) } |
 *   { aligned:true, reason:null, coverage:number, source:number[] } & Derived}
 */
export function alignRows(current, next, { minCoverage }) {
  if (current.width !== next.width)
    return { aligned: false, reason: "width_mismatch", coverage: null };
  const ci = rowInfo(current);
  const ni = rowInfo(next);
  const anchors = findAnchors(ci, ni);
  if (anchors.length === 0) return { aligned: false, reason: "no_anchor", coverage: 0 };
  const matched = extendAnchors(anchors, { current, next, ci, ni });
  const matchedRows = matched.filter((cy) => cy >= 0).length;
  // しきい値とは丸める前の割合で比べる。丸めた値で比べると、しきい値の少し下の組（0.49996 など）が通る。
  const ratio = matchedRows / next.height;
  const coverage = Number(ratio.toFixed(4));
  if (ratio < minCoverage) return { aligned: false, reason: "low_coverage", coverage };
  const source = fillGaps(toBlocks(matched), {
    currentHeight: current.height,
    newHeight: next.height,
  });
  const identity = current.height === next.height && source.every((cy, ny) => cy === ny);
  if (identity) return { aligned: false, reason: "no_shift", coverage };
  return {
    aligned: true,
    reason: null,
    coverage,
    source,
    ...deriveAlignment(source, { currentHeight: current.height }),
  };
}

/**
 * current の行を new の座標に並べ直した画像を作る。対応する行の無い new の行は fill で塗る。
 *
 * @param {PngImage} current
 * @param {number[]} source
 * @param {{ width:number, height:number, fill:{ r:number, g:number, b:number },
 *   PngCtor: new (opts:{ width:number, height:number }) => PngImage }} options
 * @returns {PngImage}
 */
export function buildAlignedImage(current, source, { width, height, fill, PngCtor }) {
  const out = new PngCtor({ width, height });
  const stride = width * 4;
  for (let ny = 0; ny < height; ny += 1) {
    const cy = source[ny];
    if (cy >= 0) {
      out.data.set(current.data.subarray(cy * stride, (cy + 1) * stride), ny * stride);
      continue;
    }
    for (let o = ny * stride; o < (ny + 1) * stride; o += 4) {
      out.data[o] = fill.r;
      out.data[o + 1] = fill.g;
      out.data[o + 2] = fill.b;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/**
 * 16 進の色（"ff00ff" / "#ff00ff"）を RGB にする。
 *
 * @param {string} hex
 * @returns {{ r:number, g:number, b:number } | null}
 */
export function parseFillColor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return { r, g, b };
}

/**
 * 寸法の記録 `{ width, height }` を読む。どちらも 1 以上の整数でなければ null を返す。
 *
 * @param {unknown} v
 * @returns {{ width:number, height:number } | null}
 */
function readSize(v) {
  if (!isPlainObject(v)) return null;
  const { width, height } = v;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  return width >= 1 && height >= 1 ? { width, height } : null;
}

/**
 * source を読む。new の行の数だけ並び、各値が -1 か current の行の番号で、-1 以外は増え続けることを確かめる。
 *
 * @param {unknown} v
 * @param {{ currentHeight:number, newHeight:number }} heights
 * @returns {number[] | null}
 */
function readSource(v, { currentHeight, newHeight }) {
  if (!isArray(v) || v.length !== newHeight) return null;
  /** @type {number[]} */
  const source = [];
  let last = -1;
  for (const cy of v) {
    if (typeof cy !== "number" || !Number.isInteger(cy)) return null;
    source.push(cy);
    if (cy === -1) continue;
    if (cy < 0 || cy >= currentHeight || cy <= last) return null;
    last = cy;
  }
  return source;
}

/**
 * ずれの記録から、導き直した値と比べる項目だけを取り出す（pixel-crops.mjs が足した cause_regions などは比べない）。
 *
 * @param {unknown} list
 */
function pickShifts(list) {
  if (!isArray(list)) return null;
  return list.map((s) =>
    isPlainObject(s)
      ? { id: s.id, new_y: s.new_y, height: s.height, dy: s.dy, cause_rows: s.cause_rows }
      : s,
  );
}

/**
 * row-align.mjs が書いた対応づけの記録を読み、書き手の不変条件を確かめる。
 * 帯・挿入・削除・ずれは記録を信じず、source から導き直して記録と突き合わせる（手で直した記録を通さない）。
 *
 * @param {unknown} rec
 * @returns {{ error:string } | { record:Record<string, unknown>, source:number[], derived:Derived,
 *   fill:{ r:number, g:number, b:number }, current:{ width:number, height:number }, next:{ width:number, height:number } }}
 */
export function checkAlignmentRecord(rec) {
  if (!isPlainObject(rec))
    return { error: "alignment must be a JSON object (row-align.mjs output)" };
  if (rec.version !== VERSION) {
    return {
      error: `alignment version ${JSON.stringify(rec.version)} is not ${VERSION}; run row-align.mjs again`,
    };
  }
  if (rec.aligned !== true) {
    return {
      error:
        "alignment.aligned is not true: rows were not aligned, compare the original images without --alignment",
    };
  }
  const current = readSize(rec.current);
  const next = readSize(rec.new);
  if (!current || !next)
    return {
      error: "alignment.current and alignment.new must be { width, height } of integers >= 1",
    };
  if (current.width !== next.width)
    return { error: "alignment.current.width and alignment.new.width differ" };
  const fill = typeof rec.fill_color === "string" ? parseFillColor(rec.fill_color) : null;
  if (!fill) return { error: "alignment.fill_color must be a 6-digit hex color" };
  const source = readSource(rec.source, { currentHeight: current.height, newHeight: next.height });
  if (!source) {
    return {
      error:
        "alignment.source must list, for each new row, -1 or a current row, increasing apart from -1",
    };
  }
  const derived = deriveAlignment(source, { currentHeight: current.height });
  const key = mismatchedDerivedKey(rec, derived);
  if (key !== null) {
    return { error: `alignment.${key} does not match the one derived from alignment.source` };
  }
  return { record: rec, source, derived, fill, current, next };
}

/** 記録と導き直した値を突き合わせる項目。 */
const DERIVED_KEYS = /** @type {const} */ ([
  "blocks",
  "inserted",
  "removed",
  "forced_rows",
  "shifted",
]);

/**
 * 記録の帯・挿入・削除・足す行・ずれのうち、導き直した値と食い違う最初の項目を返す（無ければ null）。
 *
 * @param {Record<string, unknown>} rec
 * @param {Derived} derived
 * @returns {string | null}
 */
function mismatchedDerivedKey(rec, derived) {
  for (const key of DERIVED_KEYS) {
    const recorded = key === "shifted" ? pickShifts(rec.shifted) : rec[key];
    if (JSON.stringify(canonicalize(recorded)) !== JSON.stringify(canonicalize(derived[key]))) {
      return key;
    }
  }
  return null;
}

/**
 * current の画像の画素の矩形を、new の座標の矩形（帯ごとに 1 つ）に直す。
 * 対応する new の行が無い部分（削除された行）は落ちる。小数の座標（deviceScaleFactor が整数でないとき）も保つ。
 *
 * @param {{ x:number, y:number, width:number, height:number }} rect
 * @param {Block[]} blocks - deriveAlignment の blocks
 * @returns {Array<{ x:number, y:number, width:number, height:number }>}
 */
export function mapCurrentRect(rect, blocks) {
  const top = rect.y;
  const bottom = rect.y + rect.height;
  /** @type {Array<{ x:number, y:number, width:number, height:number }>} */
  const pieces = [];
  for (const b of blocks) {
    const lo = Math.max(top, b.current_y);
    const hi = Math.min(bottom, b.current_y + b.height);
    if (hi <= lo) continue;
    pieces.push({ x: rect.x, y: lo + b.dy, width: rect.width, height: hi - lo });
  }
  return pieces;
}

const USAGE =
  "usage: node row-align.mjs <current.png> <new.png> --out <dir> [--min-coverage <0..1>] [--fill-color <hex>]\n";

/**
 * 引数を読み、確かめる。誤りは stderr に出す 1 行で返す。
 *
 * @param {string[]} argv
 * @returns {{ error:string } | { paths:string[], out:string, minCoverage:number, fillHex:string,
 *   fill:{ r:number, g:number, b:number } }}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, {
    values: ["--out", "--min-coverage", "--fill-color"],
    positionals: 2,
  });
  if (parsed.error !== undefined) return { error: `error: ${parsed.error}\n${USAGE}` };
  const out = parsed.strings["--out"];
  if (parsed.positionals.length !== 2 || !out) return { error: USAGE };
  const coverageText = parsed.strings["--min-coverage"];
  const minCoverage = coverageText === undefined ? DEFAULT_MIN_COVERAGE : Number(coverageText);
  if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 1) {
    return { error: "error: --min-coverage must be a number from 0 to 1\n" };
  }
  const fillHex = (parsed.strings["--fill-color"] ?? DEFAULT_FILL_COLOR)
    .replace(/^#/, "")
    .toLowerCase();
  const fill = parseFillColor(fillHex);
  if (!fill) return { error: "error: --fill-color must be a 6-digit hex color (e.g. ff00ff)\n" };
  return { paths: parsed.positionals, out, minCoverage, fillHex, fill };
}

/**
 * 2 枚の PNG を読む。誤りは stderr に出す 1 行で返す。
 *
 * @param {string[]} paths
 * @param {{ sync: { read: (buf: Buffer) => PngImage } }} PNG
 * @returns {{ error:string } | { current:PngImage, next:PngImage }}
 */
function readImages(paths, PNG) {
  try {
    return {
      current: PNG.sync.read(readFileSync(paths[0])),
      next: PNG.sync.read(readFileSync(paths[1])),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `error: cannot read PNG inputs: ${message}\n` };
  }
}

/**
 * 結果の JSON と、対応づけた組では並べ直した画像を --out に書く。書けなければ例外を投げる。
 *
 * @param {Record<string, unknown>} record
 * @param {{ out:string, aligned:(PngImage|null), PNG:{ sync:{ write(png:PngImage):Uint8Array } } }} target
 */
function writeOutputs(record, { out, aligned, PNG }) {
  mkdirSync(out, { recursive: true });
  // 対応づけなかった組では、前の実行が残した並べ直した画像を消す。残すと、古い画像をツールに渡しうる。
  const alignedPath = join(out, "current-aligned.png");
  if (aligned) writeFileSync(alignedPath, PNG.sync.write(aligned));
  else rmSync(alignedPath, { force: true });
  writeFileSync(join(out, "alignment.json"), JSON.stringify(record, null, 2) + "\n");
}

/**
 * 2 枚を対応づけ、出力する記録と、対応づけた組では並べ直した画像を作る。
 *
 * @param {{ current:PngImage, next:PngImage }} images
 * @param {{ minCoverage:number, fillHex:string, fill:{ r:number, g:number, b:number } }} args
 * @param {new (opts:{ width:number, height:number }) => PngImage} PngCtor
 */
function alignImages({ current, next }, { minCoverage, fillHex, fill }, PngCtor) {
  const result = alignRows(current, next, { minCoverage });
  const record = {
    version: VERSION,
    current: { width: current.width, height: current.height },
    new: { width: next.width, height: next.height },
    fill_color: fillHex,
    min_coverage: minCoverage,
    ...result,
  };
  const size = { width: next.width, height: next.height };
  const aligned = result.aligned
    ? buildAlignedImage(current, result.source, { ...size, fill, PngCtor })
    : null;
  return { result, record, aligned };
}

/**
 * CLI エントリ。`node row-align.mjs <current.png> <new.png> --out <dir> [--min-coverage <0..1>] [--fill-color <hex>]`
 *
 * --out に alignment.json を書き、対応づけた組では current-aligned.png も書く。同じ JSON を stdout にも出す。
 * 終了コードの 0 は、対応づけたことを表す（current-aligned.png と new をツールで比べる）。
 * 1 は対応づけなかったこと（reason を読み、元の 2 枚を同じ座標で比べる）を、2 は入力の誤りを表す。
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const args = parseArgs(argv);
  if ("error" in args) {
    process.stderr.write(args.error);
    return 2;
  }
  const PNG = await loadPng();
  if (!PNG) {
    process.stderr.write(
      "error: pngjs is not installed. install it in the project or confirm with the user before proceeding\n",
    );
    return 2;
  }
  const images = readImages(args.paths, PNG);
  if ("error" in images) {
    process.stderr.write(images.error);
    return 2;
  }
  const { result, record, aligned } = alignImages(images, args, PNG);
  try {
    writeOutputs(record, { out: args.out, aligned, PNG });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot write outputs: ${message}\n`);
    return 2;
  }
  if (!result.aligned) {
    process.stderr.write(
      `warning: rows were not aligned (${result.reason}); compare the original images at the same coordinates\n`,
    );
  }
  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  return result.aligned ? 0 : 1;
}

// async-cli-exit:begin
if (isCliEntry(import.meta.url)) {
  // 想定外の reject を握らないと未処理 rejection で exit 1 になり、
  // 判定の結果の exit 1 と区別が付かないまま呼び出し側に伝わる。入力エラーと同じ exit 2 に寄せる。
  // process.exit は書き込み中の stdout を捨てる（パイプが非同期のプラットフォームで出力が欠ける）ため、
  // 終了コードだけ設定して自然終了させる。
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 2;
    });
}
// async-cli-exit:end
