// 画素差分画像から差分領域を切り出す（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何をするか: 記録済みの画素差分ツール（pixelmatch / odiff 等。metadata.json の differ.pixel_tool）が
// 出力した差分画像 diff.png を入力に取り、差分としてマークされた画素を 8 近傍で連結成分に
// クラスタリングし、近接する bbox をマージして、current / new から同座標の crop 対を切り出す。
//
// 何をしないか: 画素比較そのもの（＝検出）は行わない。検出はツールに委ね、本スクリプトは
// ツール出力のクラスタリングと crop 切り出しだけを行う（差分器を再実装しない）。
// これは「検出は決定論的ツールの仕事、モデルの仕事は分類だけ」の設計を、画素経路で担保する足場。
//
// ただし**画素の量は 2 本で報告する**。記録済みツールのしきい値（pixelmatch の threshold 等）は
// 許容の内側の差を**総量にも件数にも出さない**ため、その 1 本だけを報告すると
// 小さな数が「ほぼ一致」と読まれる（実測: 報告 756 画素・0.0569% の裏に、緑が 1/255 違う画素が
// 3,364 画素あった）。そこで current / new を**しきい値なしで**突き合わせた数
// （strict_pixels・そのうちマークされていない strict_only_pixels・最大チャンネル差は全体
// strict_max_channel_delta と内側だけ strict_only_max_channel_delta の 2 本）を summary に併記する。
// これは検出のやり直しではなく、既に読んでいる 2 枚の画素を数えるだけ。
//
// しきい値の内側にだけ差がある画素（strict-only）は、記録済みツールの差分画像に出ないため
// 従来の経路ではクラスタも crop 対も作られず、**数だけ報告されて分類できない**状態になる。
// トリアージは候補ごとの crop 対を入力にするので、数だけでは差し戻しにも分類にも進めない。
// そこで strict-only のマスクも同じクラスタリングに掛け、crop 対を持つ候補として出す
// （`--strict-min-cluster` 未満の孤立画素は落とし、件数は `--strict-max-regions` で上限を付けて
// 総数も報告する。黙って捨てない）。
//
// 決定論的: 乱数・現在時刻に依存しない。連結成分はラスタ走査順に発見し、最終 bbox は
// (y, x) 昇順に整列するため入力が同じなら出力は常に同じ。
// PNG デコード/エンコードは pngjs を使う（pixel_tool が pixelmatch ならプロジェクトに入っていることが多い。
// 無ければ導入をユーザーに確認する。本スクリプトは勝手にインストールしない）。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。クラスタリング・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.pixel_crops に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "3";

/**
 * 差分色判定のチャンネル許容差（既定）。赤 (255,0,0) と、アンチエイリアス色として使われがちな
 * 黄 (255,255,0) を分離できる幅にする（黄は緑チャンネルが 255 で赤の 0 と大きく離れるため除外される）。
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
 * 画素が差分色（target）に近いかを判定する。各チャンネルが tol 以内なら差分画素とみなす。
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {{ r:number, g:number, b:number }} target
 * @param {number} tol
 * @returns {boolean}
 */
export function isDiffPixel(r, g, b, target, tol) {
  return (
    Math.abs(r - target.r) <= tol && Math.abs(g - target.g) <= tol && Math.abs(b - target.b) <= tol
  );
}

/**
 * RGBA バッファ（pngjs の data）から差分マスク（0/1 の Uint8Array）を作る。
 * @param {Uint8Array | Buffer} data - 長さ width*height*4 の RGBA
 * @param {number} width
 * @param {number} height
 * @param {{ r:number, g:number, b:number }} target
 * @param {number} tol
 * @returns {Uint8Array}
 */
export function buildDiffMask(data, width, height, target, tol) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    mask[i] = isDiffPixel(data[o], data[o + 1], data[o + 2], target, tol) ? 1 : 0;
  }
  return mask;
}

