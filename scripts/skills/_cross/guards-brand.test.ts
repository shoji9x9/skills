// 配布スキルの lib/guards.mjs（parity-suite・parity-component）のうち、一部の値にだけ true を返す型ガードの、
// false の側の型のテスト。これらの型ガードは、絞る型をブランド型（`string & { readonly __<名前>: true }`）にしている。
// `v is string` と書くと、false の側から string が取り除かれ、実際には来る "" や NaN が型の上で消える。
// 型の期待は `expectTypeOf` で書き、`pnpm run typecheck`（tsc）が確かめる。vitest の実行では値の判定だけを確かめる。
// 2 つ以上のスキルの guards.mjs をまとめて扱うので、_cross に置く。
// モジュールの中だけの型ガードは import できないので、ブランド型に絞っているかは
// scripts/gates/types/check-type-guard-brands.ts が構文で確かめる。
//
// 状態空間の軸と、各セルに置いた入力は次のとおりである。
//
// | 軸       | 値                                                                  |
// | -------- | ------------------------------------------------------------------- |
// | 入力の型 | string \| undefined、string、string \| number、number \| undefined、number |
// | 判定の側 | true の側 / false の側                                              |
// | 実装     | parity-suite の lib/guards.mjs / parity-component の lib/guards.mjs |
import { expect, expectTypeOf, test } from "vitest";
import {
  isFiniteNumber,
  nonEmptyString,
  positiveNumber,
} from "../../../skills/parity-suite/scripts/lib/guards.mjs";
import { filled, safeSegment } from "../../../skills/parity-component/scripts/lib/guards.mjs";

test("値の判定: 空白だけの文字列・プレースホルダ・.. と、NaN・Infinity・0 に false を返す", () => {
  expect(nonEmptyString("  ")).toBe(false);
  expect(nonEmptyString("a")).toBe(true);
  expect(filled("a")).toBe(true);
  expect(safeSegment("..")).toBe(false);
  expect(isFiniteNumber(Number.NaN)).toBe(false);
  expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
  expect(positiveNumber(0)).toBe(false);
});

// 型の期待は引数の宣言した型に対して書く。const に値を代入すると、tsc が代入した値の型に絞ってしまうため。
// true の側は toExtend だけだと never でも通るので、never でないことも確かめる。
function narrow(
  s: string | undefined,
  f: string,
  seg: string | number,
  n: number | undefined,
  p: number,
) {
  if (nonEmptyString(s)) {
    expectTypeOf(s).toExtend<string>();
    expectTypeOf(s).not.toBeNever();
  } else expectTypeOf(s).toEqualTypeOf<string | undefined>();

  if (filled(f)) {
    expectTypeOf(f).toExtend<string>();
    expectTypeOf(f).not.toBeNever();
  } else expectTypeOf(f).toEqualTypeOf<string>();

  if (safeSegment(seg)) {
    expectTypeOf(seg).toExtend<string>();
    expectTypeOf(seg).not.toBeNever();
  } else expectTypeOf(seg).toEqualTypeOf<string | number>();

  if (isFiniteNumber(n)) {
    expectTypeOf(n).toExtend<number>();
    expectTypeOf(n).not.toBeNever();
  } else expectTypeOf(n).toEqualTypeOf<number | undefined>();

  if (positiveNumber(p)) {
    expectTypeOf(p).toExtend<number>();
    expectTypeOf(p).not.toBeNever();
  } else expectTypeOf(p).toEqualTypeOf<number>();
}

test("false の側に、絞る型の値が残る", () => {
  narrow("", "TODO", "..", Number.NaN, 0);
});
