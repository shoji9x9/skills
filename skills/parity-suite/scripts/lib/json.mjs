// JSON 由来の値を扱う helper。

import { isPlainObject } from "./guards.mjs";
import { isArray } from "./is-array.mjs";

/**
 * オブジェクトのキーを再帰的に昇順へ正規化した複製を返す（指紋やソートキーの生成用）。
 * `Object.fromEntries` で組むので、`__proto__` というキーも自分の欄として残る
 * （`out[key] = ...` で組むと、プロトタイプの設定として扱われ、そのキーが消える）。
 * @param {unknown} v
 * @returns {unknown}
 */
function canonicalize(v) {
  if (isArray(v)) return v.map(canonicalize);
  if (isPlainObject(v)) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonicalize(v[k])]),
    );
  }
  return v;
}

export { canonicalize };
