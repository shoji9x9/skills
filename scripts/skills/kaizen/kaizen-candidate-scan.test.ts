import { afterEach, describe, expect, test } from "vitest";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  claudeAssistant,
  claudeEdit,
  claudeUser,
  fixturesDir,
  pathWith,
  realCommand,
  scan,
  transcript,
  workdir,
  workdirs,
} from "./kaizen-candidate-scan-helpers.ts";

// kaizen-candidate-scan.sh の終了コードの取り決め（スクリプトの冒頭）を、入力の状態ごとに確かめる。
//   exit 0: 候補あり / exit 1: 検証したうえで候補なし / exit 2: 判定できない
// コミット前のチェックは exit 1 だけを「抽出しなくてよい」として扱う。判定できない入力や
// 走査の失敗を exit 1 にすると、未抽出の学びを残したまま commit が通る。
// 走査の結果ごとの候補の判定（注入の形・補助レコードなど）は kaizen-precommit-gate.test.ts が確かめる。

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("走査を始められない入力は判定できないとして扱う", () => {
  test.each([
    ["transcript を渡さない", () => []],
    ["transcript が存在しない", (dir: string) => [join(dir, "missing.jsonl")]],
  ])("%s なら exit 2", (_name, args) => {
    const res = scan(args(workdir()));
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("transcript is missing or unreadable");
  });

  test("jq が無ければ exit 2（構造を確かめられないまま候補なしと答えない）", () => {
    const dir = workdir();
    const t = transcript(dir, [claudeUser("確認してください")]);
    const res = scan([t, join(dir, "no-checkpoint")], { PATH: pathWith(dir, { jq: null }) });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("jq is required");
  });

  test.each([
    ["jq が失敗する", "#!/bin/sh\nexit 5\n", "transcript JSONL could not be parsed"],
    [
      "jq が 1 件も記録を出さない",
      "#!/bin/sh\nexit 0\n",
      "no supported Claude Code or Codex records were found",
    ],
  ])("%s なら exit 2", (_name, stub, message) => {
    const dir = workdir();
    const t = transcript(dir, [claudeUser("確認してください")]);
    const res = scan([t, join(dir, "no-checkpoint")], { PATH: pathWith(dir, { jq: stub }) });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain(message);
  });

  // 一時ファイルを作れないときに set -e に任せると exit 1（候補なし）として扱われる。
  test.each([
    ["1 つ目", 1],
    ["2 つ目", 2],
  ])("%s の一時ファイルを作れなければ exit 2", (_name, failAt) => {
    const dir = workdir();
    const t = transcript(dir, [claudeUser("確認してください")]);
    const counter = join(dir, "mktemp-count");
    const stub = [
      "#!/bin/sh",
      `n=$(( $(cat '${counter}' 2>/dev/null || echo 0) + 1 ))`,
      `echo "$n" >'${counter}'`,
      `[ "$n" -ge ${failAt} ] && exit 1`,
      `exec '${realCommand("mktemp")}' "$@"`,
      "",
    ].join("\n");
    const res = scan([t, join(dir, "no-checkpoint")], { PATH: pathWith(dir, { mktemp: stub }) });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("could not create a temporary file");
    expect(readFileSync(counter, "utf8").trim()).toBe(String(failAt));
  });

  test("checkpoint の位置から transcript を読めなければ exit 2", () => {
    const dir = workdir();
    const t = transcript(dir, [claudeUser("確認してください")]);
    const res = scan([t, join(dir, "no-checkpoint")], {
      PATH: pathWith(dir, { tail: "#!/bin/sh\nexit 1\n" }),
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("could not read the transcript from the checkpoint offset");
  });
});

describe("エージェントの判定", () => {
  test("Claude Code と Codex のレコードが混在すれば exit 2", () => {
    const dir = workdir();
    const lines = ["claude-no-candidate.jsonl", "codex-no-candidate.jsonl"].flatMap((f) =>
      readFileSync(join(fixturesDir, f), "utf8").split("\n").filter(Boolean),
    );
    const res = scan([transcript(dir, lines), join(dir, "no-checkpoint")]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("mixes Claude Code and Codex records");
  });

  // 会話を運ばない補助レコードだけでは、どちらのエージェントか決められない。
  const auxOnly = ['{"type":"ai-title","title":"x"}'];

  test("補助レコードだけで checkpoint にもエージェントが無ければ exit 2", () => {
    const dir = workdir();
    const res = scan([transcript(dir, auxOnly), join(dir, "no-checkpoint")]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("transcript agent could not be identified");
  });

  test("補助レコードだけでも、checkpoint が記録したエージェントで検証済みゼロにする", () => {
    const dir = workdir();
    const t = transcript(dir, auxOnly);
    const checkpoint = join(dir, "checkpoint");
    writeFileSync(checkpoint, `${t}\n0\nclaude-code\n0\n`);
    const res = scan([t, checkpoint]);
    expect(res.status, res.stderr).toBe(1);
    expect(res.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
  });
});

describe("checkpoint からの差分", () => {
  const initial = [
    claudeUser("README を確認してください"),
    claudeAssistant([{ type: "text", text: "確認しました" }]),
  ];

  function withCheckpoint(lines: string[], record: (t: string, bytes: number) => string) {
    const dir = workdir();
    const t = transcript(dir, initial);
    const bytes = Buffer.byteLength(readFileSync(t));
    if (lines.length > 0) appendFileSync(t, `${lines.join("\n")}\n`);
    const checkpoint = join(dir, "checkpoint");
    writeFileSync(checkpoint, record(t, bytes));
    return scan([t, checkpoint]);
  }

  // 根拠の行番号は transcript の先頭からの行番号で出す。行数を持たない旧形式の checkpoint では
  // 処理済みの部分を数え直して起点にするので、行数を持つ checkpoint と同じ行番号になる。
  test.each([
    ["行数を持つ checkpoint", (t: string, b: number) => `${t}\n${b}\nclaude-code\n2\n`],
    ["行数を持たない旧形式の checkpoint", (t: string, b: number) => `${t}\n${b}\nclaude-code\n`],
  ])("%s でも、根拠の行番号は先頭から数える", (_name, record) => {
    const res = withCheckpoint([claudeUser("違う、やり直してください")], record);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^user correction: transcript line 3$/m);
  });

  test("新しいレコードが無く、checkpoint にエージェントがあれば検証済みゼロ", () => {
    const res = withCheckpoint([], (t, b) => `${t}\n${b}\nclaude-code\n2\n`);
    expect(res.status, res.stderr).toBe(1);
    expect(res.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
    expect(res.stdout).toMatch(/^kaizen-candidate-scan: scanned-lines=2$/m);
  });

  test("新しいレコードが無く、旧形式の checkpoint でエージェントも分からなければ exit 2", () => {
    const res = withCheckpoint([], (t, b) => `${t}\n${b}\n`);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("the agent is unknown (legacy checkpoint)");
  });

  test("後から空行だけが届いたときは、新しい活動なしとして検証済みゼロにする", () => {
    const res = withCheckpoint([""], (t, b) => `${t}\n${b}\nclaude-code\n2\n`);
    expect(res.status, res.stderr).toBe(1);
    expect(res.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
  });
});

// 同じパスの編集は 2 回までは正常に起きうる（Edit の一意性の制約）ので、3 回目から候補にする。
describe("同じパスの繰り返しの編集", () => {
  test.for<[string, string[], number, number | null]>([
    ["Claude Code で 3 回", [1, 2, 3].map(() => claudeEdit("/tmp/a.md")), 0, 3],
    ["Claude Code で 2 回", [1, 2].map(() => claudeEdit("/tmp/a.md")), 1, null],
    [
      "Claude Code で別々のパスを 2 回ずつ",
      ["/tmp/a.md", "/tmp/b.md", "/tmp/a.md", "/tmp/b.md"].map(claudeEdit),
      1,
      null,
    ],
  ])("%s", ([, lines, status, line]) => {
    const dir = workdir();
    const res = scan([transcript(dir, lines), join(dir, "no-checkpoint")]);
    expect(res.status, res.stderr).toBe(status);
    if (line === null) expect(res.stdout).not.toContain("repeated edit");
    else expect(res.stdout).toMatch(new RegExp(`^repeated edit: transcript line ${line}$`, "m"));
  });

  test.each([
    ["codex-repeated-edit.jsonl", 0, 4],
    ["codex-two-edits-no-candidate.jsonl", 1, null],
    // `a-b` と `a_b` を同じ名前に正規化すると、2 回ずつの編集が 3 回と数えられる。
    ["codex-colliding-paths-repeated-edit.jsonl", 0, 4],
  ])("Codex: %s", (fixture, status, line) => {
    const dir = workdir();
    const res = scan([join(fixturesDir, fixture), join(dir, "no-checkpoint")]);
    expect(res.status, res.stderr).toBe(status);
    expect(res.stdout).toMatch(/^kaizen-candidate-scan: agent=codex$/m);
    if (line === null) expect(res.stdout).not.toContain("repeated edit");
    else {
      const evidence = res.stdout.split("\n").filter((l) => l.startsWith("repeated edit:"));
      expect(evidence).toStrictEqual([`repeated edit: transcript line ${line}`]);
    }
  });
});

test("根拠は 5 件まで出し、候補の件数は全件を数える", () => {
  const dir = workdir();
  const lines = Array.from({ length: 6 }, (_, i) => claudeUser(`違う、やり直して ${i}`));
  const res = scan([transcript(dir, lines), join(dir, "no-checkpoint")]);
  expect(res.status, res.stderr).toBe(0);
  const evidence = res.stdout.split("\n").filter((l) => l.startsWith("user correction:"));
  expect(evidence).toStrictEqual(
    [1, 2, 3, 4, 5].map((n) => `user correction: transcript line ${n}`),
  );
  expect(res.stdout).toMatch(/^kaizen-candidate-scan: 6 candidate\(s\) found$/m);
});