/**
 * current / new の RGBA バッファを**しきい値なしで**突き合わせ、厳密差分マスクと最大チャンネル差を返す。
 * 記録済みツールのしきい値が飲んだ差（許容の内側）はこちらにだけ現れる。
 *
 * 最大チャンネル差は**全体**（`maxChannelDelta`）と**しきい値の内側だけ**（`maxStrictOnlyChannelDelta`）の
 * 2 本を返す。全体の 1 本だけだと、別の場所に本物の差（チャンネル差 255 等）があるときその値が
 * 「しきい値の内側に隠れた差の大きさ」として読まれる（隠れた差は 1/255 なのに 255 と報告される）。
 * `thresholdMask` を渡さない呼び出しでは内側の集合が定まらないため `null` を返す。
 *
 * @param {Uint8Array | Buffer} currentData - 長さ width*height*4 の RGBA
 * @param {Uint8Array | Buffer} nextData - 同上
 * @param {number} pixels - width*height
 * @param {Uint8Array | null} [thresholdMask] - 差分画像から作ったマスク（しきい値の内側を切り分けるため）
 * @returns {{ mask: Uint8Array, count: number, maxChannelDelta: number, maxStrictOnlyChannelDelta: (number|null) }}
 */
export function buildStrictMask(currentData, nextData, pixels, thresholdMask = null) {
  const mask = new Uint8Array(pixels);
  let count = 0;
  let maxChannelDelta = 0;
  let maxStrictOnlyChannelDelta = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    let pixelDelta = 0;
    // 両方が完全な透明なら、隠れている RGB が違っても画面には同じものが出る。
    // 生の 4 チャンネル比較のままだと見た目が同じ画素を strict の差として数え、
    // 見分けの付かない crop 対を候補にしてしまう（マスクした領域・要素切り出しで起きる）。
    const bothTransparent = currentData[o + 3] === 0 && nextData[o + 3] === 0;
    if (!bothTransparent) {
      for (let c = 0; c < 4; c += 1) {
        const delta = Math.abs(currentData[o + c] - nextData[o + c]);
        if (delta > pixelDelta) pixelDelta = delta;
      }
    }
    const differs = pixelDelta > 0 ? 1 : 0;
    mask[i] = differs;
    count += differs;
    if (differs === 1) {
      if (pixelDelta > maxChannelDelta) maxChannelDelta = pixelDelta;
      if (
        thresholdMask !== null &&
        thresholdMask[i] === 0 &&
        pixelDelta > maxStrictOnlyChannelDelta
      ) {
        maxStrictOnlyChannelDelta = pixelDelta;
      }
    }
  }
  return {
    mask,
    count,
    maxChannelDelta,
    maxStrictOnlyChannelDelta: thresholdMask === null ? null : maxStrictOnlyChannelDelta,
  };
}

/**
 * しきい値つき（記録済みツールの差分画像）としきい値なし（厳密比較）の画素数を並べた summary を返す。
 * `strict_only_pixels` が**許容の内側に隠れた差**——ここが非ゼロなら、差分領域が 0 件でも
 * 「一致」とは読めない（ノイズ基準値と対比して分類する。判断は呼び出し側＝トリアージが行う）。
 * @param {Uint8Array} thresholdMask - 差分画像から作ったマスク
 * @param {Uint8Array} strictMask - 厳密比較のマスク
 * @param {number} maxChannelDelta - 差がある画素**全体**の最大チャンネル差
 * @param {number|null} [maxStrictOnlyChannelDelta] - **しきい値の内側だけ**の最大チャンネル差
 *   （`buildStrictMask` に `thresholdMask` を渡した呼び出しでのみ定まる。渡していなければ null）
 * @returns {{ total_pixels:number, threshold_pixels:number, strict_pixels:number,
 *             strict_only_pixels:number, strict_max_channel_delta:number,
 *             strict_only_max_channel_delta:(number|null),
 *             threshold_ratio:number, strict_ratio:number }}
 */
export function summarizePixels(
  thresholdMask,
  strictMask,
  maxChannelDelta,
  maxStrictOnlyChannelDelta = null,
) {
  const total = thresholdMask.length;
  let thresholdPixels = 0;
  let strictPixels = 0;
  let strictOnly = 0;
  for (let i = 0; i < total; i += 1) {
    if (thresholdMask[i] === 1) thresholdPixels += 1;
    if (strictMask[i] === 1) {
      strictPixels += 1;
      if (thresholdMask[i] === 0) strictOnly += 1;
    }
  }
  const ratio = (n) => (total === 0 ? 0 : Number(((n / total) * 100).toFixed(4)));
  return {
    total_pixels: total,
    threshold_pixels: thresholdPixels,
    strict_pixels: strictPixels,
    strict_only_pixels: strictOnly,
    strict_max_channel_delta: maxChannelDelta,
    strict_only_max_channel_delta: maxStrictOnlyChannelDelta,
    threshold_ratio: ratio(thresholdPixels),
    strict_ratio: ratio(strictPixels),
  };
}

