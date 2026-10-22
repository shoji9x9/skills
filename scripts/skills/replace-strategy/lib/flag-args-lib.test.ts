// replace-strategy の lib/flag-args.mjs のテスト。
//
// pending-decisions-check.mjs と procedure-staleness-check.mjs は、この parseFlagArgs と makeIo で引数を読み、出力する。
// 2 つの CLI が同じエラー文を出すことは、このモジュールを共有することで保つ。ここでは読み取りの各分岐と出力の形を確かめる。

import { expect, test } from "vitest";
import {
  makeIo,
  parseFlagArgs,
} from "../../../../skills/replace-strategy/scripts/lib/flag-args.mjs";

const KNOWN = new Set(["--file", "--mode"]);

test("parseFlagArgs: 受け付ける名前と値の組を読む。引数が無ければ空の組を返す", () => {
  expect(parseFlagArgs(["--file", "a.json", "--mode", "x"], KNOWN)).toEqual({
    args: { "--file": "a.json", "--mode": "x" },
  });
  expect(parseFlagArgs([], KNOWN)).toEqual({ args: {} });
});

test.each([
  [["--bogus", "1"], "未知の引数: --bogus"],
  [["a.json"], "未知の引数: a.json"],
  [["--file"], "--file に値が無い"],
  [["--file", "--mode", "x"], "--file に値が無い"],
  [["--file", "a", "--file", "b"], "--file が重複している"],
])("parseFlagArgs: %j は「%s」で失敗する", (argv, error) => {
  expect(parseFlagArgs(argv, KNOWN)).toEqual({ error });
});

test("makeIo: out は整形した JSON を stdout に、fail は理由と使い方を stderr に出して 2 を返す", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = makeIo(
    { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) },
    "usage: tool",
  );
  io.out({ ok: true });
  expect(io.fail("--file は必須")).toBe(2);
  expect(stdout).toEqual(['{\n  "ok": true\n}\n']);
  expect(stderr).toEqual(["--file は必須\nusage: tool\n"]);
});
