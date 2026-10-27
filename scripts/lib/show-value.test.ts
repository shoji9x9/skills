import { expect, test } from "vitest";
import { showValue } from "./show-value.ts";

test.each([
  ["文字列", "abc", "abc"],
  ["数値", 1.5, "1.5"],
  ["真偽値", false, "false"],
  ["null", null, "null"],
  ["undefined", undefined, "undefined"],
  ["オブジェクト", { a: 1 }, '{"a":1}'],
  ["配列", [1, "x"], '[1,"x"]'],
])("%s は %j を %j にする", (_, value, expected) => {
  expect(showValue(value)).toBe(expected);
});

test("循環する参照を持つオブジェクトは、JSON にできないので型の名前にする", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(showValue(cyclic)).toBe("[object Object]");
});
