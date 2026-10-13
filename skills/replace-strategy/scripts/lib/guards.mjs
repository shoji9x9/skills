// このスキルの .mjs が共通に使う型ガード。
// 同じ helper を各ファイルが別々に持つと、同じ名前で中身が食い違っても気付けないので、ここに 1 つだけ置く。
// isPlainObject は、印の間を他のスキルの lib/guards.mjs と一致させる（identical-copies の組で確かめる）。

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
 * 空でない文字列か（空白だけの文字列は空として扱う）。
 * @param {unknown} value
 * @returns {value is string}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export { isPlainObject, nonEmptyString };
