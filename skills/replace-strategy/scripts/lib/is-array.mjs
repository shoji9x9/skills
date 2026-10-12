// 入力の型を保って配列に絞る型ガード。`Array.isArray` の代わりに使う。
// 組み込みの `Array.isArray` は `arg is any[]` なので、`unknown` の値を絞ると `any[]` になり、要素を読む処理で型の検査が外れる。
// ここでは、入力が `unknown` か `any` なら `unknown[]` に絞り、型を付けずに要素の欄を読めば型の検査が失敗するようにする。
// 入力の union の配列の部分（`number[] | undefined` の `number[]`、`readonly` の配列、タプル）はそのまま保ち、
// 配列でない側は入力から配列の部分を除いた型にする。配列を含みうる型（`object`・`{}`・`Iterable<string>`）は、
// その型と `unknown[]` の交差にする。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。

/**
 * `T` のうち配列の部分。`unknown` と `any` は `unknown[]`、配列を含みうる型は `unknown[]` との交差にする。
 * @template T
 * @typedef {0 extends 1 & T ? unknown[] : unknown extends T ? unknown[] : T extends readonly unknown[] ? T : never[] extends T ? T & unknown[] : never} ArrayPart
 */

/**
 * 型ガードの述語に使う形。述語の型は引数の型に代入できる必要があるので、代入できる場合だけ `ArrayPart<T>` にする。
 * @template T
 * @typedef {ArrayPart<T> extends T ? ArrayPart<T> : never} ArrayNarrowed
 */

/**
 * 配列か。配列なら、入力の型の配列の部分に絞る。
 * @template T
 * @param {T} value
 * @returns {value is ArrayNarrowed<T>}
 */
export function isArray(value) {
  // oxlint-disable-next-line no-restricted-properties -- 組み込みの判定を呼ぶのは、この関数の中だけにする
  return Array.isArray(value);
}