/**
 * しきい値の内側にだけ差がある画素（記録済みツールがマークしなかった差）のマスクを作る。
 * @param {Uint8Array} thresholdMask
 * @param {Uint8Array} strictMask
 * @returns {Uint8Array}
 */
export function buildStrictOnlyMask(thresholdMask, strictMask) {
  const mask = new Uint8Array(thresholdMask.length);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = strictMask[i] === 1 && thresholdMask[i] === 0 ? 1 : 0;
  }
  return mask;
}

/**
 * strict-only のクラスタから出力する領域を決定論的に選ぶ。
 *
 * **id は上限を掛ける前の全体の並び（(y, x) 昇順）から決める。** 選抜後の位置で採番すると、
 * 警告に従って `--strict-max-regions` を上げたときに、前は出ていなかった手前の領域が割り込んで
 * 既存の候補が採番し直される——同じ `crop-sN-*` が別の bbox を指し、記録済みのトリアージが
 * 別の crop に貼り付く。
 *
 * 選抜自体は画素数の多い順（同数なら y, x 昇順）で上限 max 件、出力は (y, x) 昇順。
 * 上限で落とした分は呼び出し側が総数と併せて報告する（黙って捨てない）。
 * @param {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} regions
 * @param {number} max
 * @returns {Array<{ id:string, pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>}
 */
export function selectStrictRegions(regions, max) {
  const ordered = [...regions]
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .map((r, index) => ({ ...r, id: `s${index + 1}` }));
  const ranked = [...ordered].sort(
    (a, b) => b.pixels - a.pixels || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x,
  );
  const picked = ranked.slice(0, max);
  picked.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return picked;
}

/**
 * bbox の内側で mask が立っている画素数を数える。
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {{ x:number, y:number, width:number, height:number }} bbox
 * @returns {number}
 */
export function countInBbox(mask, width, bbox) {
  let count = 0;
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
      if (mask[y * width + x] === 1) count += 1;
    }
  }
  return count;
}

/**
 * 差分マスクを 8 近傍で連結成分にクラスタリングする。ラスタ走査順にシードするため決定論的。
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @returns {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>}
 */
export function clusterComponents(mask, width, height) {
  const visited = new Uint8Array(width * height);
  /** @type {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} */
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] === 1) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;
    const stack = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx - x) / width;
      pixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] === 1 && visited[nIdx] === 0) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }
    components.push({
      pixels,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    });
  }
  return components;
}

/**
 * pad 拡張した 2 つの bbox が重なるかを判定する。
 * @param {{ x:number, y:number, width:number, height:number }} a
 * @param {{ x:number, y:number, width:number, height:number }} b
 * @param {number} pad
 * @returns {boolean}
 */
function bboxOverlap(a, b, pad) {
  const ax1 = a.x - pad;
  const ay1 = a.y - pad;
  const ax2 = a.x + a.width - 1 + pad;
  const ay2 = a.y + a.height - 1 + pad;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.width - 1;
  const by2 = b.y + b.height - 1;
  return ax1 <= bx2 && bx1 <= ax2 && ay1 <= by2 && by1 <= ay2;
}

/**
 * 2 つの bbox を包含する bbox を返す。
 * @param {{ x:number, y:number, width:number, height:number }} a
 * @param {{ x:number, y:number, width:number, height:number }} b
 */
function unionBbox(a, b) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width - 1, b.x + b.width - 1);
  const y2 = Math.max(a.y + a.height - 1, b.y + b.height - 1);
  return { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}

/**
 * **先に pad 以内でマージしてから** minCluster 未満を落とす。結果は (y, x) 昇順。
 *
 * strict-only はこちらを使う。`filterAndMerge`（落としてからマージ）だと、
 * **1〜3 画素の連結成分に散る差**（細いグリフのヒンティング差・点線装飾の差など）が
 * 近接する箱と合流する前に全部消え、`strict_only_pixels > 0` なのに候補ゼロ・exit 0 になる
 * （この PR が塞ごうとしている fail-open そのもの）。
 *
 * マージ後も下限に満たなかった分は捨てるが、**件数と画素数を返して呼び出し側に報告させる**
 * （黙って捨てない）。
 * @param {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} components
 * @param {number} minCluster
 * @param {number} pad
 * @returns {{ kept: Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>,
 *             droppedClusters:number, droppedPixels:number }}
 */
