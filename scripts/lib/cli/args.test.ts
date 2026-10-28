import { expect, test } from "vitest";
import { parseArgs } from "./args.ts";

test("--名前 値 の組を、名前から値への対応にする", () => {
  expect(parseArgs(["--a", "1", "--b", "x y"])).toEqual({ a: "1", b: "x y" });
  expect(parseArgs([])).toEqual({});
  // 値は検査しないので、-- で始まるプロンプトの文も値として読む。
  expect(parseArgs(["--prompt", "--help を説明して"])).toEqual({ prompt: "--help を説明して" });
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
    label: "名前の無いフラグ",
    argv: ["--", "1"],
    message: 'arguments must be --name value pairs (near "--")',
  },
  {
    label: "英小文字・数字・ハイフンでない名前",
    argv: ["--__proto__", "1"],
    message: 'arguments must be --name value pairs (near "--__proto__")',
  },
  {
    label: "2 回目に出たフラグ",
    argv: ["--a", "1", "--a", "2"],
    message: "--a is given more than once",
  },
  {
    label: "値の無いフラグ",
    argv: ["--a", "1", "--b"],
    message: "arguments must be --name value pairs (--b has no value)",
  },
])("$label は、誤っている箇所をメッセージに出して例外にする", ({ argv, message }) => {
  expect(() => parseArgs(argv)).toThrow(message);
});
