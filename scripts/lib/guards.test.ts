// 一部の値にだけ true を返す型ガード（空文字・空白・NaN などに false を返すもの）の、false の側の型のテスト。
// これらの型ガードは、絞る型をブランド型（`string & { readonly __<名前>: true }`）にしている。
// `value is string` と書くと、false の側から string が取り除かれ、実際には来る "" や "  " が型の上で消える。
// 型の期待は `expectTypeOf` で書き、`pnpm run typecheck`（tsc）が確かめる。vitest の実行では値の判定だけを確かめる。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸       | 値                                                                              |
// | -------- | ------------------------------------------------------------------------------- |
// | 入力の型 | unknown / string | null / string | number | undefined / number                 |
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

/** 型だけを作る（値は実行しない分岐でしか読まない）。 */
function typed<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 型のテストの入力を作る。値は判定に使わない
  return value as T;
}

test("値の判定: 空文字と空白だけの文字列、NaN と Infinity に false を返す", () => {
  expect(isNonEmptyString("")).toBe(false);
  expect(isNonEmptyString(" ")).toBe(true);
  expect(isNonBlankString(" ")).toBe(false);
  expect(nonEmptyString("  ")).toBe(false);
  expect(nonEmptyString("a")).toBe(true);
  expect(isFiniteNumber(Number.NaN)).toBe(false);
  expect(positiveNumber(0)).toBe(false);
  expect(safeSegment("..")).toBe(false);
});

test("false の側に、絞る型の値が残る: scripts/lib/guards.ts", () => {
  const sn = typed<string | null>("");
  if (isNonEmptyString(sn)) expectTypeOf(sn).toExtend<string>();
  else expectTypeOf(sn).toEqualTypeOf<string | null>();

  const sb = typed<string | null>(" ");
  if (isNonBlankString(sb)) expectTypeOf(sb).toExtend<string>();
  else expectTypeOf(sb).toEqualTypeOf<string | null>();

  // unknown は false の側でも unknown のまま
  const u = typed<unknown>("");
  if (!isNonEmptyString(u)) expectTypeOf(u).toEqualTypeOf<unknown>();
});

test("false の側に、絞る型の値が残る: lib/guards.mjs", () => {
  const s = typed<string | undefined>("");
  if (nonEmptyString(s)) expectTypeOf(s).toExtend<string>();
  else expectTypeOf(s).toEqualTypeOf<string | undefined>();

  const f = typed<string>("TODO");
  if (filled(f)) expectTypeOf(f).toExtend<string>();
  else expectTypeOf(f).toEqualTypeOf<string>();

  const seg = typed<string | number>("..");
  if (safeSegment(seg)) expectTypeOf(seg).toExtend<string>();
  else expectTypeOf(seg).toEqualTypeOf<string | number>();

  const n = typed<number | undefined>(Number.NaN);
  if (isFiniteNumber(n)) expectTypeOf(n).toExtend<number>();
  else expectTypeOf(n).toEqualTypeOf<number | undefined>();

  const p = typed<number>(0);
  if (positiveNumber(p)) expectTypeOf(p).toExtend<number>();
  else expectTypeOf(p).toEqualTypeOf<number>();
});