export function mergeThenFilter(components, minCluster, pad) {
  const merged = filterAndMerge(components, 1, pad);
  const kept = merged.filter((r) => r.pixels >= minCluster);
  const dropped = merged.filter((r) => r.pixels < minCluster);
  return {
    kept,
    droppedClusters: dropped.length,
    droppedPixels: dropped.reduce((sum, r) => sum + r.pixels, 0),
  };
}

/**
 * minCluster 未満の成分を落とし、pad 以内で近接する bbox をマージする。結果は (y, x) 昇順。
 * @param {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} components
 * @param {number} minCluster
 * @param {number} pad
 * @returns {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>}
 */
export function filterAndMerge(components, minCluster, pad) {
  let regions = components
    .filter((c) => c.pixels >= minCluster)
    .map((c) => ({ pixels: c.pixels, bbox: c.bbox }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < regions.length && !merged; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) {
        if (bboxOverlap(regions[i].bbox, regions[j].bbox, pad)) {
          const combined = {
            pixels: regions[i].pixels + regions[j].pixels,
            bbox: unionBbox(regions[i].bbox, regions[j].bbox),
          };
          regions = regions.filter((_, k) => k !== i && k !== j);
          regions.push(combined);
          merged = true;
          break;
        }
      }
    }
  }
  regions.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return regions;
}

/**
 * 画像から bbox の矩形を margin 分広げて切り出した新しい PNG を返す。bbox は画像内にクランプする。
 * margin は分類の判断材料になる周辺文脈を crop に含めるためのもの（bbox 自体は広げない）。
 * @param {{ width:number, height:number, data:Uint8Array }} img - pngjs の PNG インスタンス相当
 * @param {{ x:number, y:number, width:number, height:number }} bbox
 * @param {number} margin
 * @param {new (opts:{ width:number, height:number }) => { width:number, height:number, data:Uint8Array }} PngCtor
 */
function cropImage(img, bbox, margin, PngCtor) {
  const x0 = Math.max(0, Math.min(bbox.x - margin, img.width - 1));
  const y0 = Math.max(0, Math.min(bbox.y - margin, img.height - 1));
  const w = Math.max(1, Math.min(bbox.width + (bbox.x - x0) + margin, img.width - x0));
  const h = Math.max(1, Math.min(bbox.height + (bbox.y - y0) + margin, img.height - y0));
  const out = new PngCtor({ width: w, height: h });
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      const srcO = ((y0 + row) * img.width + (x0 + col)) * 4;
      const dstO = (row * w + col) * 4;
      out.data[dstO] = img.data[srcO];
      out.data[dstO + 1] = img.data[srcO + 1];
      out.data[dstO + 2] = img.data[srcO + 2];
      out.data[dstO + 3] = img.data[srcO + 3];
    }
  }
  return out;
}

