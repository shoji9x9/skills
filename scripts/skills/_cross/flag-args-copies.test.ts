// 配布スキルの lib/flag-args.mjs のテスト。同じ内容のコピーを replace-strategy と issue-start が持つ。
// この makeIo を、replace-strategy の 2 つの CLI と issue-start の acceptance-check.mjs が使う。
// ここでは出力の形を、コピーごとに確かめる。
// コピーが同じ内容であることは identical-copies のチェックが確かめるが、カバレッジはファイルごとに測るので、どのコピーも実行する。

import { describe, expect, test } from "vitest";
import * as issueStart from "../../../skills/issue-start/scripts/lib/flag-args.mjs";
import * as replaceStrategy from "../../../skills/replace-strategy/scripts/lib/flag-args.mjs";

const COPIES = [
  { skill: "issue-start", lib: issueStart },
  { skill: "replace-strategy", lib: replaceStrategy },
];

describe.each(COPIES)("$skill の lib/flag-args.mjs", ({ lib }) => {
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
