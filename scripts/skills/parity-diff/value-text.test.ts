import { expect, test } from "vitest";
import { valueText } from "../../../skills/parity-diff/scripts/lib/value-text.mjs";

test.each([
  ["文字列", "a b", "a b"],
  ["数値", 2024, "2024"],
  ["真偽値", true, "true"],
  ["null", null, ""],
  ["undefined", undefined, ""],
  ["配列（String と同じく , でつなぐ）", ["a", 1, null, ["b", "c"]], "a,1,,b,c"],
])("%s は String と同じ字面にする", (_, value, expected) => {
  expect(valueText(value)).toBe(expected);
});

test("オブジェクトは中身ごとに違う文字列にする（String では、どれも [object Object] で一致してしまう）", () => {
  expect(valueText({ a: 1 })).not.toBe(valueText({ a: 2 }));
  expect(valueText({ a: 1 })).toBe(valueText({ a: 1 }));
});

test("オブジェクトは、JSON と同じ字面の文字列とも一致させない", () => {
  expect(valueText({ a: 1 })).not.toBe(valueText('{"a":1}'));
  expect(valueText([{ a: 1 }])).not.toBe(valueText('{"a":1}'));
});
