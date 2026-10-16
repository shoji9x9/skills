// このスキルの .mjs が共通に使う型ガード。
// 同じ helper を各ファイルが別々に持つと、同じ名前で中身が食い違っても気付けないので、ここに 1 つだけ置く。
// 利用者のプロジェクトへ 1 ファイルだけコピーして使うスクリプト（`trait-compare.mjs`・`header-normalize.mjs` など）は
// import できないので、同じ関数をファイルの中に持つ。印（`// <名前>-js:begin`〜`// <名前>-js:end`）の間は、
// identical-copies の組で、ここと一致することを確かめる。

import { isArray } from "./is-array.mjs";

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
 * null でないオブジェクト（配列を含む）か。プロパティを読む前の型の絞り込みに使う。
 * 配列を除く isPlainObject とは別の名前にする。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}

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
 * 有限の数か（Number.isFinite は数でない値に false を返すので、typeof は型を絞るためだけにある）。
 * @param {unknown} v
 * @returns {v is number}
 */
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 正の有限数か（寸法の実測値はここを通す）。
 * @param {unknown} value
 * @returns {value is number}
 */
function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 0 以上の有限数か（0 が正規の値になる実測値はここを通す）。
 * @param {unknown} value
 * @returns {value is number}
 */
function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 整数か（`Number.isInteger` を、型を絞れる形にしたもの）。
 * @param {unknown} value
 * @returns {value is number}
 */
function isInteger(value) {
  return Number.isInteger(value);
}

/**
 * 反復回数を整数として読む。読めなければ null（「記録が無い」と「0 回」を混ぜない）。
 * **数字列は受けない**。同じ `loop.iterations` を artifact-health-check.mjs と component-comparison-check.mjs が読むので、
 * 片方だけ緩めると 2 つのチェックが同じ記録に矛盾した判定を出す。原本のテンプレートも数値。
 * @param {unknown} value
 * @returns {number | null}
 */
function toIterationCount(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * 同梱テンプレートの説明文（`<...>` で囲んだプレースホルダ）のままの値か。前後の空白は無視する。
 * 空でない文字列というだけで「書いた」と数えると、テンプレートをコピーしただけの記録が通る。
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
  return typeof value === "string" && /^<[\s\S]*>$/.test(value.trim());
}

export {
  isFiniteNumber,
  isInteger,
  isObjectLike,
  isPlaceholder,
  isPlainObject,
  nonEmptyString,
  nonNegativeNumber,
  positiveNumber,
  toIterationCount,
};
