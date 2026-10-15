// 外部の YAML を、使う形の型で受けるための helper。型の表明は、このファイルだけに置く。
// js-yaml の読み込みは `unknown` を返す。使う形の型で受けるには表明が要るので、その位置をこの関数に集める。形は検証しない。
// js-yaml を読み込むので、JSON だけを読むスクリプトは `parse-as.ts` の `parseJsonAs` を使う。
//
// js-yaml 5 は、デフォルトのスキーマを CORE_SCHEMA（merge key と YAML 1.1 のタグを持たない）に変え、
// 空の入力で `load` が例外を投げるようになった。このリポジトリの YAML の読み方は js-yaml 4 のデフォルトに揃える。
// - スキーマ: CORE_SCHEMA に、4 のデフォルトが持っていた merge key・timestamp・binary・omap・pairs・set を足す。
//   YAML11_SCHEMA は使わない。`on`・`yes` を真偽値に読み、GitHub Actions のワークフローの `on:` のキーを変えてしまう。
// - 空の入力（空文字・コメントだけ）は `undefined` を返し、複数の文書は例外にする（4 の `load` と同じ）。
import {
  binaryTag,
  CORE_SCHEMA,
  loadAll,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
} from "js-yaml";

/** このリポジトリで YAML を読むスキーマ（js-yaml 4 のデフォルトと同じ範囲）。 */
export const YAML_SCHEMA = CORE_SCHEMA.withTags(
  mergeTag,
  timestampTag,
  binaryTag,
  omapTag,
  pairsTag,
  setTag,
);

/** すべての文書を読む。空の入力は空の配列になる。 */
export function loadYamlDocuments(text: string): unknown[] {
  return loadAll(text, { schema: YAML_SCHEMA });
}

/** 1 つの文書を読む。空の入力は `undefined` を返し、複数の文書は例外にする。 */
export function loadYaml(text: string): unknown {
  const docs = loadYamlDocuments(text);
  if (docs.length > 1) {
    throw new Error(`expected a single document in the stream, but found ${docs.length}`);
  }
  return docs[0];
}

/** YAML の文字列を、`T` の形として読む（形は検証しない）。 */
export function loadYamlAs<T>(text: string): T {
  const value = loadYaml(text);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 外部の入力の形を宣言する。検証は呼び出し側が行う
  return value as T;
}