/**
 * pngjs を動的 import する（未導入なら null）。
 * @returns {Promise<any|null>}
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
 * CLI エントリ。
 * `node pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>]`
 * stdout は `{ summary, regions, strict_only_regions }`（summary はしきい値つき／なしの画素数、
 * regions は記録済みツールが出した差分領域の crop 対、strict_only_regions はしきい値の内側にだけ
 * 差がある領域の crop 対）。
 * 分類すべき候補（どちらかの領域）があれば exit 1、無ければ exit 0、入力エラーは exit 2。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const usage =
    "usage: node pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>] [--strict-min-cluster <count>] [--strict-max-regions <count>]\n";
  const positionals = [];
  let out;
  let minCluster = 1;
  let pad = 8;
  let cropMargin = 24;
  let diffColor = "ff0000";
  // strict-only はアンチエイリアスの孤立画素まで拾うため、既定のクラスタ下限を threshold 側より高くする。
  let strictMinCluster = 4;
  let strictMaxRegions = 20;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") {
      out = argv[i + 1];
      i += 1;
    } else if (a === "--min-cluster") {
      minCluster = Number(argv[i + 1]);
      i += 1;
    } else if (a === "--pad") {
      pad = Number(argv[i + 1]);
      i += 1;
    } else if (a === "--crop-margin") {
      cropMargin = Number(argv[i + 1]);
      i += 1;
    } else if (a === "--diff-color") {
      diffColor = argv[i + 1];
      i += 1;
    } else if (a === "--strict-min-cluster") {
      strictMinCluster = Number(argv[i + 1]);
      i += 1;
    } else if (a === "--strict-max-regions") {
      strictMaxRegions = Number(argv[i + 1]);
      i += 1;
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length !== 3 || !out) {
    process.stderr.write(usage);
    return 2;
  }
  if (
    !Number.isFinite(minCluster) ||
    minCluster < 1 ||
    !Number.isFinite(pad) ||
    pad < 0 ||
    !Number.isFinite(cropMargin) ||
    cropMargin < 0
  ) {
    process.stderr.write(
      "error: --min-cluster must be >= 1, --pad and --crop-margin must be >= 0\n",
    );
    return 2;
  }
  if (
    !Number.isFinite(strictMinCluster) ||
    strictMinCluster < 1 ||
    !Number.isFinite(strictMaxRegions) ||
    strictMaxRegions < 1
  ) {
    process.stderr.write("error: --strict-min-cluster and --strict-max-regions must be >= 1\n");
    return 2;
  }
  const target = hexToRgb(diffColor);
  if (!target) {
    process.stderr.write("error: --diff-color must be a 6-digit hex color (e.g. ff0000)\n");
    return 2;
  }
  const PNG = await loadPng();
  if (!PNG) {
    process.stderr.write(
      "error: pngjs is not installed. install it in the project or confirm with the user before proceeding\n",
    );
    return 2;
  }
  let current;
  let next;
  let diff;
  try {
    current = PNG.sync.read(readFileSync(positionals[0]));
    next = PNG.sync.read(readFileSync(positionals[1]));
    diff = PNG.sync.read(readFileSync(positionals[2]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot read PNG inputs: ${message}\n`);
    return 2;
  }
  if (
    current.width !== next.width ||
    current.height !== next.height ||
    current.width !== diff.width ||
    current.height !== diff.height
  ) {
    process.stderr.write(
      `error: PNG dimensions differ (must match): current ${current.width}x${current.height}, new ${next.width}x${next.height}, diff ${diff.width}x${diff.height}\n`,
    );
    return 2;
  }
  const mask = buildDiffMask(diff.data, diff.width, diff.height, target, DEFAULT_COLOR_TOLERANCE);
  const strict = buildStrictMask(current.data, next.data, current.width * current.height, mask);
  const summary = summarizePixels(
    mask,
    strict.mask,
    strict.maxChannelDelta,
    strict.maxStrictOnlyChannelDelta,
  );
  const regions = filterAndMerge(clusterComponents(mask, diff.width, diff.height), minCluster, pad);
  try {
    mkdirSync(out, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot create out dir: ${message}\n`);
    return 2;
  }
  const result = [];
  for (let i = 0; i < regions.length; i += 1) {
    const id = i + 1;
    const cropCurrentPath = join(out, `crop-${id}-current.png`);
    const cropNewPath = join(out, `crop-${id}-new.png`);
    try {
      writeFileSync(
        cropCurrentPath,
        PNG.sync.write(cropImage(current, regions[i].bbox, cropMargin, PNG)),
      );
      writeFileSync(cropNewPath, PNG.sync.write(cropImage(next, regions[i].bbox, cropMargin, PNG)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: cannot write crops: ${message}\n`);
      return 2;
    }
    result.push({
      id,
      bbox: regions[i].bbox,
      pixels: regions[i].pixels,
      strict_pixels: countInBbox(strict.mask, current.width, regions[i].bbox),
      crop_current: cropCurrentPath,
      crop_new: cropNewPath,
    });
  }
  // しきい値の内側にだけ差がある画素も候補として出す。数だけ報告するとトリアージが
  // 「crop 対のある候補」を受け取れず、検出した差を分類も差し戻しもできないまま閉じてしまう。
  const strictOnlyMask = buildStrictOnlyMask(mask, strict.mask);
  const strictClustered = mergeThenFilter(
    clusterComponents(strictOnlyMask, diff.width, diff.height),
    strictMinCluster,
    pad,
  );
  const strictClusters = strictClustered.kept;
  const strictSelected = selectStrictRegions(strictClusters, strictMaxRegions);
  const strictResult = [];
  for (let i = 0; i < strictSelected.length; i += 1) {
    const id = strictSelected[i].id;
    const cropCurrentPath = join(out, `crop-${id}-current.png`);
    const cropNewPath = join(out, `crop-${id}-new.png`);
    try {
      writeFileSync(
        cropCurrentPath,
        PNG.sync.write(cropImage(current, strictSelected[i].bbox, cropMargin, PNG)),
      );
      writeFileSync(
        cropNewPath,
        PNG.sync.write(cropImage(next, strictSelected[i].bbox, cropMargin, PNG)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: cannot write crops: ${message}\n`);
      return 2;
    }
    strictResult.push({
      id,
      bbox: strictSelected[i].bbox,
      strict_pixels: strictSelected[i].pixels,
      crop_current: cropCurrentPath,
      crop_new: cropNewPath,
    });
  }
  summary.strict_only_regions_total = strictClusters.length;
  summary.strict_only_regions_emitted = strictResult.length;
  summary.strict_only_dropped_clusters = strictClustered.droppedClusters;
  summary.strict_only_dropped_pixels = strictClustered.droppedPixels;
  summary.strict_min_cluster = strictMinCluster;

  // しきい値の内側に差が隠れていることは、差分領域が 0 件でも起きる。stdout の summary だけでなく
  // stderr にも出して、「差分領域なし」を「一致」と読めないようにする。
  if (summary.strict_only_pixels > 0) {
    process.stderr.write(
      `warning: ${summary.strict_only_pixels} pixels differ below the recorded threshold ` +
        `(max channel delta among them ${summary.strict_only_max_channel_delta}, ` +
        `overall ${summary.strict_max_channel_delta}); ` +
        `${strictClusters.length} cluster(s) >= ${strictMinCluster}px, ` +
        `${strictResult.length} emitted as candidates; ` +
        `report both numbers and compare the strict counts with the noise baseline\n`,
    );
  }
  if (strictClusters.length > strictResult.length) {
    process.stderr.write(
      `warning: ${strictClusters.length - strictResult.length} strict-only cluster(s) were not ` +
        `emitted (--strict-max-regions ${strictMaxRegions}); raise the limit to triage them\n`,
    );
  }
  if (strictClustered.droppedClusters > 0) {
    process.stderr.write(
      `warning: ${strictClustered.droppedClusters} strict-only cluster(s) ` +
        `(${strictClustered.droppedPixels} pixels) stayed below --strict-min-cluster ` +
        `${strictMinCluster} after merging; lower the limit to turn them into candidates\n`,
    );
  }
  process.stdout.write(
    JSON.stringify({ summary, regions: result, strict_only_regions: strictResult }, null, 2) + "\n",
  );
  // 終了コードは「分類すべき候補があるか」を表す。strict-only の候補も候補なので 1 を返す。
  // 下限で捨てた分が残るときも 0 を返さない——候補を出せていない＝分類できていない状態であり、
  // ここで 0 にすると「差が無い」と読める（この PR が塞ごうとしている fail-open に戻る）。
  // 説明は summary の数と stderr の警告に出ているので、ノイズ基準値（strict 側）との対比で片付ける。
  const hasCandidate = result.length > 0 || strictResult.length > 0;
  return hasCandidate || strictClustered.droppedClusters > 0 ? 1 : 0;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる。
// process.argv[1] は起動時のパスのまま、import.meta.url も --preserve-symlinks(-main)
// （NODE_OPTIONS 経由でも付く）では未解決のままなので、片側だけ解決すると
// シンボリックリンク経由（.claude/skills/<name> → .agents/skills/<name>）の起動で条件が偽になり、
// main() が呼ばれず何も出力せず exit 0 になる（サイレント no-op）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パス解決に失敗したら生パスで突き合わせる（サイレント no-op より誤検出を選ぶ）。
    return entry === self;
  }
})();

if (invokedAsCli) {
  // 想定外の reject を握らないと未処理 rejection で exit 1 になり、
  // 「差分あり」（exit 1）と区別が付かないまま呼び出し側に伝わる。入力エラーと同じ exit 2 に寄せる。
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exit(2);
    });
}
