// 共通部品を改修した後に撮り直した新側の画像を、機械で判定する（原本）。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する（プロジェクトへコピーしない）。
//
// 何のためか: 部品の改修（変更宣言。parity-component の component-change.json）が影響する組を撮り直したとき、
// 変更の中身は分かっているのに、撮り直しの結果をページごとに検出 → トリアージ → 承認で分類し直すことになる。
// 変更が宣言どおりなら次の 2 つが成り立つので、それを画素で確かめて分類のやり直しを省く。
//   1) 影響インスタンスの矩形（margin だけ広げた領域）の**外**は、改修前の新側と画素がすべて一致する
//   2) 領域の**中**は、現行との不一致画素が改修前より増えていない
// どちらかが成り立たない組だけを、従来のトリアージへ回す。
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { isPlainObject } from "./lib/guards.mjs";
import { loadPng } from "./lib/png.mjs";

/**
 * ツールのバージョン（原本）。判定の規則や記録の形を変えたら上げる。
 *
 * @type {string}
 */
export const VERSION = "1";

/** @typedef {{ width:number, height:number, data:Uint8Array }} Image */
/** @typedef {{ x:number, y:number, width:number, height:number }} Rect */

/**
 * `x,y,w,h` を矩形にする。数でない・幅か高さが 0 以下なら null（空の領域は「変更が反映された場所」を示さない）。
 *
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
 *
 * @param {unknown} value
 * @returns {Rect | null}
 */
export function regionFromJson(value) {
  if (isArray(value)) return parseRegion(value.join(","));
  // 配列の表記は直前で扱ったので、ここでは `{x,y,width,height}` の表記を読む。
  if (isPlainObject(value)) {
    const r = value;
    if ([r.x, r.y, r.width, r.height].some((v) => typeof v !== "number")) return null;
    return parseRegion(`${String(r.x)},${String(r.y)},${String(r.width)},${String(r.height)}`);
  }
  return null;
}

/**
 * 矩形を margin だけ広げ、画像の範囲に切り詰めて整数の画素矩形にする。
 * 小数の rect（getBoundingClientRect 由来）は外側へ丸める（掛かっている画素を領域から落とさない）。
 * 画像と重ならなければ null。
 *
 * @param {Rect} rect
 * @param {number} margin
 * @param {{ width:number, height:number }} image - 画像の寸法
 * @returns {Rect | null}
 */
