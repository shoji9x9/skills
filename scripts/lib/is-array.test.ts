// 配列に絞る型ガード（is-array.ts）と、配布スキルが持つ同じ内容の `.mjs`（skills/<name>/scripts/lib/is-array.mjs）のテスト。
// 型の期待は `expectTypeOf` で書き、`pnpm run typecheck`（tsc）が確かめる。vitest の実行では値の判定だけを確かめる。
// `toEqualTypeOf` は `any` と `unknown` を区別するので、絞った型が `any[]` に戻ると tsc が失敗する。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸           | 値                                                                                   |
// | ------------ | ------------------------------------------------------------------------------------ |
// | 入力の型     | unknown / any / number[] | undefined / string[] | null / オブジェクトの配列 / readonly の配列 / タプル / 複数の配列型の union / object / Iterable |
// | 判定の側     | 配列と判定した側 / 配列でない側                                                      |
// | 実装         | is-array.ts / is-array.mjs（JSDoc の型）                                             |
import { expect, expectTypeOf, test } from "vitest";
import { isArray } from "./is-array.ts";
import { isArray as isArrayMjs } from "../../skills/parity-suite/scripts/lib/is-array.mjs";

/** 型だけを作る（値は実行しない分岐でしか読まない）。 */
function typed<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 型のテストの入力を作る。値は判定に使わない
  return value as T;
}

test("値の判定は Array.isArray と同じ", () => {
  for (const v of [
    [],
    [1],
    Array.from({ length: 3 }),
    "a",
    0,
    null,
    undefined,
    {},
    { length: 0 },
    new Set([1]),
  ]) {
    // oxlint-disable-next-line no-restricted-properties -- 組み込みの判定と一致することを確かめる
    const expected = Array.isArray(v);
    expect(isArray(v)).toBe(expected);
    expect(isArrayMjs(v)).toBe(expected);
  }
});

// 2 つの実装を 1 つの変数（`test.each` の引数）に入れると、関数の型の union を呼ぶことになり、
// 片方の型が崩れても絞り込みの違いが表に出ない（実測）。実装ごとに同じ本文を直接書く。
test("入力の型を保って絞る（unknown・any・null と undefined との union）: is-array.ts", () => {
  const u = typed<unknown>([1]);
  if (isArray(u)) expectTypeOf(u).toEqualTypeOf<unknown[]>();
  else expectTypeOf(u).toEqualTypeOf<unknown>();

  // oxlint-disable-next-line typescript/no-explicit-any -- any を unknown[] に絞ることを確かめる入力
  const a = typed<any>([1]);
  if (isArray(a)) expectTypeOf(a).toEqualTypeOf<unknown[]>();

  const n = typed<number[] | undefined>([1]);
  if (isArray(n)) expectTypeOf(n).toEqualTypeOf<number[]>();
  else expectTypeOf(n).toEqualTypeOf<undefined>();

  const s = typed<string[] | null>(["a"]);
  if (isArray(s)) expectTypeOf(s).toEqualTypeOf<string[]>();
  else expectTypeOf(s).toEqualTypeOf<null>();

  const o = typed<{ x: number }[] | string>([{ x: 1 }]);
  if (isArray(o)) expectTypeOf(o).toEqualTypeOf<{ x: number }[]>();
  else expectTypeOf(o).toEqualTypeOf<string>();
});

test("入力の型を保って絞る（読み取り専用・タプル・配列の union・配列を含みうる型）: is-array.ts", () => {
  const r = typed<readonly string[] | number>(["a"]);
  if (isArray(r)) expectTypeOf(r).toEqualTypeOf<readonly string[]>();
  else expectTypeOf(r).toEqualTypeOf<number>();

  const t = typed<[string, number] | undefined>(["a", 1]);
  if (isArray(t)) expectTypeOf(t).toEqualTypeOf<[string, number]>();
  else expectTypeOf(t).toEqualTypeOf<undefined>();

  const m = typed<number[] | readonly string[] | boolean>([1]);
  if (isArray(m)) expectTypeOf(m).toEqualTypeOf<number[] | readonly string[]>();
  else expectTypeOf(m).toEqualTypeOf<boolean>();

  // 配列を含みうる型は、unknown[] との交差にする（要素は unknown か、元の型の要素）。
  const ob = typed<object | string>([1]);
  if (isArray(ob)) expectTypeOf(ob[0]).toEqualTypeOf<unknown>();
  else expectTypeOf(ob).toEqualTypeOf<object | string>();

  const it = typed<Iterable<string> | number>(["a"]);
  if (isArray(it)) for (const e of it) expectTypeOf(e).toEqualTypeOf<string>();
  else expectTypeOf(it).toEqualTypeOf<Iterable<string> | number>();
});

test("入力の型を保って絞る（unknown・any・null と undefined との union）: is-array.mjs", () => {
  const u = typed<unknown>([1]);
  if (isArrayMjs(u)) expectTypeOf(u).toEqualTypeOf<unknown[]>();
  else expectTypeOf(u).toEqualTypeOf<unknown>();

  // oxlint-disable-next-line typescript/no-explicit-any -- any を unknown[] に絞ることを確かめる入力
  const a = typed<any>([1]);
  if (isArrayMjs(a)) expectTypeOf(a).toEqualTypeOf<unknown[]>();

  const n = typed<number[] | undefined>([1]);
  if (isArrayMjs(n)) expectTypeOf(n).toEqualTypeOf<number[]>();
  else expectTypeOf(n).toEqualTypeOf<undefined>();

  const s = typed<string[] | null>(["a"]);
  if (isArrayMjs(s)) expectTypeOf(s).toEqualTypeOf<string[]>();
  else expectTypeOf(s).toEqualTypeOf<null>();

  const o = typed<{ x: number }[] | string>([{ x: 1 }]);
  if (isArrayMjs(o)) expectTypeOf(o).toEqualTypeOf<{ x: number }[]>();
  else expectTypeOf(o).toEqualTypeOf<string>();
});

test("入力の型を保って絞る（読み取り専用・タプル・配列の union・配列を含みうる型）: is-array.mjs", () => {
  const r = typed<readonly string[] | number>(["a"]);
  if (isArrayMjs(r)) expectTypeOf(r).toEqualTypeOf<readonly string[]>();
  else expectTypeOf(r).toEqualTypeOf<number>();

  const t = typed<[string, number] | undefined>(["a", 1]);
  if (isArrayMjs(t)) expectTypeOf(t).toEqualTypeOf<[string, number]>();
  else expectTypeOf(t).toEqualTypeOf<undefined>();

  const m = typed<number[] | readonly string[] | boolean>([1]);
  if (isArrayMjs(m)) expectTypeOf(m).toEqualTypeOf<number[] | readonly string[]>();
  else expectTypeOf(m).toEqualTypeOf<boolean>();

  // 配列を含みうる型は、unknown[] との交差にする（要素は unknown か、元の型の要素）。
  const ob = typed<object | string>([1]);
  if (isArrayMjs(ob)) expectTypeOf(ob[0]).toEqualTypeOf<unknown>();
  else expectTypeOf(ob).toEqualTypeOf<object | string>();

  const it = typed<Iterable<string> | number>(["a"]);
  if (isArrayMjs(it)) for (const e of it) expectTypeOf(e).toEqualTypeOf<string>();
  else expectTypeOf(it).toEqualTypeOf<Iterable<string> | number>();
});
