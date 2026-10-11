// 外部の JSON を、使う形の型で受けるための helper。型の表明は、このファイルだけに置く。
// `JSON.parse` は `any` を返すので、`const x: T = JSON.parse(text)` と書くと、型の表明なしに検査が外れる。
// 外れる位置をこの関数に集め、呼び出し側から分かるようにする。形は検証しない。
// 形を確かめる必要があるなら、呼び出し側で型ガードか expect で確かめる。
// 組み込みのモジュールだけで書く。JSON だけを読むスクリプトに、依存のパッケージ（js-yaml など）を読み込ませないため。
// YAML は `yaml-as.ts` の `loadYamlAs` を使う。

/** JSON の文字列を、`T` の形として読む（形は検証しない）。 */
export function parseJsonAs<T>(text: string): T {
  const value: unknown = JSON.parse(text);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 外部の入力の形を宣言する。検証は呼び出し側が行う
  return value as T;
}