export function expandRegion(rect, margin, { width: imageWidth, height: imageHeight }) {
  const left = Math.max(0, Math.floor(rect.x - margin));
  const top = Math.max(0, Math.floor(rect.y - margin));
  const right = Math.min(imageWidth, Math.ceil(rect.x + rect.width + margin));
  const bottom = Math.min(imageHeight, Math.ceil(rect.y + rect.height + margin));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 領域の和集合のマスク（1 = 領域の中）を作る。
 *
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
 *
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
 * 判定できなかった組の結果。
 *
 * @param {string} reason
 * @param {Rect[]} [clamped]
 */
function failedJudgement(reason, clamped = []) {
  return {
    pass: false,
    outside_identical: false,
    outside_diff_pixels: null,
    inside_diff_before: null,
    inside_diff_after: null,
    regions: clamped,
    reasons: [reason],
  };
}

/**
 * 領域の外で prev-new と new が違う画素と、領域の中で現行と違う画素（改修の前と後）を数える。
 *
 * @param {{ prevNew: Image, next: Image, current: Image, mask: Uint8Array }} input
 * @returns {{ outside:number, before:number, after:number }}
 */
function countRegionDiffs({ prevNew, next, current, mask }) {
  let outside = 0;
  let before = 0;
  let after = 0;
  for (let i = 0; i < mask.length; i += 1) {
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
  return { outside, before, after };
}

/**
 * 1 組を判定する（純関数。デコード済みの RGBA を受ける）。
 * - prev-new と new の寸法が違う → fail（改修で配置が動いた。外の一致を画素で示せない）
 * - current の寸法が new と違う → fail（現行との不一致を同じ座標で数えられない）
 * - 領域が 1 つも画像と重ならない → fail（宣言したインスタンスが画面に無い）
 * - pass = 領域の外がバイト単位で一致し、かつ領域の中の現行との不一致が増えていない
 *
 * @param {{ prevNew: Image, next: Image, current: Image, regions: Rect[], margin?: number }} input
 * @returns {{ pass:boolean, outside_identical:boolean, outside_diff_pixels:(number|null),
 *             inside_diff_before:(number|null), inside_diff_after:(number|null),
 *             regions: Rect[], reasons: string[] }}
 */
export function judgePair({ prevNew, next, current, regions, margin = 0 }) {
  if (prevNew.width !== next.width || prevNew.height !== next.height) {
    return failedJudgement(
      `dimensions changed: prev-new ${prevNew.width}x${prevNew.height} vs new ${next.width}x${next.height}`,
    );
  }
  if (current.width !== next.width || current.height !== next.height) {
    return failedJudgement(
      `current dimensions differ from new: ${current.width}x${current.height} vs ${next.width}x${next.height}`,
    );
  }
  const { width, height } = next;
  const clamped = [];
  for (const r of regions) {
    const e = expandRegion(r, margin, { width, height });
    if (e) clamped.push(e);
  }
  if (clamped.length === 0) {
    return failedJudgement(
      "no region overlaps the image (declared instances are not on this capture)",
    );
  }
  const mask = buildRegionMask(clamped, width, height);
  const { outside, before, after } = countRegionDiffs({ prevNew, next, current, mask });
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
 *
 * @param {string} path
 * @returns {string}
 */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * 既存の記録へ組を追記する。同じ pair id の組は置き換える（順序は既存の位置を保ち、新しい組は末尾）。
 *
 * 既存の記録の欄（pairs の要素・change_id）は読んだまま保つので、型は unknown のままにする。
 *
 * @template {{ pair:string }} T - 組の記録（pair 以外の欄はそのまま保つ）
 * @param {{ pairs?: unknown, change_id?: unknown } | null} existing
 * @param {T[]} entries
 * @param {string | undefined} changeId
 * @returns {{ tool:string, version:string, change_id?:unknown, pairs:unknown[] }}
 */
export function mergeRecord(existing, entries, changeId) {
  /** @type {unknown[]} */
  const pairs = isArray(existing?.pairs) ? [...existing.pairs] : [];
  for (const entry of entries) {
    const at = pairs.findIndex((p) => isPlainObject(p) && p.pair === entry.pair);
    if (at === -1) pairs.push(entry);
    else pairs[at] = entry;
  }
  const id = changeId ?? existing?.change_id;
  // 欄の順（tool, version, change_id, pairs）を保って組み立てる。
  if (id !== undefined) return { tool: "amend-verify", version: VERSION, change_id: id, pairs };
  return { tool: "amend-verify", version: VERSION, pairs };
}

const USAGE =
  "usage: node amend-verify.mjs --pair <id> --prev-new <png> --new <png> --current <png>" +
  " --region x,y,w,h [--region ...] [--margin <px>] [--change-id <id>] [--out <record.json>]\n" +
  "   or: node amend-verify.mjs --pairs <pairs.json> [--margin <px>] [--change-id <id>] [--out <record.json>]\n" +
  "  pairs.json: [{ pair, prev_new, new, current, regions: [[x,y,w,h] | {x,y,width,height}], margin? }]\n" +
  "  paths are resolved from the working directory and recorded as given\n";

/** @typedef {{ pair:string, prev_new:string, new:string, current:string, regions: Rect[], margin:number }} PairSpec */
/**
 * @typedef {{ single: { pair?:string, prev_new?:string, new?:string, current?:string, regions: Rect[] },
 *   pairsPath?: string, margin: number, marginGiven: boolean, changeId?: string, out?: string }} Flags
 */

/**
 * フラグ名から、そのフラグの値を flags へ入れる処理への対応。誤りは文字列で返す。
 * 未知のフラグの判定も、この対応のキーで行う（フラグの一覧をここだけで持つ）。
 * @type {ReadonlyMap<string, (flags: Flags, value: string) => string | undefined>}
 */
const FLAG_SETTERS = new Map([
  ["--pair", (flags, value) => void (flags.single.pair = value)],
  ["--prev-new", (flags, value) => void (flags.single.prev_new = value)],
  ["--new", (flags, value) => void (flags.single.new = value)],
  ["--current", (flags, value) => void (flags.single.current = value)],
  [
    "--region",
    (flags, value) => {
      const r = parseRegion(value);
      if (!r) return `--region must be x,y,w,h with w,h > 0: ${value}`;
      flags.single.regions.push(r);
      return undefined;
    },
  ],
  [
    "--margin",
    (flags, value) => {
      flags.margin = Number(value);
      flags.marginGiven = true;
      if (!Number.isFinite(flags.margin) || flags.margin < 0) {
        return `--margin must be a non-negative number: ${value}`;
      }
      return undefined;
    },
  ],
  ["--pairs", (flags, value) => void (flags.pairsPath = value)],
  ["--change-id", (flags, value) => void (flags.changeId = value)],
  ["--out", (flags, value) => void (flags.out = value)],
]);

/**
 * 引数のフラグを読む。誤りは文字列で返す。
 *
 * @param {string[]} argv
 * @returns {{ error: string } | Flags}
 */
function parseFlags(argv) {
  /** @type {Flags} */
  const flags = { single: { regions: [] }, margin: 0, marginGiven: false };
  /** @param {number} i */
  const valueOf = (i) => {
    const v = argv[i + 1];
    return v === undefined || v.trim() === "" || v.startsWith("--") ? undefined : v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = valueOf(i);
    const setter = FLAG_SETTERS.get(flag);
    if (setter === undefined) return { error: `unknown argument: ${flag}` };
    if (value === undefined) return { error: `${flag} requires a value` };
    i += 1;
    const error = setter(flags, value);
    if (error !== undefined) return { error };
  }
  return flags;
}

/**
 * 単一の組のフラグ（--pair など）を組の指定にする。誤りは文字列で返す。
 *
 * @param {Flags} flags
 * @returns {{ error: string } | { specs: PairSpec[], changeId?: string, out?: string }}
 */
function singleSpec({ single, margin, changeId, out }) {
  // 欠けた欄を pair, prev_new, new, current の順に調べる（型を絞るため 1 欄ずつ書く）。
  const { pair, prev_new, new: next, current, regions } = single;
  if (pair === undefined) return { error: "--pair is required" };
  if (prev_new === undefined) return { error: "--prev-new is required" };
  if (next === undefined) return { error: "--new is required" };
  if (current === undefined) return { error: "--current is required" };
  // 領域が無いと「外」が画像全体になり、変更がどこにも反映されていないことになる。宣言の欠落として弾く。
  if (regions.length === 0) return { error: "at least one --region is required" };
  return { specs: [{ pair, prev_new, new: next, current, regions, margin }], changeId, out };
}

/**
 * --pairs の要素の領域を読む。誤りは文字列で返す。
 *
 * @param {unknown} rawRegions
 * @param {string} where
 * @returns {{ error: string } | { regions: Rect[] }}
 */
function pairRegions(rawRegions, where) {
  if (!isArray(rawRegions) || rawRegions.length === 0) {
    return { error: `${where}.regions must be a non-empty array` };
  }
  const regions = [];
  for (const raw of rawRegions) {
    const r = regionFromJson(raw);
    if (!r) return { error: `${where}.regions has an unreadable region: ${JSON.stringify(raw)}` };
    regions.push(r);
  }
  return { regions };
}

/**
 * --pairs の要素の margin を決める。誤りは文字列で返す。
 *
 * @param {unknown} rawMargin
 * @param {{ where: string, margin: number, marginGiven: boolean }} context
 * @returns {{ error: string } | { margin: number }}
 */
function pairMargin(rawMargin, { where, margin, marginGiven }) {
  if (rawMargin === undefined) return { margin };
  if (typeof rawMargin !== "number" || !Number.isFinite(rawMargin) || rawMargin < 0) {
    return { error: `${where}.margin must be a non-negative number` };
  }
  // 組ごとの margin と --margin が食い違うなら、どちらを使ったか曖昧になるので弾く。
  if (marginGiven && rawMargin !== margin) {
    return { error: `${where}.margin (${rawMargin}) conflicts with --margin (${margin})` };
  }
  return { margin: rawMargin };
}

/**
 * --pairs の 1 要素を組の指定にする。誤りは文字列で返す。
 *
 * @param {unknown} item
 * @param {{ where: string, seen: Set<string>, margin: number, marginGiven: boolean }} context
 * @returns {{ error: string } | { spec: PairSpec }}
 */
function pairSpecFromItem(item, { where, seen, margin, marginGiven }) {
  if (!isPlainObject(item)) return { error: `${where} must be an object` };
  const rec = item;
  /** @type {Record<string, string>} */
  const text = {};
  for (const key of ["pair", "prev_new", "new", "current"]) {
    const v = rec[key];
    if (typeof v !== "string" || v.trim() === "") {
      return { error: `${where}.${key} must be a non-empty string` };
    }
    text[key] = v;
  }
  const { pair, prev_new, new: next, current } = text;
  if (seen.has(pair)) return { error: `${where}.pair is duplicated: ${pair}` };
  seen.add(pair);
  const regions = pairRegions(rec.regions, where);
  if ("error" in regions) return regions;
  const m = pairMargin(rec.margin, { where, margin, marginGiven });
  if ("error" in m) return m;
  return {
    spec: { pair, prev_new, new: next, current, regions: regions.regions, margin: m.margin },
  };
}

/**
 * --pairs のファイルを組の指定にする。誤りは文字列で返す。
 *
 * @param {Flags & { pairsPath: string }} flags
 * @returns {{ error: string } | { specs: PairSpec[], changeId?: string, out?: string }}
 */
function pairsFileSpecs({ pairsPath, margin, marginGiven, changeId, out }) {
  let list;
  try {
    list = JSON.parse(readFileSync(pairsPath, "utf8"));
  } catch (err) {
    return { error: `cannot read --pairs: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isArray(list) || list.length === 0) {
    return { error: "--pairs must be a non-empty JSON array" };
  }
  const specs = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const [n, item] of list.entries()) {
    const read = pairSpecFromItem(item, { where: `--pairs[${n}]`, seen, margin, marginGiven });
    if ("error" in read) return read;
    specs.push(read.spec);
  }
  return { specs, changeId, out };
}

/**
 * 引数を組の指定に直す。誤りは文字列で返す。
 *
 * @param {string[]} argv
 * @returns {{ error: string } | { specs: PairSpec[], changeId?: string, out?: string }}
 */
export function parseArgs(argv) {
  const flags = parseFlags(argv);
  if ("error" in flags) return flags;
  const { single, pairsPath } = flags;
  const singleGiven =
    single.pair !== undefined ||
    single.prev_new !== undefined ||
    single.new !== undefined ||
    single.current !== undefined ||
    single.regions.length > 0;
  if (pairsPath !== undefined && singleGiven) {
    return { error: "--pairs cannot be combined with --pair/--prev-new/--new/--current/--region" };
  }
  if (pairsPath === undefined) return singleSpec(flags);
  return pairsFileSpecs({ ...flags, pairsPath });
}

/**
 * --out の既存の記録を読む。無ければ null。誤りは文字列で返す。
 *
 * @param {string | undefined} out
 * @param {string | undefined} changeId
 * @returns {{ error: string } | { existing: Record<string, unknown> | null }}
 */
function readExistingRecord(out, changeId) {
  if (out === undefined || !existsSync(out)) return { existing: null };
  /** @type {unknown} */
  let read;
  try {
    read = JSON.parse(readFileSync(out, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `cannot read existing --out record: ${message}` };
  }
  // 既存の記録は、pairs の配列を持つ JSON オブジェクトだけを受け付ける（配列と null は弾く）。
  if (!isPlainObject(read) || !isArray(read.pairs)) {
    return { error: "existing --out record has no pairs array" };
  }
  // 別の変更宣言の記録へ混ぜない（どの変更で持ち越したかが読めなくなる）。
  if (changeId !== undefined && read.change_id !== undefined && read.change_id !== changeId) {
    return {
      error: `--change-id ${changeId} differs from the existing record's change_id ${typeof read.change_id === "string" ? read.change_id : JSON.stringify(read.change_id)}`,
    };
  }
  return { existing: read };
}

/**
 * 1 組の画像を読んで判定し、記録の 1 件にする。画像を読めなければ誤りを文字列で返す。
 *
 * @param {PairSpec} spec
 * @param {{ sync: { read: (buf: Buffer) => Image } }} PNG
 */
function verifyPair(spec, PNG) {
  /** @type {Record<string, Image>} */
  const images = {};
  /** @type {Record<string, { path:string, sha256:string }>} */
  const inputs = {};
  try {
    /** @type {Array<"prev_new" | "new" | "current">} */
    const imageKeys = ["prev_new", "new", "current"];
    for (const key of imageKeys) {
      const buf = readFileSync(spec[key]);
      images[key] = PNG.sync.read(buf);
      inputs[key] = {
        path: spec[key],
        sha256: createHash("sha256").update(buf).digest("hex"),
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `cannot read PNG inputs of pair ${spec.pair}: ${message}` };
  }
  const judged = judgePair({
    prevNew: images.prev_new,
    next: images.new,
    current: images.current,
    regions: spec.regions,
    margin: spec.margin,
  });
  return {
    entry: {
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
    },
  };
}

/**
 * 記録を --out へ書き、組ごとの判定を stdout に出す。--out が無ければ記録を stdout に出す。
 *
 * @param {string} text - 記録の JSON
 * @param {{ out?: string, entries: Array<{ pair:string, pass:boolean, reasons:string[] }> }} target
 */
function writeRecord(text, { out, entries }) {
  if (out === undefined) {
    process.stdout.write(text);
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  for (const e of entries) {
    process.stdout.write(
      `${e.pass ? "pass" : "FAIL"} ${e.pair}${e.reasons.length ? `: ${e.reasons.join("; ")}` : ""}\n`,
    );
  }
}

/**
 * CLI エントリ。exit 0 = 全組 pass / 1 = fail の組あり / 2 = 入力不備（pngjs が無い場合を含む）。
 *
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
  const existing = readExistingRecord(out, changeId);
  if ("error" in existing) {
    process.stderr.write(`error: ${existing.error}\n`);
    return 2;
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
    const verified = verifyPair(spec, PNG);
    if ("error" in verified) {
      process.stderr.write(`error: ${verified.error}\n`);
      return 2;
    }
    entries.push(verified.entry);
  }
  const record = mergeRecord(existing.existing, entries, changeId);
  writeRecord(JSON.stringify(record, null, 2) + "\n", { out, entries });
  return entries.every((e) => e.pass) ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
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
