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
// 決定論的: 乱数・現在時刻に依存しない。連結成分はラスタ走査順に発見し、最終 bbox は
// (y, x) 昇順に整列するため入力が同じなら出力は常に同じ。
// PNG デコード/エンコードは pngjs を使う（pixel_tool が pixelmatch ならプロジェクトに入っていることが多い。
// 無ければ導入をユーザーに確認する。本スクリプトは勝手にインストールしない）。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * ツールのバージョン（正本）。クラスタリング・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.pixel_crops に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

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
 * 差分領域があれば exit 1、無ければ exit 0、入力エラーは exit 2。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const usage =
    "usage: node pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>]\n";
  const positionals = [];
  let out;
  let minCluster = 1;
  let pad = 8;
  let cropMargin = 24;
  let diffColor = "ff0000";
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
  const mask = buildDiffMask(diff.data, diff.width, diff.height, target, DEFAULT_COLOR_TOLERANCE);
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
      crop_current: cropCurrentPath,
      crop_new: cropNewPath,
    });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
