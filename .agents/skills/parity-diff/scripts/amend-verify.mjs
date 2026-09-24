// 共通部品の改修後、新側の撮り直しを機械で判定する（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
//
// 何のためか: 部品の改修（変更宣言。parity-component の component-change.json）が影響する組を撮り直したとき、
// 変更の中身は分かっているのに、撮り直しの結果をページごとに検出 → トリアージ → 承認で分類し直すことになる。
// 変更が宣言どおりなら次の 2 つが成り立つので、それを画素で確かめて分類のやり直しを省く。
//   1) 影響インスタンスの矩形（margin だけ広げた領域）の**外**は、改修前の新側と画素が完全に一致する
//   2) 領域の**中**は、現行との不一致画素が改修前より増えていない
// どちらかが崩れた組だけを従来のトリアージへ回す。
//
// 何をしないか: 画素の差が重要かどうかは判断しない（許容・要対応の分類はしない）。現側は撮り直さない前提で、
// 渡された current をそのまま正解の基準に使う。
//
// 比較の規則: 領域の外は RGBA のバイト完全一致（隠れた RGB の違いも差にする。外は「何も変わっていない」を
// 示す側なので緩めない）。領域の中の現行との不一致は parity-suite の pixel-strict-count.mjs と同じ厳密比較
// （しきい値なし。両側とも完全な透明な画素だけは差にしない）。同梱スクリプトは互いを import しないので、
// 計数規則を直したら両方を直す。
//
// 記録には入力画像のパス（与えられたまま）と sha256 を残す。証跡の鮮度検査はこの sha256 を今のファイルと
// 突き合わせるので、判定後に画像を差し替えると持ち越しが通らない。
// パスの規則: 読む側（parity-suite の scripts/evidence-carry.mjs）は相対パスを**プロジェクトルート
// （.replace の親ディレクトリ）**から解決する（記録ファイルのディレクトリからではない）。
// このスクリプトはプロジェクトルートを作業ディレクトリにして、画像をプロジェクトルート相対（か絶対パス）で渡す。
//
// 決定論的: 乱数・現在時刻に依存しない。PNG のデコードは pngjs を使う（無ければ導入をユーザーに確認する。
// 本スクリプトは勝手にインストールしない）。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・記録の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** @typedef {{ width:number, height:number, data:Uint8Array }} Image */
/** @typedef {{ x:number, y:number, width:number, height:number }} Rect */

/**
 * `x,y,w,h` を矩形にする。数でない・幅か高さが 0 以下なら null（空の領域は「変更が効いた場所」を示さない）。
 * @param {string} text
 * @returns {Rect | null}
 */
export function parseRegion(text) {
  const parts = String(text).split(",");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (p.trim() === "" ? Number.NaN : Number(p)));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  const [x, y, width, height] = nums;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * JSON の領域表記（`{x,y,width,height}` か `[x,y,w,h]`）を矩形にする。読めなければ null。
 * @param {unknown} value
 * @returns {Rect | null}
 */
export function regionFromJson(value) {
  if (Array.isArray(value)) return parseRegion(value.join(","));
  if (value && typeof value === "object") {
    const r = /** @type {Record<string, unknown>} */ (value);
    if ([r.x, r.y, r.width, r.height].some((v) => typeof v !== "number")) return null;
    return parseRegion(`${r.x},${r.y},${r.width},${r.height}`);
  }
  return null;
}

/**
 * 矩形を margin だけ広げ、画像の範囲に切り詰めて整数の画素矩形にする。
 * 小数の rect（getBoundingClientRect 由来）は外側へ丸める（掛かっている画素を領域から落とさない）。
 * 画像と重ならなければ null。
 * @param {Rect} rect
 * @param {number} margin
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Rect | null}
 */
