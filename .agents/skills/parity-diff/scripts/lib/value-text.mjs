// 照合のキーにする値を文字列にする。
// 文字列・数値・真偽値・配列は `String(v)` と同じ字面にし、`null` と `undefined` は空文字にする。
// オブジェクトは `String(v)` だと中身に関わらず `[object Object]` になり、別の値どうしが一致するので、JSON にする。
import { isArray } from "./is-array.mjs";

/**
 * @param {unknown} v
 * @returns {string}
 */
export function valueText(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (isArray(v)) return v.map(valueText).join(",");
  return JSON.stringify(v) ?? "";
}
