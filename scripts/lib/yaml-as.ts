// 外部の YAML を、使う形の型で受けるための helper。型の表明は、このファイルだけに置く。
// js-yaml の読み込みは `unknown` を返す。使う形の型で受けるには表明が要るので、その位置をこの関数に集める。形は検証しない。
// js-yaml を読み込むので、JSON だけを読むスクリプトは `parse-as.ts` の `parseJsonAs` を使う。
//
// js-yaml 5 は、デフォルトのスキーマを CORE_SCHEMA（merge key と YAML 1.1 のタグを持たない）に変え、
// 空の入力で `load` が例外を投げるようになった。このリポジトリの YAML の読み方は、js-yaml 4 のデフォルトに近づける。
// - スキーマ: CORE_SCHEMA に、4 のデフォルトが持っていた merge key・timestamp・binary・omap・pairs・set と、
//   複合キー（`? [1, 2]`）を文字列のキーにする legacyMapTag を足す。4 と読める YAML の範囲をできるだけ揃えるためである。
//   YAML11_SCHEMA は使わない。`on`・`yes` を真偽値に読み、GitHub Actions のワークフローの `on:` のキーを変えてしまう。
// - 空の入力（空文字・コメントだけ）は `undefined` を返し、複数の文書は例外にする（4 の `load` と同じ）。
// 4 と値が違うまま残る形: `!!set` は JavaScript の `Set` になり（4 はオブジェクト）、`0b11` は文字列になる（4 は数値）。
// どちらも読めることは変わらないので、lint-yaml の判定には影響しない。
// 次の形は、4 と読めるかどうかが違う。パーサの変更なので、スキーマでは揃えられない。
// - キーの無い暗黙のマッピング（`: value`）と `!!null ""` は、4 では例外だが、5 は読む。lint-yaml はこの形を検出しない。
// - フロー形式（`[...]`・`{...}`）や引用符付きの文字列の続きの行が、親のブロックより深く字下げされていない形
//   （`a: [1,\n2]` など）は、4 では読めるが、5 は deficient indentation で例外にする。lint-yaml はこの形を不正と判定する。
import {
  binaryTag,
  CORE_SCHEMA,
  legacyMapTag,
  loadAll,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
} from "js-yaml";

/** このリポジトリで YAML を読むスキーマ（js-yaml 4 のデフォルトが読める YAML の範囲）。 */
export const YAML_SCHEMA = CORE_SCHEMA.withTags(
  legacyMapTag,
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
