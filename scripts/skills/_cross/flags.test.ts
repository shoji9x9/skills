// 配布スキルの lib/flags.mjs（parseFlags）のテスト。同じ内容のコピーを、`--名前 値` の引数を読む CLI を持つ配布スキルが持つ。
// コピーが同じ内容であることは identical-copies のチェックが確かめるが、カバレッジはファイルごとに測るので、どのコピーも実行する。
//
// 入力の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                                   |
// | -------------- | ------------------------------------------------------------------------------------ |
// | 名前           | 値を取る / 繰り返してよい / 値を取らない / 未知 / `=` 付き（equals の有無）           |
// | 値             | ある / 無い（末尾） / 空 / `--` で始まる（受け付ける名前・未知の名前、dashValues の有無） / `-` |
// | 回数           | 1 回 / 2 回（値を取る・繰り返してよい・値を取らない）                                  |
// | 位置引数       | 0 件 / 上限まで / 上限を超える / `-` だけ                                             |
// | 誤りの順序     | 未知の名前で値が無い（未知を先に報告する）                                             |

import { describe, expect, test } from "vitest";
import * as AgentUsage from "../../../skills/agent-usage/scripts/lib/flags.mjs";
import * as AwsArchitectureDiagram from "../../../skills/aws-architecture-diagram/scripts/lib/flags.mjs";
import * as GoldenDataset from "../../../skills/golden-dataset/scripts/lib/flags.mjs";
import * as IssueStart from "../../../skills/issue-start/scripts/lib/flags.mjs";
import * as ParityComponent from "../../../skills/parity-component/scripts/lib/flags.mjs";
import * as ParityDiff from "../../../skills/parity-diff/scripts/lib/flags.mjs";
import * as ParitySuite from "../../../skills/parity-suite/scripts/lib/flags.mjs";
import * as ReplaceStrategy from "../../../skills/replace-strategy/scripts/lib/flags.mjs";

const COPIES = [
  { skill: "agent-usage", lib: AgentUsage },
  { skill: "aws-architecture-diagram", lib: AwsArchitectureDiagram },
  { skill: "golden-dataset", lib: GoldenDataset },
  { skill: "issue-start", lib: IssueStart },
  { skill: "parity-component", lib: ParityComponent },
  { skill: "parity-diff", lib: ParityDiff },
  { skill: "parity-suite", lib: ParitySuite },
  { skill: "replace-strategy", lib: ReplaceStrategy },
];

