// 一部の値にだけ true を返す型ガード（scripts/lib/guards.ts の isNonEmptyString・isNonBlankString）の、
// false の側の型のテスト。これらの型ガードは、絞る型をブランド型（`string & { readonly __<名前>: true }`）にしている。
// `value is string` と書くと、false の側から string が取り除かれ、実際には来る "" や "  " が型の上で消える。
// 型の期待は `expectTypeOf` で書き、`pnpm run typecheck`（tsc）が確かめる。vitest の実行では値の判定だけを確かめる。
// 配布スキルの lib/guards.mjs の同じテストは、scripts/skills/_cross/guards-brand.test.ts にある。
//
// 状態空間の軸と、各セルに置いた入力は次のとおりである。
//
// | 軸       | 値                                 |
// | -------- | ---------------------------------- |
// | 入力の型 | string \| null                     |
// | 判定の側 | true の側 / false の側             |
// | 実装     | isNonEmptyString・isNonBlankString |
import { expect, expectTypeOf, test } from "vitest";
import { isNonBlankString, isNonEmptyString } from "./guards.ts";

test("値の判定: 空文字と空白だけの文字列に false を返す", () => {
  expect(isNonEmptyString("")).toBe(false);
  expect(isNonEmptyString(" ")).toBe(true);
  expect(isNonBlankString(" ")).toBe(false);
  expect(isNonBlankString("a")).toBe(true);
});

// 型の期待は引数の宣言した型に対して書く。const に値を代入すると、tsc が代入した値の型に絞ってしまうため。
// true の側は toExtend だけだと never でも通るので、never でないことも確かめる。
function narrow(sn: string | null, sb: string | null) {
  if (isNonEmptyString(sn)) {
    expectTypeOf(sn).toExtend<string>();
    expectTypeOf(sn).not.toBeNever();
  } else expectTypeOf(sn).toEqualTypeOf<string | null>();

  if (isNonBlankString(sb)) {
    expectTypeOf(sb).toExtend<string>();
    expectTypeOf(sb).not.toBeNever();
  } else expectTypeOf(sb).toEqualTypeOf<string | null>();
}

test("false の側に、絞る型の値が残る", () => {
  narrow("", " ");
});
