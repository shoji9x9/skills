// 画素の差分画像から、差分の領域を切り出す（原本）。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する。
// プロジェクトへはコピーしない。gh skill update の自動更新を反映させるためである。
//
// 入力は、記録済みの画素差分ツール（pixelmatch・odiff など。metadata.json の differ.pixel_tool）が出した
// 差分画像 diff.png である。差分として印の付いた画素を 8 近傍でつないで連結成分にまとめ、
// 近い bbox を合わせてから、current と new の同じ座標から crop 対を切り出す。
//
// 画素の比較そのもの（検出）は行わない。検出はツールに任せ、このスクリプトはツールの出力をまとめて
// crop を切り出すだけである（差分ツールを作り直さない）。
// 「検出は決定論的なツールが行い、モデルは分類だけを行う」という設計を、画素の比較で守るための部品である。
//
// ただし、**画素の量は 2 通りで報告する**。記録済みツールのしきい値（pixelmatch の threshold など）は、
// 許容の内側の差を総量にも件数にも出さない。そのため、その 1 通りだけを報告すると、小さな数が「ほぼ一致」と読まれる。
// 実測では、報告が 756 画素・0.0569% だったのに、緑が 1/255 違う画素が 3,364 画素あった。
// そこで、current と new をしきい値なしで比べた数を summary に並べて書く。
// 書くのは strict_pixels、そのうち印の付いていない strict_only_pixels、最大のチャンネル差の 2 つ
// （全体の strict_max_channel_delta と、内側だけの strict_only_max_channel_delta）である。
// これは検出のやり直しではなく、すでに読んでいる 2 枚の画素を数えるだけである。
//
// しきい値の内側にだけ差がある画素（strict-only）は、記録済みツールの差分画像に出ない。
// そのため従来の処理ではまとまりも crop 対も作られず、**数だけが報告されて分類できない**。
// トリアージは候補ごとの crop 対を入力にするので、数だけでは差し戻しにも分類にも進めない。
// そこで strict-only のマスクも同じようにまとめ、crop 対を持つ候補として出す。
// `--strict-min-cluster` 未満の孤立した画素は捨て、件数は `--strict-max-regions` で上限を付ける。
// 捨てた分も含めた総数を報告し、警告なしには捨てない。
//
// **同じ場所の 1 つの差は 1 つの候補にする。** アイコンの輪郭のにじみのような差では、芯の数画素が
// しきい値を超え、縁はしきい値の内側に収まる。分けたままだと、芯が regions に小さい bbox で、
// 縁が strict_only_regions に大きい bbox で出て、同じ差が 2 件になる。
// 台帳（画素の例外）は bbox の一致で照合する。そのため、どちらの bbox を書いても片方が unexplained に残り、
// 両方を書くと件数と承認の N が倍になる。
// そこで、strict-only の画素のうち、しきい値つきの領域の芯を `--pad` だけ広げた範囲にあるものは、
// その領域に取り込んで bbox を外側に広げる。strict_only_regions に残るのは、その範囲の外の画素から作った領域だけである。
// 縁が --pad より外まで続く差は、それでも 2 件に分かれることがある。
// そこで、外側の候補に、隣り合う領域の id（overlaps_regions）を付けて警告する。
//
// 乱数と現在時刻に依存しない。連結成分はラスタの走査順に見つけ、最後の bbox は
// (y, x) の昇順に並べるので、入力が同じなら出力も同じになる。
// PNG のデコードとエンコードには pngjs を使う（pixel_tool が pixelmatch なら、プロジェクトに入っていることが多い）。
// 無ければ、導入してよいかを利用者に確認する。このスクリプトは勝手にインストールしない。
// TypeScript の構文は使わない（型は JSDoc で書く）。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isCliEntry } from "./lib/cli.mjs";
import { loadPng } from "./lib/png.mjs";

/**
 * ツールのバージョン（原本）。まとめ方や出力の形を変えたら上げる。
 * diff-metadata.json の differ_versions.pixel_crops に記録する値はこれを使う（手入力にしない）。
 *
 * @type {string}
 */
export const VERSION = "4";

/**
 * 差分の色かを判定するときの、チャンネルの許容差（デフォルト）。
 * 赤 `(255,0,0)` と、アンチエイリアスの色によく使われる黄 `(255,255,0)` を分けられる幅にする。
 * 黄は緑のチャンネルが 255 で、赤の 0 から大きく離れるので除かれる。
 *
 * @type {number}
 */
export const DEFAULT_COLOR_TOLERANCE = 96;

/** @typedef {{ x:number, y:number, width:number, height:number }} Rect */
/** @typedef {{ width:number, height:number, data:Uint8Array }} PngImage */
/**
 * summarizePixels の戻り値。
 *
 * @typedef {{ total_pixels:number, threshold_pixels:number, strict_pixels:number,
 *             strict_only_pixels:number, strict_max_channel_delta:number,
 *             strict_only_max_channel_delta:(number|null),
 *             threshold_ratio:number, strict_ratio:number }} PixelSummary
 */

