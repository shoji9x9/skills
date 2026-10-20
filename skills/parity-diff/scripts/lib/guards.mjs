// このスキルの .mjs が共通に使う型ガード。
// 同じ helper を各ファイルが別々に持つと、同じ名前で中身が食い違っても気付けないので、ここに 1 つだけ置く。
// isPlainObject は lib/json.mjs の canonicalize（parity-suite と同じ指紋を作る）が使うので、印の間を parity-suite の lib/guards.mjs と一致させる。
// nonEmptyString も、同じ名前の型ガードの意味がスキル間でずれないように、印の間を他のスキルと一致させる。

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
 * 配列の名前付きの欄は読むと undefined なので、Record として読んでよい。配列を除く isPlainObject とは別の名前にする。
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObjectLike(v) {
  return typeof v === "object" && v !== null;
}

// non-empty-string-js:begin
/**
 * 空でない文字列か（空白だけの文字列は空として扱う）。
 * @param {unknown} v
 * @returns {v is string & { readonly __nonEmptyString: true }}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
// non-empty-string-js:end

export { isObjectLike, isPlainObject, nonEmptyString };