describe.each(COPIES)("$skill の lib/flags.mjs", ({ lib }) => {
  const { parseFlags } = lib;

  test("stripDashes: 表のキーから先頭の `--` を外し、値はそのまま返す", () => {
    expect(lib.stripDashes({ "--out": "a", "--state": ["s"], "-h": true })).toEqual({
      out: "a",
      state: ["s"],
      "-h": true,
    });
  });

  const SPEC = {
    values: ["--file", "--state", "--property"],
    repeat: ["--state", "--property"],
    bools: ["--all"],
    dashValues: ["--property"],
  };

  test.each([
    ["値を取る名前", ["--file", "a.json"], { "--file": "a.json" }],
    ["繰り返してよい名前は配列", ["--state", "a", "--state", "b"], { "--state": ["a", "b"] }],
    ["繰り返してよい名前は 1 回でも配列", ["--state", "a"], { "--state": ["a"] }],
    ["値を取らない名前", ["--all"], { "--all": true }],
    [
      "dashValues の名前は、未知の名前と同じ `--` の値を受け付ける",
      ["--property", "--brand"],
      { "--property": ["--brand"] },
    ],
    ["`-` で始まる値（`--` でない）", ["--file", "-"], { "--file": "-" }],
    ["引数なし", [], {}],
  ])("parseFlags: %s", (_, argv, flags) => {
    const parsed = parseFlags(argv, SPEC);
    if (parsed.error !== undefined) throw new Error(parsed.error);
    expect({ ...parsed.strings, ...parsed.lists, ...parsed.bools }).toEqual(flags);
    expect(parsed.positionals).toEqual([]);
  });

  test.each([
    ["未知の名前", ["--bogus", "1"], "不明な引数: --bogus"],
    ["未知の名前で値が無い（名前を先に確かめる）", ["--bogus"], "不明な引数: --bogus"],
    ["位置引数を受け付けない", ["a.json"], "不明な引数: a.json"],
    ["`-` だけの引数も位置引数", ["-"], "不明な引数: -"],
    ["値が無い（末尾）", ["--file"], "--file に値が無い"],
    ["値が空", ["--file", ""], "--file に値が無い"],
    ["値が `--` で始まる", ["--file", "--all"], "--file に値が無い"],
    ["値が未知の `--` の名前", ["--file", "--bogus"], "--file に値が無い"],
    [
      "dashValues の名前でも、受け付ける名前と同じ値は誤り",
      ["--property", "--all"],
      "--property に値が無い",
    ],
    ["値を取る名前の 2 回目", ["--file", "a", "--file", "b"], "--file が重複している"],
    ["値を取らない名前の 2 回目", ["--all", "--all"], "--all が重複している"],
    ["equals が無ければ `=` 付きは未知", ["--file=a"], "不明な引数: --file=a"],
  ])("parseFlags: %s は誤りにする", (_, argv, error) => {
    expect(parseFlags(argv, SPEC)).toEqual({ error });
  });

  test("parseFlags: 位置引数は上限まで受け付け、超えたら誤りにする。`-` だけの引数も位置引数として数える", () => {
    const spec = { values: ["--out"], positionals: 2 };
    expect(parseFlags(["a", "--out", "o", "-"], spec)).toMatchObject({
      strings: { "--out": "o" },
      positionals: ["a", "-"],
    });
    expect(parseFlags(["a", "b", "c"], spec)).toEqual({ error: "不明な引数: c" });
  });

  test("parseFlags: equals なら `--名前=値` を受け付け、値の検査と重複の検査を同じに当てる", () => {
    const spec = { values: ["--env"], bools: ["--all"], equals: true };
    expect(parseFlags(["--env=prod"], spec)).toMatchObject({
      strings: { "--env": "prod" },
      positionals: [],
    });
    expect(parseFlags(["--env", "prod"], spec)).toMatchObject({
      strings: { "--env": "prod" },
      positionals: [],
    });
    expect(parseFlags(["--env="], spec)).toEqual({ error: "--env に値が無い" });
    expect(parseFlags(["--env=a", "--env", "b"], spec)).toEqual({ error: "--env が重複している" });
    expect(parseFlags(["--all=1"], spec)).toEqual({ error: "--all は値を取らない" });
    expect(parseFlags(["--bogus=1"], spec)).toEqual({ error: "不明な引数: --bogus=1" });
  });

  test("parseFlags: `--` の後は、`-` で始まる引数も位置引数にする。上限も同じに当てる", () => {
    const spec = { values: ["--out"], positionals: 2 };
    expect(parseFlags(["--out", "o", "--", "-a.json", "--out"], spec)).toMatchObject({
      strings: { "--out": "o" },
      positionals: ["-a.json", "--out"],
    });
    expect(parseFlags(["--", "a", "b", "c"], spec)).toEqual({ error: "不明な引数: c" });
    expect(parseFlags(["-a.json"], spec)).toEqual({ error: "不明な引数: -a.json" });
    // 位置引数を取らない CLI では、`--` も受け付けない。
    expect(parseFlags(["--"], { values: ["--out"] })).toEqual({ error: "不明な引数: --" });
  });

  test("parseFlags: stdin: false なら `-` だけの位置引数を受け付けず、名前の値と `--` より後の `-` は受け付ける", () => {
    const spec = { values: ["--root"], positionals: 2, stdin: false };
    expect(parseFlags(["a", "-"], spec)).toEqual({ error: "不明な引数: -" });
    expect(parseFlags(["--root", "-", "a"], spec)).toMatchObject({
      strings: { "--root": "-" },
      positionals: ["a"],
    });
    expect(parseFlags(["--", "-"], spec)).toMatchObject({ positionals: ["-"] });
  });

  test.each([
    ["空白だけの値", ["--file", "  "], "--file に値が無い"],
    ["`-` 1 つで始まる受け付ける名前（-h）", ["--file", "-h"], "--file に値が無い"],
    ["`--` だけの値", ["--file", "--"], "--file に値が無い"],
    ["dashValues の名前でも `--` だけの値", ["--prop", "--"], "--prop に値が無い"],
  ])("parseFlags: %s は値の書き忘れとして誤りにする", (_, argv, error) => {
    const spec = { values: ["--file", "--prop"], bools: ["-h"], dashValues: ["--prop"] };
    expect(parseFlags(argv, spec)).toEqual({ error });
  });

  test("parseFlags: 名前の種類ごとの表に分けて返す（strings・lists・bools）", () => {
    expect(parseFlags(["--file", "a", "--state", "s", "--all"], SPEC)).toEqual({
      strings: { "--file": "a" },
      lists: { "--state": ["s"] },
      bools: { "--all": true },
      positionals: [],
    });
  });
});
