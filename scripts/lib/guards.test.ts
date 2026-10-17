// 一部の値にだけ true を返す型ガード（空文字・空白・NaN などに false を返すもの）の、false の側の型のテスト。
// これらの型ガードは、絞る型をブランド型（`string & { readonly __<名前>: true }`）にしている。
// `value is string` と書くと、false の側から string が取り除かれ、実際には来る "" や "  " が型の上で消える。
// 型の期待は `expectTypeOf` で書き、`pnpm run typecheck`（tsc）が確かめる。vitest の実行では値の判定だけを確かめる。
//
// 状態空間の軸と、各セルに置いた入力は次のとおりである。
//
// | 軸       | 値                                                                              |
// | -------- | ------------------------------------------------------------------------------- |
// | 入力の型 | string \| null、string、number \| undefined、number、string \| number |
// | 判定の側 | true の側 / false の側                                                          |
// | 実装     | scripts/lib/guards.ts / parity-suite と parity-component の lib/guards.mjs      |
import { expect, expectTypeOf, test } from "vitest";
import { isNonBlankString, isNonEmptyString } from "./guards.ts";
import {
  isFiniteNumber,
  nonEmptyString,
  positiveNumber,
} from "../../skills/parity-suite/scripts/lib/guards.mjs";
import { filled, safeSegment } from "../../skills/parity-component/scripts/lib/guards.mjs";

test("値の判定: 空文字と空白だけの文字列、NaN と Infinity に false を返す", () => {
  expect(isNonEmptyString("")).toBe(false);
  expect(isNonEmptyString(" ")).toBe(true);
  expect(isNonBlankString(" ")).toBe(false);
  expect(nonEmptyString("  ")).toBe(false);
  expect(nonEmptyString("a")).toBe(true);
  expect(isFiniteNumber(Number.NaN)).toBe(false);
  expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
  expect(positiveNumber(0)).toBe(false);
  expect(safeSegment("..")).toBe(false);
});

// 型の期待は引数の宣言した型に対して書く。const に値を代入すると、tsc が代入した値の型に絞ってしまうため。
function narrowLibGuards(sn: string | null, sb: string | null) {
  if (isNonEmptyString(sn)) expectTypeOf(sn).toExtend<string>();
  else expectTypeOf(sn).toEqualTypeOf<string | null>();

  if (isNonBlankString(sb)) expectTypeOf(sb).toExtend<string>();
  else expectTypeOf(sb).toEqualTypeOf<string | null>();
}

function narrowSkillGuards(
  s: string | undefined,
  f: string,
  seg: string | number,
  n: number | undefined,
  p: number,
) {
  if (nonEmptyString(s)) expectTypeOf(s).toExtend<string>();
  else expectTypeOf(s).toEqualTypeOf<string | undefined>();

  if (filled(f)) expectTypeOf(f).toExtend<string>();
  else expectTypeOf(f).toEqualTypeOf<string>();

  if (safeSegment(seg)) expectTypeOf(seg).toExtend<string>();
  else expectTypeOf(seg).toEqualTypeOf<string | number>();

  if (isFiniteNumber(n)) expectTypeOf(n).toExtend<number>();
  else expectTypeOf(n).toEqualTypeOf<number | undefined>();

  if (positiveNumber(p)) expectTypeOf(p).toExtend<number>();
  else expectTypeOf(p).toEqualTypeOf<number>();
}

test("false の側に、絞る型の値が残る: scripts/lib/guards.ts", () => {
  narrowLibGuards("", " ");
});

test("false の側に、絞る型の値が残る: lib/guards.mjs", () => {
  narrowSkillGuards("", "TODO", "..", Number.NaN, 0);
});
