// 入力の型を保って配列に絞る型ガード。`Array.isArray` の代わりに使う（`oxlint.config.ts` が直接の呼び出しを失敗にする）。
// 印の間は、利用者のプロジェクトへコピーする雛形（`skills/*/assets/*.template.ts`）も同じ内容で持つ。
// 配布スキルの `.mjs` は、同じ型を JSDoc で書いた `scripts/lib/is-array.mjs` を各スキルに持つ。
// どちらの一致も `scripts/gates/identical-copies.json` の組で確かめる。

// is-array:begin
// `Array.isArray` は `arg is any[]` なので、`unknown` の値を絞ると `any[]` になり、要素を読む処理で型の検査が外れる。
// `isArray` は、入力が `unknown` か `any` なら `unknown[]` に絞る。入力の union の配列の部分（`number[] | undefined` の
// `number[]`、`readonly` の配列、タプル）はそのまま保ち、配列でない側は入力から配列の部分を除いた型にする。
// 配列を含みうる型（`object`・`{}`・`Iterable<string>`）は、その型と `unknown[]` の交差にする。

/** `T` のうち配列の部分。`unknown` と `any` は `unknown[]`、配列を含みうる型は `unknown[]` との交差にする。 */
type ArrayPart<T> = 0 extends 1 & T
  ? unknown[]
  : unknown extends T
    ? unknown[]
    : T extends readonly unknown[]
      ? T
      : never[] extends T
        ? T & unknown[]
        : never;

/**
 * 型ガードの述語に使う形。述語の型は引数の型に代入できる必要がある（TS2677）。条件型のままでは
 * tsc がそれを確かめられないので、代入できる場合だけ `ArrayPart<T>` にする（具体的な型では常に代入できる）。
 */
type ArrayNarrowed<T> = ArrayPart<T> extends T ? ArrayPart<T> : never;

/** 配列か。配列なら、入力の型の配列の部分に絞る。 */
function isArray<T>(value: T): value is ArrayNarrowed<T> {
  // oxlint-disable-next-line no-restricted-properties -- 組み込みの判定を呼ぶのは、この関数の中だけにする
  return Array.isArray(value);
}
// is-array:end

export type { ArrayNarrowed, ArrayPart };
export { isArray };