export function expandRegion(rect, margin, imageWidth, imageHeight) {
  const left = Math.max(0, Math.floor(rect.x - margin));
  const top = Math.max(0, Math.floor(rect.y - margin));
  const right = Math.min(imageWidth, Math.ceil(rect.x + rect.width + margin));
  const bottom = Math.min(imageHeight, Math.ceil(rect.y + rect.height + margin));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 領域の和集合のマスク（1 = 領域の中）を作る。
 * @param {Rect[]} regions - expandRegion 済みの矩形
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
export function buildRegionMask(regions, width, height) {
  const mask = new Uint8Array(width * height);
  for (const r of regions) {
    for (let y = r.y; y < r.y + r.height; y += 1) {
      mask.fill(1, y * width + r.x, y * width + r.x + r.width);
    }
  }
  return mask;
}

/**
 * 厳密比較で 1 画素が違うか（pixel-strict-count.mjs と同じ規則。両側とも完全な透明なら同じ）。
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @param {number} o - バイトオフセット
 * @returns {boolean}
 */
function strictDiffers(a, b, o) {
  if (a[o + 3] === 0 && b[o + 3] === 0) return false;
  return a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3];
}

/**
 * 1 組を判定する（純関数。デコード済みの RGBA を受ける）。
 * - prev-new と new の寸法が違う → fail（改修で配置が動いた。外の一致を画素で示せない）
 * - current の寸法が new と違う → fail（現行との不一致を同じ座標で数えられない）
 * - 領域が 1 つも画像と重ならない → fail（宣言したインスタンスが画面に無い）
 * - pass = 領域の外がバイト完全一致 && 領域の中の現行との不一致が増えていない
 * @param {{ prevNew: Image, next: Image, current: Image, regions: Rect[], margin?: number }} input
 * @returns {{ pass:boolean, outside_identical:boolean, outside_diff_pixels:(number|null),
 *             inside_diff_before:(number|null), inside_diff_after:(number|null),
 *             regions: Rect[], reasons: string[] }}
 */
export function judgePair({ prevNew, next, current, regions, margin = 0 }) {
  const failed = (reason, clamped = []) => ({
    pass: false,
    outside_identical: false,
    outside_diff_pixels: null,
    inside_diff_before: null,
    inside_diff_after: null,
    regions: clamped,
    reasons: [reason],
  });
  if (prevNew.width !== next.width || prevNew.height !== next.height) {
    return failed(
      `dimensions changed: prev-new ${prevNew.width}x${prevNew.height} vs new ${next.width}x${next.height}`,
    );
  }
  if (current.width !== next.width || current.height !== next.height) {
    return failed(
      `current dimensions differ from new: ${current.width}x${current.height} vs ${next.width}x${next.height}`,
    );
  }
  const { width, height } = next;
  const clamped = [];
  for (const r of regions) {
    const e = expandRegion(r, margin, width, height);
    if (e) clamped.push(e);
  }
  if (clamped.length === 0) {
    return failed("no region overlaps the image (declared instances are not on this capture)");
  }
  const mask = buildRegionMask(clamped, width, height);
  let outside = 0;
  let before = 0;
  let after = 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (mask[i] === 0) {
      if (
        prevNew.data[o] !== next.data[o] ||
        prevNew.data[o + 1] !== next.data[o + 1] ||
        prevNew.data[o + 2] !== next.data[o + 2] ||
        prevNew.data[o + 3] !== next.data[o + 3]
      ) {
        outside += 1;
      }
    } else {
      if (strictDiffers(prevNew.data, current.data, o)) before += 1;
      if (strictDiffers(next.data, current.data, o)) after += 1;
    }
  }
  const reasons = [];
  if (outside > 0) reasons.push(`${outside} pixels changed outside the declared regions`);
  if (after > before) {
    reasons.push(`inside the regions, pixels differing from current grew: ${before} -> ${after}`);
  }
  return {
    pass: reasons.length === 0,
    outside_identical: outside === 0,
    outside_diff_pixels: outside,
    inside_diff_before: before,
    inside_diff_after: after,
    regions: clamped,
    reasons,
  };
}

/**
 * ファイルの sha256（16 進）。
 * @param {string} path
 * @returns {string}
 */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * 既存の記録へ組を追記する。同じ pair id の組は置き換える（順序は既存の位置を保ち、新しい組は末尾）。
 * @param {{ pairs?: Array<{ pair:string }> } | null} existing
 * @param {Array<{ pair:string }>} entries
 * @param {string | undefined} changeId
 * @returns {object}
 */
