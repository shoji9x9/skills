// このスキルの .mjs が共通に使う型ガード。
// 同じ helper を各ファイルが別々に持つと、同じ名前で中身が食い違っても気付けないので、ここに 1 つだけ置く。

import { isArray } from "./is-array.mjs";

/**
 * プレーンなオブジェクト（null と配列を除く）か。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !isArray(value);
}

/**
 * 空でない文字列か（空白だけの文字列は空として扱う）。
 * @param {unknown} value
 * @returns {value is string}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export { isPlainObject, nonEmptyString };
