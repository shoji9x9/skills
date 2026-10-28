import { expect, test } from "vitest";
import { parseArgs } from "./args.ts";

test("--名前 値 の組を、名前から値への対応にする", () => {
  expect(parseArgs(["--a", "1", "--b", "x y"])).toEqual({ a: "1", b: "x y" });
  expect(parseArgs([])).toEqual({});
});

test.each([
  {
    label: "-- で始まらない引数",
    argv: ["a", "1"],
    message: 'arguments must be --name value pairs (near "a")',
  },
  {
    label: "空の引数",
    argv: ["--a", "1", "", "2"],
    message: 'arguments must be --name value pairs (near "")',
  },
  {
    label: "値の無いフラグ",
    argv: ["--a", "1", "--b"],
    message: "arguments must be --name value pairs (--b has no value)",
  },
])("$label は、誤っている箇所をメッセージに出して例外にする", ({ argv, message }) => {
  expect(() => parseArgs(argv)).toThrow(message);
});
