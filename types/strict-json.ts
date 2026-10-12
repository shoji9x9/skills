// `JSON.parse` と `Response.json()` の戻り値を、`any` ではなく `unknown` にする（ts-reset と同じ方法）。
// `any` を経由すると、型の注釈も型の表明も無いまま検査が外れる。`unknown` にすると、型を絞らずに欄を読めば `tsc` が失敗する。
// 受ける側は、形を確かめるなら型ガードで絞り、確かめないなら `scripts/lib/parse-as.ts` の `parseJsonAs<T>` で受ける。
// 宣言をあとから足したインターフェースの overload が先に選ばれるので、組み込みの `any` を返す overload より優先される。
// `export {}` でモジュールにし、`declare global` で大域の型に足す（`tsconfig.repo.json` の nodenext では、
// `package.json` の `type: module` により `.ts` は常にモジュールとして読まれる）。
export {};

declare global {
  interface JSON {
    parse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown;
  }

  // DOM の `Response`（配布スキルの型の検査で読む）。Node の `Response`（undici）は、元から `Promise<unknown>` を返す。
  interface Body {
    json(): Promise<unknown>;
  }
}
