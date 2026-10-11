// 外部の JSON を、使う形の型で受けるための helper。型の表明は、このファイルだけに置く。
// `JSON.parse` の戻り値は `types/strict-json.ts` で `unknown` にしてある。形を確かめずに型を付ける位置をこの関数に集め、
// 呼び出し側から分かるようにする。形は検証しない。
// 受け取った後に形を検証するコードでは使わない（検証が抜けても tsc が警告しない）。`unknown` で受けて型ガードで絞る。
// 組み込みのモジュールだけで書く。JSON だけを読むスクリプトに、依存のパッケージ（js-yaml など）を読み込ませないため。
// YAML は `yaml-as.ts` の `loadYamlAs` を使う。

/** JSON の文字列を、`T` の形として読む（形は検証しない）。 */
export function parseJsonAs<T>(text: string): T {
  const value: unknown = JSON.parse(text);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 外部の入力の形を宣言する。検証は呼び出し側が行う
  return value as T;
}
