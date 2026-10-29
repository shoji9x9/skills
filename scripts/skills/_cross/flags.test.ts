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
import { parseFlags as AgentUsage } from "../../../skills/agent-usage/scripts/lib/flags.mjs";
import { parseFlags as AwsArchitectureDiagram } from "../../../skills/aws-architecture-diagram/scripts/lib/flags.mjs";
import { parseFlags as GoldenDataset } from "../../../skills/golden-dataset/scripts/lib/flags.mjs";
import { parseFlags as IssueStart } from "../../../skills/issue-start/scripts/lib/flags.mjs";
import { parseFlags as ParityComponent } from "../../../skills/parity-component/scripts/lib/flags.mjs";
import { parseFlags as ParityDiff } from "../../../skills/parity-diff/scripts/lib/flags.mjs";
import { parseFlags as ParitySuite } from "../../../skills/parity-suite/scripts/lib/flags.mjs";
import { parseFlags as ReplaceStrategy } from "../../../skills/replace-strategy/scripts/lib/flags.mjs";

const COPIES = [
  { skill: "agent-usage", parseFlags: AgentUsage },
  { skill: "aws-architecture-diagram", parseFlags: AwsArchitectureDiagram },
  { skill: "golden-dataset", parseFlags: GoldenDataset },
  { skill: "issue-start", parseFlags: IssueStart },
  { skill: "parity-component", parseFlags: ParityComponent },
  { skill: "parity-diff", parseFlags: ParityDiff },
  { skill: "parity-suite", parseFlags: ParitySuite },
  { skill: "replace-strategy", parseFlags: ReplaceStrategy },
];

describe.each(COPIES)("$skill の lib/flags.mjs", ({ parseFlags }) => {
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
    expect(parseFlags(argv, SPEC)).toMatchObject({ flags, positionals: [] });
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
      flags: { "--out": "o" },
      positionals: ["a", "-"],
    });
    expect(parseFlags(["a", "b", "c"], spec)).toEqual({ error: "不明な引数: c" });
  });

  test("parseFlags: equals なら `--名前=値` を受け付け、値の検査と重複の検査を同じに当てる", () => {
    const spec = { values: ["--env"], bools: ["--all"], equals: true };
    expect(parseFlags(["--env=prod"], spec)).toMatchObject({
      flags: { "--env": "prod" },
      positionals: [],
    });
    expect(parseFlags(["--env", "prod"], spec)).toMatchObject({
      flags: { "--env": "prod" },
      positionals: [],
    });
    expect(parseFlags(["--env="], spec)).toEqual({ error: "--env に値が無い" });
    expect(parseFlags(["--env=a", "--env", "b"], spec)).toEqual({ error: "--env が重複している" });
    expect(parseFlags(["--all=1"], spec)).toEqual({ error: "不明な引数: --all=1" });
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
  });

  test.each([
    ["空白だけの値", ["--file", "  "], "--file に値が無い"],
    ["`-` 1 つで始まる受け付ける名前（-h）", ["--file", "-h"], "--file に値が無い"],
    ["`--` だけの値", ["--file", "--"], "--file に値が無い"],
  ])("parseFlags: %s は値の書き忘れとして誤りにする", (_, argv, error) => {
    expect(parseFlags(argv, { values: ["--file"], bools: ["-h"] })).toEqual({ error });
  });

  test("parseFlags: 名前の種類ごとの表に分けて返す（strings・lists・bools）", () => {
    expect(parseFlags(["--file", "a", "--state", "s", "--all"], SPEC)).toEqual({
      flags: { "--file": "a", "--state": ["s"], "--all": true },
      strings: { "--file": "a" },
      lists: { "--state": ["s"] },
      bools: { "--all": true },
      positionals: [],
    });
  });
});
