// 外部の YAML を、使う形の型で受けるための helper。型の表明は、このファイルだけに置く。
// js-yaml の `load` は `unknown` を返す。使う形の型で受けるには表明が要るので、その位置をこの関数に集める。形は検証しない。
// js-yaml を読み込むので、JSON だけを読むスクリプトは `parse-as.ts` の `parseJsonAs` を使う。
import { load } from "js-yaml";

/** YAML の文字列を、`T` の形として読む（形は検証しない）。 */
export function loadYamlAs<T>(text: string): T {
  const value: unknown = load(text);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 外部の入力の形を宣言する。検証は呼び出し側が行う
  return value as T;
}
