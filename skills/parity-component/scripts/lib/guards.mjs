// このスキルの .mjs が共通に使う型ガードと、JSON 由来の値を読む helper。
// 同じ helper を各ファイルが別々に持つと、同じ名前で中身が食い違っても気付けないので、ここに 1 つだけ置く。
// isPlainObject と nonEmptyString は、印の間を他のスキルの lib/guards.mjs と一致させる（identical-copies の組で確かめる）。
// 利用者のプロジェクトへ 1 ファイルだけコピーして使うスクリプト（`motion-probe.mjs`）は import できないので、ここを使わない。

import { isArray } from "./is-array.mjs";

// non-empty-string-js:begin
/**
 * 空でない文字列か（空白だけの文字列は空として扱う）。
 * @param {unknown} v
 * @returns {v is string}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
// non-empty-string-js:end

/**
 * 同梱テンプレートのプレースホルダ（`<...>` の形）か。テンプレートは利用者がそのまま提出しうる入力なので、
 * 空でないだけの値を「記入済み」と読むと、テンプレートからコピーしただけの承認・理由・識別子が判定を通る。
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
  return typeof value === "string" && /^<[\s\S]*>$/.test(value.trim());
}

/**
 * 人が記入すべき欄が記入済みか（空でなく、テンプレートのプレースホルダのままでもない）。
 * @param {unknown} value
 * @returns {value is string}
 */
function filled(value) {
  return nonEmptyString(value) && !isPlaceholder(value);
}

/**
 * 有限の数か（Number.isFinite は数でない値に false を返すので、typeof は型を絞るためだけにある）。
 * @param {unknown} v
 * @returns {v is number}
 */
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// is-plain-object-js:begin
/**
 * JSON オブジェクト（null と配列を除く）か。配列は typeof で "object" を通るため明示的に弾く。
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !isArray(v);
}
// is-plain-object-js:end

/**
 * null でないオブジェクト（配列を含む）か。JSON 由来の値の欄を読む前の絞り込みに使う。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

/**
 * `value && value[key]` と同じ値を返す（オブジェクトなら欄の値、偽の値ならその値、それ以外は undefined）。
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  if (isObjectLike(value)) return value[key];
  return value && undefined;
}

/**
 * パスの 1 セグメントとして安全か（`../` で baseline の外を読ませない）。
 * @param {unknown} value
 * @returns {value is string}
 */
function safeSegment(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    !/[/\\\0]/.test(value)
  );
}

export { field, filled, isFiniteNumber, isObjectLike, isPlainObject, nonEmptyString, safeSegment };
