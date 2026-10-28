// 配布スキルの lib/flag-args.mjs のテスト。同じ内容のコピーを replace-strategy と issue-start が持つ。
// この parseFlagArgs と makeIo を、replace-strategy の 2 つの CLI と issue-start の acceptance-check.mjs が使う。
// ここでは読み取りの各分岐と出力の形を、コピーごとに確かめる。
// コピーが同じ内容であることは identical-copies のチェックが確かめるが、カバレッジはファイルごとに測るので、どのコピーも実行する。

import { describe, expect, test } from "vitest";
import * as issueStart from "../../../skills/issue-start/scripts/lib/flag-args.mjs";
import * as replaceStrategy from "../../../skills/replace-strategy/scripts/lib/flag-args.mjs";

const COPIES = [
  { skill: "issue-start", lib: issueStart },
  { skill: "replace-strategy", lib: replaceStrategy },
];

describe.each(COPIES)("$skill の lib/flag-args.mjs", ({ lib }) => {
  const KNOWN = new Set(["--file", "--mode"]);

  test("parseFlagArgs: 受け付ける名前と値の組を読む。引数が無ければ空の組を返す", () => {
    expect(lib.parseFlagArgs(["--file", "a.json", "--mode", "x"], KNOWN)).toEqual({
      args: { "--file": "a.json", "--mode": "x" },
    });
    expect(lib.parseFlagArgs([], KNOWN)).toEqual({ args: {} });
  });

  test.each([
    [["--bogus", "1"], "未知の引数: --bogus"],
    [["a.json"], "未知の引数: a.json"],
    [["--file"], "--file に値が無い"],
    [["--file", "--mode", "x"], "--file に値が無い"],
    [["--file", "a", "--file", "b"], "--file が重複している"],
  ])("parseFlagArgs: %j は「%s」で失敗する", (argv, error) => {
    expect(lib.parseFlagArgs(argv, KNOWN)).toEqual({ error });
  });

  test("makeIo: out は整形した JSON を stdout に、fail は理由と使い方を stderr に出して 2 を返す", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = lib.makeIo(
      { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) },
      "usage: tool",
    );
    io.out({ ok: true });
    expect(io.fail("--file は必須")).toBe(2);
    expect(stdout).toEqual(['{\n  "ok": true\n}\n']);
    expect(stderr).toEqual(["--file は必須\nusage: tool\n"]);
  });
});