/**
 * 16 進カラー文字列（"ff0000" / "#ff0000"）を RGB に変換する。
 *
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
 *
 * @param {Uint8Array | Buffer} data - RGBA
 * @param {number} o - 画素のバイトオフセット
 * @param {{ target: { r:number, g:number, b:number }, tol: number }} color - 差分色と許容差
 * @returns {boolean}
 */
export function isDiffPixel(data, o, { target, tol }) {
  return (
    Math.abs(data[o] - target.r) <= tol &&
    Math.abs(data[o + 1] - target.g) <= tol &&
    Math.abs(data[o + 2] - target.b) <= tol
  );
}

/**
 * RGBA バッファ（pngjs の data）から差分マスク（0/1 の Uint8Array）を作る。
 *
 * @param {Uint8Array | Buffer} data - 長さ width*height*4 の RGBA
 * @param {{ width:number, height:number }} size
 * @param {{ target: { r:number, g:number, b:number }, tol: number }} color - 差分色と許容差
 * @returns {Uint8Array}
 */
export function buildDiffMask(data, { width, height }, color) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    mask[i] = isDiffPixel(data, i * 4, color) ? 1 : 0;
  }
  return mask;
}

/**
 * 1 画素の最大チャンネル差を返す。両方が完全な透明なら 0 にする。
 *
 * @param {Uint8Array | Buffer} currentData
 * @param {Uint8Array | Buffer} nextData
 * @param {number} o - 画素のバイトオフセット
 * @returns {number}
 */
