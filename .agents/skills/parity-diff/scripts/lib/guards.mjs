// このスキルの .mjs が共通に使う型ガード。
// 同じ helper を各ファイルが別々に持つと、同じ名前で中身が食い違っても気付けないので、ここに 1 つだけ置く。

import { isArray } from "./is-array.mjs";

/**
 * プレーンオブジェクトか（配列・null を除く）。
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !isArray(v);
}

/**
 * 空でない文字列か（空白だけの文字列は空として扱う）。
 * @param {unknown} v
 * @returns {v is string}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

export { isPlainObject, nonEmptyString };