export function mergeRecord(existing, entries, changeId) {
  const pairs = Array.isArray(existing?.pairs) ? [...existing.pairs] : [];
  for (const entry of entries) {
    const at = pairs.findIndex((p) => p && p.pair === entry.pair);
    if (at === -1) pairs.push(entry);
    else pairs[at] = entry;
  }
  const record = { tool: "amend-verify", version: VERSION };
  const id = changeId ?? existing?.change_id;
  if (id !== undefined) record.change_id = id;
  record.pairs = pairs;
  return record;
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

const USAGE =
  "usage: node amend-verify.mjs --pair <id> --prev-new <png> --new <png> --current <png>" +
  " --region x,y,w,h [--region ...] [--margin <px>] [--change-id <id>] [--out <record.json>]\n" +
  "   or: node amend-verify.mjs --pairs <pairs.json> [--margin <px>] [--change-id <id>] [--out <record.json>]\n" +
  "  pairs.json: [{ pair, prev_new, new, current, regions: [[x,y,w,h] | {x,y,width,height}], margin? }]\n" +
  "  paths are resolved from the working directory and recorded as given\n";

/**
 * 引数を組の指定に直す。誤りは文字列で返す。
 * @param {string[]} argv
 * @returns {{ error: string } | { specs: Array<{ pair:string, prev_new:string, new:string, current:string,
 *   regions: Rect[], margin:number }>, changeId?: string, out?: string }}
 */
export function parseArgs(argv) {
  const single = { regions: [] };
  let pairsPath;
  let margin = 0;
  let marginGiven = false;
  let changeId;
  let out;
  const valueOf = (i) => {
    const v = argv[i + 1];
    return v === undefined || v.trim() === "" || v.startsWith("--") ? undefined : v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = valueOf(i);
    const known = [
      "--pair",
      "--prev-new",
      "--new",
      "--current",
      "--region",
      "--margin",
      "--pairs",
      "--change-id",
      "--out",
    ];
    if (!known.includes(flag)) return { error: `unknown argument: ${flag}` };
    if (value === undefined) return { error: `${flag} requires a value` };
    i += 1;
    if (flag === "--pair") single.pair = value;
    else if (flag === "--prev-new") single.prev_new = value;
    else if (flag === "--new") single.new = value;
    else if (flag === "--current") single.current = value;
    else if (flag === "--region") {
      const r = parseRegion(value);
      if (!r) return { error: `--region must be x,y,w,h with w,h > 0: ${value}` };
      single.regions.push(r);
    } else if (flag === "--margin") {
      margin = Number(value);
      marginGiven = true;
      if (!Number.isFinite(margin) || margin < 0) {
        return { error: `--margin must be a non-negative number: ${value}` };
      }
    } else if (flag === "--pairs") pairsPath = value;
    else if (flag === "--change-id") changeId = value;
    else if (flag === "--out") out = value;
  }
  const singleGiven =
    single.pair !== undefined ||
    single.prev_new !== undefined ||
    single.new !== undefined ||
    single.current !== undefined ||
    single.regions.length > 0;
  if (pairsPath !== undefined && singleGiven) {
    return { error: "--pairs cannot be combined with --pair/--prev-new/--new/--current/--region" };
  }
  if (pairsPath === undefined) {
    for (const key of ["pair", "prev_new", "new", "current"]) {
      if (single[key] === undefined) return { error: `--${key.replace("_", "-")} is required` };
    }
    // 領域が無いと「外」が画像全体になり、変更がどこにも効いていないことになる。宣言の欠落として弾く。
    if (single.regions.length === 0) return { error: "at least one --region is required" };
    return { specs: [{ ...single, margin }], changeId, out };
  }
  let list;
  try {
    list = JSON.parse(readFileSync(pairsPath, "utf8"));
  } catch (err) {
    return { error: `cannot read --pairs: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(list) || list.length === 0) {
    return { error: "--pairs must be a non-empty JSON array" };
  }
  const specs = [];
  const seen = new Set();
  for (const [n, item] of list.entries()) {
    const where = `--pairs[${n}]`;
    if (!item || typeof item !== "object") return { error: `${where} must be an object` };
    for (const key of ["pair", "prev_new", "new", "current"]) {
      if (typeof item[key] !== "string" || item[key].trim() === "") {
        return { error: `${where}.${key} must be a non-empty string` };
      }
    }
    if (seen.has(item.pair)) return { error: `${where}.pair is duplicated: ${item.pair}` };
    seen.add(item.pair);
    if (!Array.isArray(item.regions) || item.regions.length === 0) {
      return { error: `${where}.regions must be a non-empty array` };
    }
    const regions = [];
    for (const raw of item.regions) {
      const r = regionFromJson(raw);
      if (!r) return { error: `${where}.regions has an unreadable region: ${JSON.stringify(raw)}` };
      regions.push(r);
    }
    let m = margin;
    if (item.margin !== undefined) {
      if (typeof item.margin !== "number" || !Number.isFinite(item.margin) || item.margin < 0) {
        return { error: `${where}.margin must be a non-negative number` };
      }
      // 組ごとの margin と --margin が食い違うなら、どちらを使ったか曖昧になるので弾く。
      if (marginGiven && item.margin !== margin) {
        return { error: `${where}.margin (${item.margin}) conflicts with --margin (${margin})` };
      }
      m = item.margin;
    }
    specs.push({
      pair: item.pair,
      prev_new: item.prev_new,
      new: item.new,
      current: item.current,
      regions,
      margin: m,
    });
  }
  return { specs, changeId, out };
}

/**
 * CLI エントリ。exit 0 = 全組 pass / 1 = fail の組あり / 2 = 入力不備（pngjs が無い場合を含む）。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`error: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { specs, changeId, out } = parsed;
  let existing = null;
  if (out !== undefined && existsSync(out)) {
    try {
      existing = JSON.parse(readFileSync(out, "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: cannot read existing --out record: ${message}\n`);
      return 2;
    }
    if (!existing || typeof existing !== "object" || !Array.isArray(existing.pairs)) {
      process.stderr.write("error: existing --out record has no pairs array\n");
      return 2;
    }
    // 別の変更宣言の記録へ混ぜない（どの変更で持ち越したかが読めなくなる）。
    if (
      changeId !== undefined &&
      existing.change_id !== undefined &&
      existing.change_id !== changeId
    ) {
      process.stderr.write(
        `error: --change-id ${changeId} differs from the existing record's change_id ${existing.change_id}\n`,
      );
      return 2;
    }
  }
  const PNG = await loadPng();
  if (!PNG) {
    process.stderr.write(
      "error: pngjs is not installed. install it in the project or confirm with the user before proceeding\n",
    );
    return 2;
  }
  const entries = [];
  for (const spec of specs) {
    const images = {};
    const inputs = {};
    try {
      for (const key of ["prev_new", "new", "current"]) {
        const buf = readFileSync(spec[key]);
        images[key] = PNG.sync.read(buf);
        inputs[key] = {
          path: spec[key],
          sha256: createHash("sha256").update(buf).digest("hex"),
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: cannot read PNG inputs of pair ${spec.pair}: ${message}\n`);
      return 2;
    }
    const judged = judgePair({
      prevNew: images.prev_new,
      next: images.new,
      current: images.current,
      regions: spec.regions,
      margin: spec.margin,
    });
    entries.push({
      pair: spec.pair,
      pass: judged.pass,
      outside_identical: judged.outside_identical,
      outside_diff_pixels: judged.outside_diff_pixels,
      inside_diff_before: judged.inside_diff_before,
      inside_diff_after: judged.inside_diff_after,
      margin: spec.margin,
      declared_regions: spec.regions,
      regions: judged.regions,
      inputs,
      reasons: judged.reasons,
    });
  }
  const record = mergeRecord(existing, entries, changeId);
  const text = JSON.stringify(record, null, 2) + "\n";
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    for (const e of entries) {
      process.stdout.write(
        `${e.pass ? "pass" : "FAIL"} ${e.pair}${e.reasons.length ? `: ${e.reasons.join("; ")}` : ""}\n`,
      );
    }
  } else {
    process.stdout.write(text);
  }
  return entries.every((e) => e.pass) ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動で
// 条件が偽になり、何も出力せず exit 0 になるのを避ける）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  // process.exit は書き込み中の stdout を捨てる（パイプが非同期のプラットフォームで --out なしの記録が欠ける）ため、
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
