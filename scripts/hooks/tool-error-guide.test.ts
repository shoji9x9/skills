// ツールの失敗に規約を案内する PostToolUseFailure の Hook の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                          |
// | -------------- | --------------------------------------------------------------------------- |
// | 入力           | 正常な Hook JSON / 不正な JSON / オブジェクトでない JSON / Copilot の入力       |
// | 中断           | is_interrupt が true / false / 欠落                                          |
// | tool_name      | 文字列 / 欠落 / 空 / 文字列でない                                             |
// | error          | 文字列 / 欠落 / 空 / 文字列でない                                             |
// | 行の絞り込み   | error だけ / error と tool / error と tool と input                           |
// | 一致           | 0 行 / 1 行 / 2 行 / error は一致して tool か input が一致しない              |
// | 一覧           | 読める / 無い / JSON でない / guides が無い / 行の形の誤り / 正規表現の誤り / id の重複 |
// | 繰り返し       | 初回 / 同じ呼び出しと同じエラーの 2 回目 / 違うエラー / 違うツール / 違う入力 / 違うセッション / 間に別の失敗 |
// | 記録の場所     | 書ける / session_id が使えない形 / ディレクトリ / シンボリックリンク / 置き場所が無い |
//
// 案内を出さない入力を、出す入力と同じ数以上置く。出す入力だけでは、「どの失敗にも案内を出す実装」と区別できない。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isNonEmptyString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import {
  GUIDES_PATH,
  REPEAT_GUIDE,
  failureOf,
  lastFailurePath,
  main,
  matchGuides,
  parseGuides,
} from "./tool-error-guide.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../..");

