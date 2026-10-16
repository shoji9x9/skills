// replace-strategy の lib/errors.mjs の errorMessage のテスト。
//
// errorMessage は catch で受けた値から、`error && error.message` と同じ値を取り出す（lib/errors.mjs の JSDoc）。
// 同梱スクリプトは、読めない入力の理由としてこの値を利用者に表示する。
// Error 以外の値（偽の値・プリミティブ・関数）が投げられたときも、同じ式と同じ値になることを確かめる。

import { expect, test } from "vitest";
import { errorMessage } from "../../../skills/replace-strategy/scripts/lib/errors.mjs";

test("Error と message を持つオブジェクトからは message を返す", () => {
  expect(errorMessage(new Error("読めない"))).toBe("読めない");
  expect(errorMessage({ message: "理由" })).toBe("理由");
  // message を持たないオブジェクトは undefined（`error.message` と同じ）。
  expect(errorMessage({})).toBeUndefined();
});

test("message を持つ関数からも message を返す", () => {
  const thrown = Object.assign(() => undefined, { message: "関数の理由" });
  expect(errorMessage(thrown)).toBe("関数の理由");
});

test.each([[null], [undefined], [0], [""], [false]])("偽の値はそのまま返す: %j", (value) => {
  expect(errorMessage(value)).toBe(value);
});

test.each([["文字列"], [42], [true]])(
  "真のプリミティブは message を持たないので undefined を返す: %j",
  (value) => {
    expect(errorMessage(value)).toBeUndefined();
  },
);
