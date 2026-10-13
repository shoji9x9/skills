// 意図的差異レジストリ（registries.json の keep・may_change・pending）の要素を読む helper。
// diff-normalize.mjs と pending-triage-check.mjs が、同じ規則で照合のキーを取り出す。

import { isPlainObject } from "./guards.mjs";

/**
 * 意図的差異レジストリの 1 要素から照合に使う散文テキストを取り出す。
 *
 * `pending` は追記元（slug / added_by / added_at）を持つオブジェクト形式で書かれるため、
 * 照合のキーは `item` である（要素の形は replace-strategy の
 * references/project-config.md「`pending` 要素の形」で定義する）。ただの文字列の要素も読む（旧形式）。
 * `item` が文字列でないオブジェクトは照合に使わない。`[object Object]` を
 * needle にすると、意図しない一致や不一致が含まれる。
 *
 * @param {unknown} entry
 * @returns {string} 照合に使うテキスト（取り出せなければ空文字列）
 */
function intentionalEntryText(entry) {
  if (typeof entry === "string") return entry;
  if (isPlainObject(entry)) {
    const item = entry.item;
    return typeof item === "string" ? item : "";
  }
  return "";
}

export { intentionalEntryText };