let dir = "";
let guidesPath = "";
let stateDir = "";
let out: string[] = [];
let errors: string[] = [];
beforeEach(() => {
  dir = makeTempDir("tool-error-guide-");
  guidesPath = join(dir, "guides.json");
  stateDir = join(dir, "state");
  mkdirSync(stateDir);
  writeFileSync(guidesPath, JSON.stringify({ guides: GUIDES }));
  out = [];
  errors = [];
  vi.stubEnv("COPILOT_CLI", "");
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const GUIDES = [
  { id: "only-error", error: "too complex to verify", guide: "スクリプトにする。", rule: "a.md" },
  {
    id: "with-tool",
    tool: "^Bash$",
    error: "substring not found",
    guide: "読み直す。",
    rule: "b.md",
  },
  {
    id: "with-input",
    tool: "^Bash$",
    error: "AssertionError",
    input: "\\.replace\\(",
    guide: "置換元を読み直す。",
    rule: "c.md",
  },
];

const hook = (fields: Record<string, unknown>) =>
  JSON.stringify({
    hook_event_name: "PostToolUseFailure",
    session_id: "s",
    tool_name: "Bash",
    tool_input: { command: "echo" },
    error: "Exit code 1",
    ...fields,
  });

const run = (fields: Record<string, unknown>) => main(hook(fields), guidesPath, stateDir);

/** stdout に出した additionalContext。出していなければ null。 */
function context(): string | null {
  if (out.length === 0) return null;
  const parsed: unknown = JSON.parse(out.join(""));
  if (!isRecord(parsed) || !isRecord(parsed.hookSpecificOutput)) throw new Error("出力の形が違う");
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUseFailure");
  const value = parsed.hookSpecificOutput.additionalContext;
  if (typeof value !== "string") throw new Error("additionalContext が文字列でない");
  return value;
}

test.each([
  ["error だけの行", { error: "this command is too complex to verify" }, ["only-error"]],
  ["tool で絞る行", { error: "ValueError: substring not found" }, ["with-tool"]],
  [
    "tool と input で絞る行",
    { error: "AssertionError: x", tool_input: { command: "s.replace(a, b)" } },
    ["with-input"],
  ],
  [
    "2 行に一致",
    { error: "too complex to verify; substring not found" },
    ["only-error", "with-tool"],
  ],
])("一覧の行に一致するエラーで案内を渡す（%s）", (_name, fields, ids) => {
  expect(run(fields)).toBe(0);
  const text = context();
  for (const id of ids) expect(text).toContain(`tool-error-guide（${id}）`);
  expect(text?.split("\n")).toHaveLength(ids.length);
  expect(text).not.toContain(REPEAT_GUIDE);
});

test("案内には、行の案内の文と規約の場所を入れる", () => {
  expect(run({ error: "too complex to verify" })).toBe(0);
  expect(context()).toBe("tool-error-guide（only-error）: スクリプトにする。 規約: a.md");
});

test.each([
  ["どの行にも一致しない", { error: "Exit code 1\nls: cannot access" }],
  ["error は一致するが tool が一致しない", { tool_name: "Edit", error: "substring not found" }],
  [
    "error と tool は一致するが input が一致しない",
    { error: "AssertionError: 1 != 2", tool_input: { command: "pytest" } },
  ],
  [
    "input が欠落していて、input で絞る行に当たらない",
    { error: "AssertionError", tool_input: undefined },
  ],
  ["中断された", { error: "too complex to verify", is_interrupt: true }],
  ["error が欠落", { error: undefined }],
  ["error が空", { error: "" }],
  ["error が文字列でない", { error: 1 }],
  ["tool_name が欠落", { tool_name: undefined, error: "too complex to verify" }],
  ["tool_name が文字列でない", { tool_name: 1, error: "too complex to verify" }],
])("案内を渡さない（%s）", (_name, fields) => {
  expect(run(fields)).toBe(0);
  expect(out).toEqual([]);
  expect(errors).toEqual([]);
});

test("is_interrupt が false なら案内を渡す", () => {
  expect(run({ error: "too complex to verify", is_interrupt: false })).toBe(0);
  expect(context()).toContain("only-error");
});

test("Copilot の入力では、照合も記録もせずに通す", () => {
  vi.stubEnv("COPILOT_CLI", "1");
  expect(run({ error: "too complex to verify", timestamp: 1 })).toBe(0);
  expect(out).toEqual([]);
  const path = lastFailurePath("s", stateDir);
  expect(path && existsSync(path)).toBe(false);
});

test.each([
  ["不正な JSON", "{"],
  ["オブジェクトでない JSON", "[]"],
])("入力を読めないときは 1 で終え、案内を渡さない（%s）", (_name, input) => {
  expect(main(input, guidesPath, stateDir)).toBe(1);
  expect(out).toEqual([]);
});

test.each([
  ["無い", null, "ENOENT"],
  ["JSON でない", "{", "JSON"],
  ["guides が無い", "{}", "guides の配列が無い"],
  ["行がオブジェクトでない", '{"guides":[1]}', "guides[0] がオブジェクトでない"],
  ["id が無い", '{"guides":[{"error":"x","guide":"g","rule":"r"}]}', "guides[0]: id"],
  ["error が無い", '{"guides":[{"id":"a","guide":"g","rule":"r"}]}', "a: error が無い"],
  ["guide が空", '{"guides":[{"id":"a","error":"x","guide":"","rule":"r"}]}', "a: guide"],
  ["rule が無い", '{"guides":[{"id":"a","error":"x","guide":"g"}]}', "a: rule"],
  [
    "正規表現の誤り",
    '{"guides":[{"id":"a","error":"(","guide":"g","rule":"r"}]}',
    "a: error の正規表現",
  ],
  [
    "tool が文字列でない",
    '{"guides":[{"id":"a","tool":1,"error":"x","guide":"g","rule":"r"}]}',
    "a: tool",
  ],
  [
    "id の重複",
    '{"guides":[{"id":"a","error":"x","guide":"g","rule":"r"},{"id":"a","error":"y","guide":"g","rule":"r"}]}',
    "a: id が重複",
  ],
])("一覧を読めないときは理由を出して 1 で終える（%s）", (_name, text, reason) => {
  if (text === null) rmSync(guidesPath);
  else writeFileSync(guidesPath, text);
  expect(run({ error: "too complex to verify" })).toBe(1);
  expect(out).toEqual([]);
  expect(errors.join("\n")).toContain(reason);
});

test("同じエラーが 2 回続いたら、別のやり方を求める案内を渡す（一覧に一致しないエラーでも）", () => {
  const fields = { error: "Exit code 1\nls: cannot access" };
  expect(run(fields)).toBe(0);
  expect(out).toEqual([]);
  expect(run(fields)).toBe(0);
  expect(context()).toBe(REPEAT_GUIDE);
});

test("一覧に一致するエラーが 2 回続いたら、行の案内と繰り返しの案内の両方を渡す", () => {
  run({ error: "too complex to verify" });
  out = [];
  run({ error: "too complex to verify" });
  expect(context()?.split("\n")).toEqual([
    "tool-error-guide（only-error）: スクリプトにする。 規約: a.md",
    REPEAT_GUIDE,
  ]);
});

test.each([
  ["違うエラー", { error: "Exit code 2" }],
  ["同じエラーで違うツール", { tool_name: "Read" }],
  ["同じエラーで違う入力", { tool_input: { command: "grep x" } }],
  ["違うセッション", { session_id: "t" }],
])("直前と違う失敗では繰り返しの案内を渡さない（%s）", (_name, second) => {
  run({ error: "Exit code 1" });
  run({ error: "Exit code 1", ...second });
  expect(out).toEqual([]);
});

test.each([
  ["親とサブエージェント", {}, { agent_id: "a1" }],
  ["別のサブエージェント", { agent_id: "a1" }, { agent_id: "a2" }],
])(
  "同じセッションでも、エージェントが違えば繰り返しとして数えない（%s）",
  (_name, first, second) => {
    run({ error: "Exit code 1", ...first });
    run({ error: "Exit code 1", ...second });
    expect(out).toEqual([]);
  },
);

test("同じサブエージェントの同じ失敗は、繰り返しとして案内する", () => {
  run({ error: "Exit code 1", agent_id: "a1" });
  run({ error: "Exit code 1", agent_id: "a1" });
  expect(context()).toBe(REPEAT_GUIDE);
});

test.each([
  ["パスの区切りを含む", "../x"],
  ["文字列でない", 1],
  ["空文字", ""],
])("agent_id が使えない形なら繰り返しを判定しない（%s）", (_name, agentId) => {
  run({ agent_id: agentId });
  run({ agent_id: agentId });
  expect(out).toEqual([]);
  expect(lastFailurePath("s", stateDir, agentId)).toBeNull();
});

test("間に別のエラーを挟んだら、繰り返しとして数えない", () => {
  run({ error: "Exit code 1" });
  run({ error: "Exit code 2" });
  run({ error: "Exit code 1" });
  expect(out).toEqual([]);
});

test.each([
  ["パスの区切りを含む", "../x"],
  ["文字列でない", 1],
  ["空文字", ""],
])("session_id が使えない形なら繰り返しを判定しない（%s）", (_name, sessionId) => {
  run({ session_id: sessionId });
  run({ session_id: sessionId });
  expect(out).toEqual([]);
  expect(lastFailurePath(sessionId, stateDir)).toBeNull();
});

function recordPath(): string {
  const path = lastFailurePath("s", stateDir);
  if (!path) throw new Error("記録のパスを作れない");
  return path;
}

test("記録の名前がディレクトリなら、繰り返しを判定しない", () => {
  mkdirSync(recordPath());
  run({});
  run({});
  expect(out).toEqual([]);
  expect(errors.join("\n")).toContain("読み書きできない");
});

test("記録の名前がシンボリックリンクなら、辿らずに繰り返しを判定しない", () => {
  const target = join(dir, "target");
  writeFileSync(target, "keep");
  symlinkSync(target, recordPath());
  run({});
  run({});
  expect(out).toEqual([]);
  expect(readFileSync(target, "utf8")).toBe("keep");
  expect(errors.join("\n")).toContain("読み書きできない");
});

test("記録の置き場所が無ければ、繰り返しを判定せずに案内だけを渡す", () => {
  expect(main(hook({ error: "too complex to verify" }), guidesPath, join(dir, "missing"))).toBe(0);
  expect(context()).toContain("only-error");
  expect(errors.join("\n")).toContain("読み書きできない");
});

test("記録は今回の失敗だけで上書きする（前の記録が長くても、後ろが残らない）", () => {
  writeFileSync(recordPath(), "z".repeat(200));
  run({});
  expect(readFileSync(recordPath(), "utf8")).toMatch(/^[0-9a-f]{64}$/);
});

test("failureOf は tool_input を JSON の文字列にする", () => {
  expect(failureOf({ tool_name: "Bash", error: "e", tool_input: { command: "a" } })).toEqual({
    toolName: "Bash",
    error: "e",
    input: '{"command":"a"}',
  });
});

test("CLI: 一致する失敗で additionalContext を stdout に出して 0 で終える", () => {
  const res = spawnSync(process.execPath, [join(HERE, "tool-error-guide.ts")], {
    input: hook({
      session_id: "cli",
      error:
        "this command names git in a form too complex to verify that it stays inside the worktree",
    }),
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
    env: { ...process.env, TMPDIR: stateDir, COPILOT_CLI: "" },
  });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("worktree-compound-git");
});

test("CLI: 入力を読めないときは 1 で終える", () => {
  const res = spawnSync(process.execPath, [join(HERE, "tool-error-guide.ts")], {
    input: "{",
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
    env: { ...process.env, TMPDIR: stateDir, COPILOT_CLI: "" },
  });
  expect(res.status).toBe(1);
  expect(res.stdout).toBe("");
  expect(res.stderr).toContain("入力の JSON を読めない");
});

// 一覧の実物の各行が、その行の例に一致し、一致しない例に一致しないことと、規約の場所のファイルが在ることを確かめる。
// 一覧に行を足す人（kaizen の apply を含む）は、行に examples と non_examples を書く。
type Example = { tool_name: string; error: string; tool_input?: unknown };
const isExample = (e: unknown): e is Example =>
  isRecord(e) && isNonEmptyString(e.tool_name) && isNonEmptyString(e.error);

function realRows(): Record<string, unknown>[] {
  const data: unknown = JSON.parse(readFileSync(GUIDES_PATH, "utf8"));
  if (!isRecord(data) || !isArray(data.guides)) throw new Error("guides の配列が無い");
  return data.guides.filter(isRecord);
}

function examplesOf(row: Record<string, unknown>, key: string): Example[] {
  const list = row[key];
  if (!isArray(list) || list.length === 0 || !list.every(isExample)) {
    throw new Error(`${String(row.id)}: ${key} が空でない例の配列でない`);
  }
  return list;
}

const idsOf = (example: Example) =>
  matchGuides(parseGuides(readFileSync(GUIDES_PATH, "utf8")), {
    toolName: example.tool_name,
    error: example.error,
    input: JSON.stringify(example.tool_input ?? null),
  }).map((g) => g.id);

test("実リポジトリの一覧を読め、各行が examples に一致し non_examples に一致しない", () => {
  const rows = realRows();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    for (const example of examplesOf(row, "examples")) expect(idsOf(example)).toContain(row.id);
    for (const example of examplesOf(row, "non_examples")) {
      expect(idsOf(example)).not.toContain(row.id);
    }
  }
});

test("実リポジトリの一覧の各行の規約の場所は、リポジトリに在るファイルと見出しを指す", () => {
  for (const row of realRows()) {
    const match = /^([^「]+)(?:「(.+)」)?$/.exec(String(row.rule));
    expect(match, `${String(row.id)}: rule の形`).not.toBeNull();
    const [, file = "", heading] = match ?? [];
    const path = join(REPO_ROOT, file);
    expect(existsSync(path), `${String(row.id)}: ${file}`).toBe(true);
    if (heading === undefined) continue;
    const headings = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => line.replace(/^#{1,6} /, ""));
    expect(headings, `${String(row.id)}: ${heading}`).toContain(heading);
  }
});
