// guards-brand.test.ts のヘルパー。
import { expectTypeOf } from "vitest";
import {
  isFiniteNumber,
  nonEmptyString,
  positiveNumber,
} from "../../../skills/parity-suite/scripts/lib/guards.mjs";
import { filled, safeSegment } from "../../../skills/parity-component/scripts/lib/guards.mjs";

// 型の期待は引数の宣言した型に対して書く。const に値を代入すると、tsc が代入した値の型に絞ってしまうため。
// true の側は toExtend だけだと never でも通るので、never でないことも確かめる。
export function narrow({
  s,
  f,
  seg,
  n,
  p,
}: {
  s: string | undefined;
  f: string;
  seg: string | number;
  n: number | undefined;
  p: number;
}) {
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
