// parity-suite と spec-parity の lib/guards.mjs の値の判定のテスト。
// spec-parity は parity-suite と同じ中身の guards.mjs を同梱する（一致は scripts/gates/packaging/copies/identical-copies.json の組が確かめる）。
// 期待値は各関数の JSDoc の説明から決め、同じテストをコピーごとに実行する。
// 型の側（ブランド型で false の側に値が残ること）は guards-brand.test.ts が確かめる。

import { describe, expect, test } from "vitest";
import * as paritySuite from "../../../skills/parity-suite/scripts/lib/guards.mjs";
import * as specParity from "../../../skills/spec-parity/scripts/lib/guards.mjs";

const COPIES = [
  { skill: "parity-suite", lib: paritySuite },
  { skill: "spec-parity", lib: specParity },
];

describe.each(COPIES)("$skill の lib/guards.mjs", ({ lib }) => {
  test("isPlainObject: null と配列を除くオブジェクトだけを受ける", () => {
    expect(lib.isPlainObject({})).toBe(true);
    expect(lib.isPlainObject({ a: 1 })).toBe(true);
    expect([null, [], [1], "x", 0, undefined].map(lib.isPlainObject)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("isObjectLike: null でないオブジェクトを、配列も含めて受ける", () => {
    expect([{}, [], [1]].map(lib.isObjectLike)).toEqual([true, true, true]);
    expect([null, "x", 0, undefined].map(lib.isObjectLike)).toEqual([false, false, false, false]);
  });

  test("nonEmptyString: 空白だけの文字列を空として扱い、文字列でない値を受けない", () => {
    expect(lib.nonEmptyString("a")).toBe(true);
    expect(lib.nonEmptyString(" a ")).toBe(true);
    expect(["", "  ", "\n", 1, null, undefined].map(lib.nonEmptyString)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("isFiniteNumber: 有限の数だけを受け、数字列を受けない", () => {
    expect([0, -1, 1.5].map(lib.isFiniteNumber)).toEqual([true, true, true]);
    expect([Number.NaN, Number.POSITIVE_INFINITY, "1", null].map(lib.isFiniteNumber)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  test("positiveNumber と nonNegativeNumber: 0 の扱いだけが違う", () => {
    expect(lib.positiveNumber(0)).toBe(false);
    expect(lib.nonNegativeNumber(0)).toBe(true);
    expect(lib.positiveNumber(0.5)).toBe(true);
    expect(lib.nonNegativeNumber(0.5)).toBe(true);
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(lib.positiveNumber(v)).toBe(false);
      expect(lib.nonNegativeNumber(v)).toBe(false);
    }
  });

  test("isInteger: 整数だけを受け、小数と数字列を受けない", () => {
    expect([0, 3, -2].map(lib.isInteger)).toEqual([true, true, true]);
    expect([1.5, "3", Number.NaN].map(lib.isInteger)).toEqual([false, false, false]);
  });

  test("toIterationCount: 整数はそのまま返し、数字列・小数・欠落は null にする（0 回と記録なしを分ける）", () => {
    expect(lib.toIterationCount(0)).toBe(0);
    expect(lib.toIterationCount(4)).toBe(4);
    expect(["4", 1.5, undefined, null].map(lib.toIterationCount)).toEqual([null, null, null, null]);
  });

  test("isPlaceholder: <...> で囲んだ値を、前後の空白を無視してプレースホルダとして扱う", () => {
    expect(lib.isPlaceholder("<ISO 8601>")).toBe(true);
    expect(lib.isPlaceholder("  <承認した人>\n")).toBe(true);
    expect(lib.isPlaceholder("<複数行\nの説明>")).toBe(true);
    expect(["2026-11-11", "a <b>", "<a> b", "", 1, null].map(lib.isPlaceholder)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