function pixelChannelDelta(currentData, nextData, o) {
  // 両方が完全な透明なら、隠れている RGB が違っても画面には同じものが出る。
  // 生の 4 チャンネル比較のままだと見た目が同じ画素を strict の差として数え、
  // 見分けの付かない crop 対を候補にしてしまう（マスクした領域・要素切り出しで起きる）。
  const bothTransparent = currentData[o + 3] === 0 && nextData[o + 3] === 0;
  if (bothTransparent) return 0;
  let pixelDelta = 0;
  for (let c = 0; c < 4; c += 1) {
    const delta = Math.abs(currentData[o + c] - nextData[o + c]);
    if (delta > pixelDelta) pixelDelta = delta;
  }
  return pixelDelta;
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
 * @param {{ pixels: number, thresholdMask?: Uint8Array | null }} options - pixels は width*height。
 *   thresholdMask は差分画像から作ったマスク（しきい値の内側を切り分けるため）
 * @returns {{ mask: Uint8Array, count: number, maxChannelDelta: number, maxStrictOnlyChannelDelta: (number|null) }}
 */
export function buildStrictMask(currentData, nextData, { pixels, thresholdMask = null }) {
  const mask = new Uint8Array(pixels);
  let count = 0;
  let maxChannelDelta = 0;
  let maxStrictOnlyChannelDelta = 0;
  for (let i = 0; i < pixels; i += 1) {
    const pixelDelta = pixelChannelDelta(currentData, nextData, i * 4);
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
 * `strict_only_pixels` は**許容の内側に隠れた差**である。ここが非ゼロなら、差分領域が 0 件でも
 * 「一致」とは読めない（ノイズ基準値と対比して分類する。判断は呼び出し側＝トリアージが行う）。
 *
 * @param {Uint8Array} thresholdMask - 差分画像から作ったマスク
 * @param {Uint8Array} strictMask - 厳密比較のマスク
 * @param {{ maxChannelDelta: number, maxStrictOnlyChannelDelta?: number|null }} deltas -
 *   maxChannelDelta は差がある画素**全体**の最大チャンネル差。maxStrictOnlyChannelDelta は**しきい値の内側だけ**の
 *   最大チャンネル差（`buildStrictMask` に `thresholdMask` を渡した呼び出しでのみ定まる。渡していなければ null）
 *
 * @returns {PixelSummary}
 */
export function summarizePixels(
  thresholdMask,
  strictMask,
  { maxChannelDelta, maxStrictOnlyChannelDelta = null },
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
  /** @param {number} n */
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
 *
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
 * **id は採番しない**（`mergeThenFilter` が下限・上限のどちらも掛ける前に振ってある）。
 * ここで採番すると、`--strict-min-cluster` を下げたときも `--strict-max-regions` を上げたときも
 * 既存の候補が採番し直され、同じ `crop-sN-*` が別の bbox を指す。
 *
 * 選抜は画素数の多い順（同数なら y, x 昇順）で上限 max 件、出力は (y, x) 昇順。
 * 上限で外した分は、呼び出し側が総数と一緒に報告する（警告なしには捨てない）。
 *
 * @param {Array<{ id?:string, pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} regions
 * @param {number} max
 * @returns {Array<{ id:string, pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>}
 */
export function selectStrictRegions(regions, max) {
  const ordered = [...regions]
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .map((r, index) => ({ ...r, id: r.id ?? `s${index + 1}` }));
  const ranked = [...ordered].sort(
    (a, b) => b.pixels - a.pixels || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x,
  );
  const picked = ranked.slice(0, max);
  picked.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return picked;
}

/**
 * bbox の内側で mask が立っている画素数を数える。
 *
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
 * 8 近傍のうち、mask が立っていてまだ訪れていない画素を stack に積み、訪れた印を付ける。
 *
 * @param {number} x
 * @param {number} y
 * @param {{ mask: Uint8Array, visited: Uint8Array, width: number, height: number, stack: number[] }} state
 */
function pushUnvisitedNeighbors(x, y, { mask, visited, width, height, stack }) {
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

/**
 * 画素の座標 (x, y) を含むように、最小と最大の座標を広げる（bounds をその場で更新する）。
 *
 * @param {{ minX:number, minY:number, maxX:number, maxY:number }} bounds
 * @param {number} x
 * @param {number} y
 */
function growBounds(bounds, x, y) {
  if (x < bounds.minX) bounds.minX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y > bounds.maxY) bounds.maxY = y;
}

/**
 * 差分マスクを 8 近傍で連結成分にクラスタリングする。ラスタ走査順にシードするため決定論的。
 *
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
    const bounds = { minX: width, minY: height, maxX: 0, maxY: 0 };
    let pixels = 0;
    const stack = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop();
      // 直前の条件で stack は空でないので、undefined にはならない（型の絞り込みのため）。
      if (idx === undefined) break;
      const x = idx % width;
      const y = (idx - x) / width;
      pixels += 1;
      growBounds(bounds, x, y);
      pushUnvisitedNeighbors(x, y, { mask, visited, width, height, stack });
    }
    const { minX, minY, maxX, maxY } = bounds;
    components.push({
      pixels,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    });
  }
  return components;
}

/**
 * pad 拡張した 2 つの bbox が重なるかを判定する。
 *
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
 *
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
 * 1 つの芯を pad だけ広げた範囲にある strict-only の画素を取り込み、remainingMask から外す。
 *
 * @param {{ pixels:number, bbox:Rect }} r - しきい値つきの領域
 * @param {{ remainingMask: Uint8Array, width:number, height:number, pad:number }} area
 * @returns {{ pixels:number, bbox:Rect, threshold_bbox:Rect, members:Rect[], absorbed_strict_only_pixels:number }}
 */
function absorbAroundCore(r, { remainingMask, width, height, pad }) {
  const x0 = Math.max(0, r.bbox.x - pad);
  const y0 = Math.max(0, r.bbox.y - pad);
  const x1 = Math.min(width - 1, r.bbox.x + r.bbox.width - 1 + pad);
  const y1 = Math.min(height - 1, r.bbox.y + r.bbox.height - 1 + pad);
  let count = 0;
  const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const idx = y * width + x;
      if (remainingMask[idx] !== 1) continue;
      remainingMask[idx] = 0;
      count += 1;
      growBounds(bounds, x, y);
    }
  }
  const members = [r.bbox];
  let bbox = r.bbox;
  if (count > 0) {
    const { minX, minY, maxX, maxY } = bounds;
    const halo = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    members.push(halo);
    bbox = unionBbox(bbox, halo);
  }
  return {
    pixels: r.pixels,
    bbox,
    threshold_bbox: r.bbox,
    members,
    absorbed_strict_only_pixels: count,
  };
}

/**
 * 構成要素が pad 以内か、bbox が重なる領域を、まとめる相手が無くなるまで 1 つにまとめる。
 *
 * @param {Array<{ pixels:number, bbox:Rect, threshold_bbox:Rect, members:Rect[], absorbed_strict_only_pixels:number }>} initial
 * @param {number} pad
 */
function mergeNearGroups(initial, pad) {
  let groups = initial;
  /**
   * @param {Rect[]} xs
   * @param {Rect[]} ys
   */
  const near = (xs, ys) => xs.some((a) => ys.some((b) => bboxOverlap(a, b, pad)));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = groups[i];
        const b = groups[j];
        // 構成要素が近いか、bbox が重なればまとめる。構成要素だけで判定すると、斜めに並んだ 2 つの芯がまとまった
        // 大きな bbox の角に 3 つ目の領域が丸ごと入ったまま、別の候補として残る（同じ画素が 2 つの crop に入る）。
        // どの bbox も「芯＋pad」の合併の内側なので、しきい値の内側の差だけで連鎖が広がることはない。
        if (near(a.members, b.members) || bboxOverlap(a.bbox, b.bbox, 0)) {
          const combined = {
            pixels: a.pixels + b.pixels,
            bbox: unionBbox(a.bbox, b.bbox),
            threshold_bbox: unionBbox(a.threshold_bbox, b.threshold_bbox),
            members: [...a.members, ...b.members],
            absorbed_strict_only_pixels:
              a.absorbed_strict_only_pixels + b.absorbed_strict_only_pixels,
          };
          groups = groups.filter((_, k) => k !== i && k !== j);
          groups.push(combined);
          merged = true;
          break;
        }
      }
    }
  }
  return groups;
}

/**
 * まとめた領域の bbox の内側に残る strict-only の画素を、その領域に取り込む。取り込んだ画素数を返す。
 *
 * @param {Array<{ bbox:Rect, absorbed_strict_only_pixels:number }>} groups
 * @param {Uint8Array} remainingMask
 * @param {number} width
 * @returns {number}
 */
function sweepGroupBboxes(groups, remainingMask, width) {
  let swept = 0;
  for (const g of groups) {
    for (let y = g.bbox.y; y < g.bbox.y + g.bbox.height; y += 1) {
      for (let x = g.bbox.x; x < g.bbox.x + g.bbox.width; x += 1) {
        const idx = y * width + x;
        if (remainingMask[idx] !== 1) continue;
        remainingMask[idx] = 0;
        g.absorbed_strict_only_pixels += 1;
        swept += 1;
      }
    }
  }
  return swept;
}

/**
 * しきい値つきの領域に、芯を pad だけ広げた範囲にある strict-only の**画素**を取り込む。
 *
 * 同じ場所の 1 つの差（芯はしきい値を超え、縁はしきい値の内側）を 1 つの候補にするための段。
 * **取り込むのは画素単位で、芯（しきい値つきの領域の bbox）を pad だけ広げた範囲の内側にある画素だけである**。
 * 連結成分・マージした塊・外接 bbox を単位にすると、まばらに散った差の塊や、ページ全体に広がる 1 つの差
 * （背景色の 1 階調のずれなど）が丸ごと取り込まれる。
 * すると領域の bbox が画面の大きさまで広がり、離れた領域まで 1 件にまとまってしまう。
 * 画素単位なら、取り込み後の領域の bbox は常に「芯＋pad」の内側に収まり、範囲の外の画素は strict-only に残る。
 *
 * 芯を広げた範囲が重なる画素は、入力順で先の領域が取る（二重に数えない）。
 * 取り込み後、構成要素（芯と取り込んだ画素の bbox）同士が pad 以内の領域は 1 つにまとめる
 * （どちらも「芯＋pad」の内側なので、まとめる範囲も有界）。
 *
 * @param {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} regions - しきい値つきの領域
 * @param {Uint8Array} strictOnlyMask - しきい値の内側にだけ差がある画素のマスク
 * @param {{ width:number, height:number, pad:number }} area - 画像の寸法と、芯を広げる幅
 * @returns {{ regions: Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number },
 *                              threshold_bbox:{ x:number, y:number, width:number, height:number },
 *                              absorbed_strict_only_pixels:number }>,
 *             remainingMask: Uint8Array, absorbedPixels:number }}
 */
export function absorbStrictIntoRegions(regions, strictOnlyMask, { width, height, pad }) {
  const remainingMask = Uint8Array.from(strictOnlyMask);
  const absorbedGroups = regions.map((r) =>
    absorbAroundCore(r, { remainingMask, width, height, pad }),
  );
  let absorbedPixels = absorbedGroups.reduce((sum, g) => sum + g.absorbed_strict_only_pixels, 0);
  const groups = mergeNearGroups(absorbedGroups, pad);
  // まとめた領域の bbox は各「芯＋pad」を包む矩形なので、その角にはどの芯の範囲にも入らない画素が残りうる。
  // 残すと候補の bbox の内側に別の strict-only 候補が出て、同じ場所の差が 2 件に分かれる。
  // bbox の内側だけを取るので bbox は広がらない（有界のまま・これ以上まとめる相手も増えない）。
  absorbedPixels += sweepGroupBboxes(groups, remainingMask, width);
  groups.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  // members は判定用の内部状態なので出力に出さない（threshold_bbox が芯を包む bbox として残る）。
  return {
    regions: groups.map(({ members: _members, ...g }) => g),
    remainingMask,
    absorbedPixels,
  };
}

/**
 * strict-only の候補ごとに、bbox が重なるか接する（隣の画素に並ぶ）しきい値つきの候補の id を返す。
 *
 * 縁を取り込むのは「芯＋pad」の範囲に限る。範囲を広げると、ページ全体に広がる差がすべての領域を 1 件にまとめてしまう。
 * そのため、縁が pad より外まで続く差（box-shadow のぼかしの差など）は、芯の候補と外側の strict-only の候補の 2 件に分かれることがある。
 * 分かれたことが見えるように、隣り合う相手を候補に書く。トリアージと台帳はこれを読み、同じ場所の差として扱う。
 *
 * @param {Array<{ bbox:{ x:number, y:number, width:number, height:number } }>} strictCandidates
 * @param {Array<{ id:number, bbox:{ x:number, y:number, width:number, height:number } }>} regions
 * @returns {number[][]} strictCandidates と同じ並びで、隣り合う regions の id（昇順）
 */
export function adjacentRegionIds(strictCandidates, regions) {
  return strictCandidates.map((s) =>
    regions
      .filter((r) => bboxOverlap(r.bbox, s.bbox, 1))
      .map((r) => r.id)
      .sort((a, b) => a - b),
  );
}

/**
 * **先に pad 以内でマージしてから** minCluster 未満を落とす。結果は (y, x) 昇順。
 *
 * strict-only はこちらを使う。`filterAndMerge`（捨ててからマージ）では、
 * **1〜3 画素の連結成分に散る差**（細いグリフのヒンティングの差・点線の装飾の差など）が、
 * 近くの箱と合わさる前にすべて消える。すると `strict_only_pixels > 0` なのに候補が 0 件で exit 0 になり、
 * 差があるのに合格として扱われる。
 *
 * マージした後も下限に満たない分は捨てるが、**件数と画素数を返して呼び出し側に報告させる**
 * （警告なしには捨てない）。しきい値つきの領域の縁は、呼び出し側が先に `absorbStrictIntoRegions` で取り込み、
 * 残りのマスクから作った成分だけをここへ渡す。
 *
 * @param {Array<{ pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>} components
 * @param {number} minCluster
 * @param {number} pad
 * @returns {{ kept: Array<{ id:string, pixels:number, bbox:{ x:number, y:number, width:number, height:number } }>,
 *             droppedClusters:number, droppedPixels:number }}
 */
export function mergeThenFilter(components, minCluster, pad) {
  // id は**どちらのフィルタも掛ける前**のマージ済み全体の並び（(y, x) 昇順）から決める。
  // 下限で絞った後に採番すると、警告に従って --strict-min-cluster を下げたときに
  // 手前の小さな成分が s1 になり、既存の s1 が s2 へずれる（記録済みのトリアージが別の crop に貼り付く）。
  const merged = filterAndMerge(components, 1, pad).map((r, index) => ({
    ...r,
    id: `s${index + 1}`,
  }));
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
 *
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
 *
 * @param {{ width:number, height:number, data:Uint8Array }} img - pngjs の PNG インスタンス相当
 * @param {{ x:number, y:number, width:number, height:number }} bbox
 * @param {{ margin:number, PngCtor: new (opts:{ width:number, height:number }) => { width:number, height:number, data:Uint8Array } }} options
 */
function cropImage(img, bbox, { margin, PngCtor }) {
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

const USAGE =
  "usage: node pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>] [--strict-min-cluster <count>] [--strict-max-regions <count>]\n";

/** 数で受けるオプション（フラグ → 設定の名前）。 */
/** @type {Map<string, "minCluster" | "pad" | "cropMargin" | "strictMinCluster" | "strictMaxRegions">} */
const NUMBER_FLAGS = new Map([
  ["--min-cluster", "minCluster"],
  ["--pad", "pad"],
  ["--crop-margin", "cropMargin"],
  ["--strict-min-cluster", "strictMinCluster"],
  ["--strict-max-regions", "strictMaxRegions"],
]);

/**
 * @typedef {{ positionals: string[], out?: string, minCluster:number, pad:number, cropMargin:number,
 *   diffColor: string, strictMinCluster:number, strictMaxRegions:number }} CliOptions
 */

/**
 * 引数を読む。値の検査は validateOptions が行う。
 *
 * @param {string[]} argv
 * @returns {CliOptions}
 */
function parseCliArgs(argv) {
  /** @type {CliOptions} */
  const options = {
    positionals: [],
    out: undefined,
    minCluster: 1,
    pad: 8,
    cropMargin: 24,
    diffColor: "ff0000",
    // strict-only はアンチエイリアスの孤立画素まで拾うため、既定のクラスタ下限を threshold 側より高くする。
    strictMinCluster: 4,
    strictMaxRegions: 20,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") {
      options.out = argv[i + 1];
      i += 1;
    } else if (NUMBER_FLAGS.has(a)) {
      const key = NUMBER_FLAGS.get(a);
      if (key !== undefined) options[key] = Number(argv[i + 1]);
      i += 1;
    } else if (a === "--diff-color") {
      options.diffColor = argv[i + 1];
      i += 1;
    } else {
      options.positionals.push(a);
    }
  }
  return options;
}

/**
 * 数のオプションと差分色を確かめる。誤りは stderr に出す 1 行で返す。
 *
 * @param {CliOptions} options
 * @returns {{ error: string } | { target: { r:number, g:number, b:number } }}
 */
function validateOptions({
  minCluster,
  pad,
  cropMargin,
  strictMinCluster,
  strictMaxRegions,
  diffColor,
}) {
  if (
    !Number.isFinite(minCluster) ||
    minCluster < 1 ||
    !Number.isFinite(pad) ||
    pad < 0 ||
    !Number.isFinite(cropMargin) ||
    cropMargin < 0
  ) {
    return { error: "error: --min-cluster must be >= 1, --pad and --crop-margin must be >= 0\n" };
  }
  if (
    !Number.isFinite(strictMinCluster) ||
    strictMinCluster < 1 ||
    !Number.isFinite(strictMaxRegions) ||
    strictMaxRegions < 1
  ) {
    return { error: "error: --strict-min-cluster and --strict-max-regions must be >= 1\n" };
  }
  const target = hexToRgb(diffColor);
  if (!target) {
    return { error: "error: --diff-color must be a 6-digit hex color (e.g. ff0000)\n" };
  }
  return { target };
}

/**
 * current / new / diff の PNG を読み、寸法が揃うかを確かめる。誤りは stderr に出す 1 行で返す。
 *
 * @param {string[]} paths - current, new, diff の順
 * @param {{ sync: { read: (buf: Buffer) => PngImage } }} PNG
 * @returns {{ error: string } | { current: PngImage, next: PngImage, diff: PngImage }}
 */
function readImages(paths, PNG) {
  let current;
  let next;
  let diff;
  try {
    current = PNG.sync.read(readFileSync(paths[0]));
    next = PNG.sync.read(readFileSync(paths[1]));
    diff = PNG.sync.read(readFileSync(paths[2]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `error: cannot read PNG inputs: ${message}\n` };
  }
  if (
    current.width !== next.width ||
    current.height !== next.height ||
    current.width !== diff.width ||
    current.height !== diff.height
  ) {
    return {
      error: `error: PNG dimensions differ (must match): current ${current.width}x${current.height}, new ${next.width}x${next.height}, diff ${diff.width}x${diff.height}\n`,
    };
  }
  return { current, next, diff };
}

/**
 * @typedef {{ PNG: { new (opts:{ width:number, height:number }): PngImage, sync: { write(png: PngImage): Uint8Array } },
 *   current: PngImage, next: PngImage, out: string, cropMargin: number }} CropContext
 */

/**
 * 1 つの bbox の crop 対を書き出し、パスを返す。書けなければ例外を投げる。
 *
 * @param {string | number} id
 * @param {Rect} bbox
 * @param {CropContext} context
 * @returns {{ cropCurrentPath: string, cropNewPath: string }}
 */
function writeCropPair(id, bbox, { PNG, current, next, out, cropMargin }) {
  const cropCurrentPath = join(out, `crop-${id}-current.png`);
  const cropNewPath = join(out, `crop-${id}-new.png`);
  const options = { margin: cropMargin, PngCtor: PNG };
  writeFileSync(cropCurrentPath, PNG.sync.write(cropImage(current, bbox, options)));
  writeFileSync(cropNewPath, PNG.sync.write(cropImage(next, bbox, options)));
  return { cropCurrentPath, cropNewPath };
}

/**
 * しきい値つきの領域ごとに crop 対を書き出し、候補の一覧にする。書けなければ例外を投げる。
 *
 * @param {Array<{ pixels:number, bbox:Rect, threshold_bbox:Rect, absorbed_strict_only_pixels:number }>} regions
 * @param {Uint8Array} strictMask
 * @param {CropContext} context
 */
function writeRegionCrops(regions, strictMask, context) {
  return regions.map((region, i) => {
    const id = i + 1;
    const { cropCurrentPath, cropNewPath } = writeCropPair(id, region.bbox, context);
    return {
      id,
      bbox: region.bbox,
      pixels: region.pixels,
      strict_pixels: countInBbox(strictMask, context.current.width, region.bbox),
      threshold_bbox: region.threshold_bbox,
      absorbed_strict_only_pixels: region.absorbed_strict_only_pixels,
      crop_current: cropCurrentPath,
      crop_new: cropNewPath,
    };
  });
}

/**
 * strict-only の領域ごとに crop 対を書き出し、候補の一覧にする。書けなければ例外を投げる。
 *
 * @param {Array<{ id:string, pixels:number, bbox:Rect }>} selected
 * @param {CropContext} context
 * @returns {Array<{ id:string, bbox:Rect, strict_pixels:number, crop_current:string, crop_new:string,
 *   overlaps_regions?:number[] }>}
 */
function writeStrictCrops(selected, context) {
  return selected.map((region) => {
    const { cropCurrentPath, cropNewPath } = writeCropPair(region.id, region.bbox, context);
    return {
      id: region.id,
      bbox: region.bbox,
      strict_pixels: region.pixels,
      crop_current: cropCurrentPath,
      crop_new: cropNewPath,
    };
  });
}

/**
 * 差分画像のマスクから、しきい値つきの領域（strict-only の縁を取り込んだもの）と strict-only のクラスタを作る。
 *
 * @param {Uint8Array} mask - 差分画像から作ったマスク
 * @param {Uint8Array} strictMask - 厳密比較のマスク
 * @param {{ width:number, height:number, minCluster:number, pad:number, strictMinCluster:number }} options
 */
function buildCandidates(mask, strictMask, { width, height, minCluster, pad, strictMinCluster }) {
  const thresholdRegions = filterAndMerge(clusterComponents(mask, width, height), minCluster, pad);
  // しきい値の内側にだけ差がある画素も候補として出す。数だけ報告するとトリアージが
  // 「crop 対のある候補」を受け取れず、検出した差を分類も差し戻しもできないまま閉じてしまう。
  // ただし、しきい値つきの領域と重なる分はその領域の縁（同じ場所の同じ差）なので、領域へ取り込んで
  // 1 つの候補にする（分けると同じ差が別の bbox で 2 件になり、台帳の照合が片方にしか当たらない）。
  const strictOnlyMask = buildStrictOnlyMask(mask, strictMask);
  const absorbed = absorbStrictIntoRegions(thresholdRegions, strictOnlyMask, {
    width,
    height,
    pad,
  });
  const strictClustered = mergeThenFilter(
    clusterComponents(absorbed.remainingMask, width, height),
    strictMinCluster,
    pad,
  );
  return { absorbed, strictClustered };
}

/**
 * 候補を作った結果を警告として stderr に出す。
 *
 * @param {{ summary: PixelSummary, strictClusters: unknown[], emitted: number, splitCount: number,
 *   absorbedPixels: number, droppedClusters: number, droppedPixels: number,
 *   options: { pad:number, strictMinCluster:number, strictMaxRegions:number } }} report
 */
function warnStrictOnly({
  summary,
  strictClusters,
  emitted,
  splitCount,
  absorbedPixels,
  droppedClusters,
  droppedPixels,
  options: { pad, strictMinCluster, strictMaxRegions },
}) {
  // しきい値の内側に差が隠れていることは、差分領域が 0 件でも起きる。stdout の summary だけでなく
  // stderr にも出して、「差分領域なし」を「一致」と読めないようにする。
  if (summary.strict_only_pixels > 0) {
    process.stderr.write(
      `warning: ${summary.strict_only_pixels} pixels differ below the recorded threshold ` +
        `(max channel delta among them ${summary.strict_only_max_channel_delta}, ` +
        `overall ${summary.strict_max_channel_delta}); ` +
        `${strictClusters.length} cluster(s) >= ${strictMinCluster}px, ` +
        `${emitted} emitted as candidates, ` +
        `${absorbedPixels} pixel(s) within --pad of a threshold region merged into it; ` +
        `report both numbers and compare the strict counts with the noise baseline\n`,
    );
  }
  if (splitCount > 0) {
    process.stderr.write(
      `warning: ${splitCount} strict-only candidate(s) overlap or touch a threshold region ` +
        `(see overlaps_regions): the fringe of the same difference extends beyond --pad ${pad}; ` +
        `triage them together with those regions as one place\n`,
    );
  }
  if (strictClusters.length > emitted) {
    process.stderr.write(
      `warning: ${strictClusters.length - emitted} strict-only cluster(s) were not ` +
        `emitted (--strict-max-regions ${strictMaxRegions}); raise the limit to triage them\n`,
    );
  }
  if (droppedClusters > 0) {
    process.stderr.write(
      `warning: ${droppedClusters} strict-only cluster(s) ` +
        `(${droppedPixels} pixels) stayed below --strict-min-cluster ` +
        `${strictMinCluster} after merging; lower the limit to turn them into candidates\n`,
    );
  }
}

/**
 * 入力を読み、確かめる。誤りは stderr に出す 1 行で返す。
 *
 * @param {string[]} argv
 */
async function prepareInputs(argv) {
  const options = parseCliArgs(argv);
  const { positionals, out } = options;
  if (positionals.length !== 3 || !out) return { error: USAGE };
  const validated = validateOptions(options);
  if ("error" in validated) return validated;
  const PNG = await loadPng();
  if (!PNG) {
    return {
      error:
        "error: pngjs is not installed. install it in the project or confirm with the user before proceeding\n",
    };
  }
  const images = readImages(positionals, PNG);
  if ("error" in images) return images;
  return { options, out, target: validated.target, PNG, ...images };
}

/**
 * 出力のディレクトリを作り、しきい値つきの候補と strict-only の候補の crop 対を書き出す。
 * 誤りは stderr に出す 1 行で返す。
 *
 * @param {{ regions: Array<{ pixels:number, bbox:Rect, threshold_bbox:Rect, absorbed_strict_only_pixels:number }>,
 *   strictMask: Uint8Array, strictSelected: Array<{ id:string, pixels:number, bbox:Rect }>, context: CropContext }} input
 * @returns {{ error: string } | { result: ReturnType<typeof writeRegionCrops>, strictResult: ReturnType<typeof writeStrictCrops> }}
 */
function writeAllCrops({ regions, strictMask, strictSelected, context }) {
  try {
    mkdirSync(context.out, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `error: cannot create out dir: ${message}\n` };
  }
  try {
    const result = writeRegionCrops(regions, strictMask, context);
    const strictResult = writeStrictCrops(strictSelected, context);
    return { result, strictResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `error: cannot write crops: ${message}\n` };
  }
}

/**
 * 差分画像と 2 枚の画像から、マスク・summary・候補の領域を作る。
 *
 * @param {{ options: CliOptions, target: { r:number, g:number, b:number }, current: PngImage, next: PngImage, diff: PngImage }} inputs
 */
function analyzeImages({ options, target, current, next, diff }) {
  const mask = buildDiffMask(diff.data, diff, { target, tol: DEFAULT_COLOR_TOLERANCE });
  const strict = buildStrictMask(current.data, next.data, {
    pixels: current.width * current.height,
    thresholdMask: mask,
  });
  /**
   * 候補を作った後に、strict-only の件数を書き足す。
   *
   * @type {PixelSummary & { strict_only_regions_total?:number, strict_only_regions_emitted?:number,
   *   strict_only_dropped_clusters?:number, strict_only_dropped_pixels?:number,
   *   strict_min_cluster?:number, strict_only_absorbed_pixels?:number,
   *   strict_only_overlapping_regions?:number }}
   */
  const summary = summarizePixels(mask, strict.mask, strict);
  const { absorbed, strictClustered } = buildCandidates(mask, strict.mask, {
    width: diff.width,
    height: diff.height,
    minCluster: options.minCluster,
    pad: options.pad,
    strictMinCluster: options.strictMinCluster,
  });
  return { strict, summary, absorbed, strictClustered };
}

/**
 * strict-only の候補に、隣り合うしきい値つきの候補の id（overlaps_regions）を書き足す。
 * 隣り合う相手を持つ候補の数を返す。
 *
 * @param {Array<{ bbox:Rect, overlaps_regions?:number[] }>} strictResult
 * @param {Array<{ id:number, bbox:Rect }>} result
 * @returns {number}
 */
function markAdjacentRegions(strictResult, result) {
  const adjacency = adjacentRegionIds(strictResult, result);
  strictResult.forEach((s, i) => {
    s.overlaps_regions = adjacency[i];
  });
  return strictResult.filter(
    (s) => s.overlaps_regions !== undefined && s.overlaps_regions.length > 0,
  ).length;
}

/**
 * CLI エントリ。
 * `node pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>]`
 *
 * stdout には `{ summary, regions, strict_only_regions }` を出す。
 * - summary: しきい値つきとしきい値なしの画素数
 * - regions: 記録済みツールが出した差分領域の crop 対。bbox は、芯＋--pad の範囲の strict-only の縁を取り込んだ外側の bbox
 * - strict_only_regions: しきい値の内側にだけ差があり、その範囲の外にある画素から作った領域の crop 対
 *
 * 分類すべき候補（どちらかの領域）があれば exit 1、無ければ exit 0、入力の誤りは exit 2 で終わる。
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const inputs = await prepareInputs(argv);
  if ("error" in inputs) {
    process.stderr.write(inputs.error);
    return 2;
  }
  const { options, out, PNG, current, next } = inputs;
  const { pad, cropMargin, strictMinCluster, strictMaxRegions } = options;
  const { strict, summary, absorbed, strictClustered } = analyzeImages(inputs);
  const strictClusters = strictClustered.kept;
  const written = writeAllCrops({
    regions: absorbed.regions,
    strictMask: strict.mask,
    strictSelected: selectStrictRegions(strictClusters, strictMaxRegions),
    context: { PNG, current, next, out, cropMargin },
  });
  if ("error" in written) {
    process.stderr.write(written.error);
    return 2;
  }
  const { result, strictResult } = written;
  summary.strict_only_regions_total = strictClusters.length;
  summary.strict_only_regions_emitted = strictResult.length;
  summary.strict_only_dropped_clusters = strictClustered.droppedClusters;
  summary.strict_only_dropped_pixels = strictClustered.droppedPixels;
  summary.strict_min_cluster = strictMinCluster;
  summary.strict_only_absorbed_pixels = absorbed.absorbedPixels;
  const splitCount = markAdjacentRegions(strictResult, result);
  summary.strict_only_overlapping_regions = splitCount;
  warnStrictOnly({
    summary,
    strictClusters,
    emitted: strictResult.length,
    splitCount,
    absorbedPixels: absorbed.absorbedPixels,
    droppedClusters: strictClustered.droppedClusters,
    droppedPixels: strictClustered.droppedPixels,
    options: { pad, strictMinCluster, strictMaxRegions },
  });
  process.stdout.write(
    JSON.stringify({ summary, regions: result, strict_only_regions: strictResult }, null, 2) + "\n",
  );
  // 終了コードは「分類すべき候補があるか」を表す。strict-only の候補も候補なので 1 を返す。
  // 下限で捨てた分が残るときも 0 を返さない。候補を出せていないので、分類できていない。
  // ここで 0 にすると「差が無い」と読め、差があるのに合格として扱われる。
  // 説明は summary の数と stderr の警告に出ているので、ノイズ基準値（strict 側）との対比で片付ける。
  const hasCandidate = result.length > 0 || strictResult.length > 0;
  return hasCandidate || strictClustered.droppedClusters > 0 ? 1 : 0;
}

if (isCliEntry(import.meta.url)) {
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
