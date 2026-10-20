// replace-strategy の lib/errors.mjs の errorMessage のテスト。
//
// errorMessage は catch で受けた値を、`e instanceof Error ? e.message : String(e)` と同じ文字列にする（lib/errors.mjs の JSDoc）。
// 同梱スクリプトは、読めない入力の理由としてこの文字列を利用者に表示する。
// Error でない値（偽の値・文字列・オブジェクト・関数）が投げられたときも、常に文字列を返すことを確かめる。

import { expect, test } from "vitest";
import { errorMessage } from "../../../skills/replace-strategy/scripts/lib/errors.mjs";

test("Error とそのサブクラスからは message を返す", () => {
  expect(errorMessage(new Error("読めない"))).toBe("読めない");
  expect(errorMessage(new TypeError("型が違う"))).toBe("型が違う");
  expect(errorMessage(new Error(""))).toBe("");
});

test.each([
  [null, "null"],
  [undefined, "undefined"],
  [0, "0"],
  ["", ""],
  [false, "false"],
])("偽の値は String() で文字列にする: %j", (value, expected) => {
  expect(errorMessage(value)).toBe(expected);
});

test.each([
  ["文字列", "文字列"],
  [42, "42"],
  [true, "true"],
])("真のプリミティブは String() で文字列にする: %j", (value, expected) => {
  expect(errorMessage(value)).toBe(expected);
});

test("Error でないオブジェクトは、message を持っていても String() で文字列にする", () => {
  expect(errorMessage({ message: "理由" })).toBe("[object Object]");
  expect(errorMessage({})).toBe("[object Object]");
  const thrown = Object.assign(() => undefined, { message: "関数の理由" });
  expect(errorMessage(thrown)).toBe(String(thrown));
});
