// agent-usage のログの解析（Claude Code・Codex）と、稼働の区間（timeline）のテスト。
//
// 入力の軸:
//   Claude Code の user の行   origin.kind（human・task-notification・peer・その他）／origin なしの古い行（isMeta・本文の先頭のタグ）／ツールの結果。
//   応答の使用量               同じ message.id のストリーミングの複数行（欄ごとの最大）／<synthetic>／サブエージェントのファイル。
//   人を待った区間             AskUserQuestion／人が判断した権限（user_*）／設定による許可（config）。
//   cost-state                 [1m] の付いたモデル名／時刻を持たない行の前の時刻。
//   Codex                      最初の session_meta だけを使う（子のファイルは親のコピーを持つ）／token_usage_record と token_count の片方だけ。
//   timeline                   応答の途中の指示／自動の再開（外部待ち）／人を待った区間での区切り／完了の無いログ（推定）／まだ完了していない run。

import { describe, expect, test } from "vitest";
import {
  addClaudeLog,
  classifyUserEntry,
  parseClaudeSession,
} from "../../../skills/agent-usage/scripts/lib/sources/claude-log.mjs";
import {
  codexTokens,
  parseCodexLog,
} from "../../../skills/agent-usage/scripts/lib/sources/codex-log.mjs";
import { zeroTokens } from "../../../skills/agent-usage/scripts/lib/pricing.mjs";
import { emptySummary, issueOf } from "../../../skills/agent-usage/scripts/lib/sources/session.mjs";
import {
  buildRuns,
  inferTurnEnds,
} from "../../../skills/agent-usage/scripts/lib/sources/timeline.mjs";

const T = (min: number) => `2026-10-01T00:${String(min).padStart(2, "0")}:00.000Z`;
// 60 分以上は T の書式に収まらないので、0 分からの経過で求める
const ms = (min: number) => Date.parse(T(0)) + min * 60000;
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");

const human = (min: number, text = "やって") => ({
  type: "user",
  timestamp: T(min),
  origin: { kind: "human" },
  message: { role: "user", content: text },
});
const assistant = (min: number, id: string, usage: object, content: object[] = []) => ({
  type: "assistant",
  timestamp: T(min),
  message: { id, model: "claude-opus-5-5", usage, content },
});
const turnEnd = (min: number) => ({ type: "system", subtype: "turn_duration", timestamp: T(min) });

describe("classifyUserEntry", () => {
  test.each([
    ["origin が human", { origin: { kind: "human" }, message: { content: "x" } }, "human"],
    [
      "origin が task-notification",
      { origin: { kind: "task-notification" }, message: { content: "<task-notification>" } },
      "auto",
    ],
    [
      "origin が peer",
      { origin: { kind: "peer" }, message: { content: "Another Claude session" } },
      "auto",
    ],
    ["origin が知らない種類", { origin: { kind: "system" }, message: { content: "x" } }, "other"],
    ["origin なしの人の指示", { message: { content: "直して" } }, "human"],
    ["origin なしの isMeta", { isMeta: true, message: { content: "Base directory" } }, "other"],
    ["origin なしの通知", { message: { content: "<task-notification>\n" } }, "auto"],
    ["origin なしのローカルコマンド", { message: { content: "<local-command-stdout>" } }, "other"],
    ["origin なしの空の本文", { message: { content: "  " } }, "other"],
    [
      "ツールの結果",
      {
        origin: { kind: "human" },
        message: { content: [{ type: "tool_result", tool_use_id: "a" }] },
      },
      "other",
    ],
    ["配列の text", { message: { content: [{ type: "text", text: "お願い" }] } }, "human"],
  ])("%s", (_name, entry, expected) => {
    expect(classifyUserEntry(entry)).toBe(expected);
  });
});

describe("Claude Code のログ", () => {
  test("同じ message.id の複数行は欄ごとの最大を取り、<synthetic> は数えない", () => {
    const s = emptySummary("claude-code", "s1");
    addClaudeLog(
      s,
      jsonl([
        assistant(1, "m1", {
          input_tokens: 2,
          output_tokens: 10,
          cache_read_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 },
        }),
        assistant(1, "m1", {
          input_tokens: 2,
          output_tokens: 300,
          cache_read_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 },
          output_tokens_details: { thinking_tokens: 40 },
        }),
        {
          type: "assistant",
          timestamp: T(2),
          message: { id: "m2", model: "<synthetic>", usage: { output_tokens: 9 } },
        },
      ]),
      true,
    );
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].tokens).toEqual({
      input: 2,
      cacheRead: 100,
      cacheWrite5m: 0,
      cacheWrite1h: 50,
      output: 300,
      reasoning: 40,
    });
  });

  test("人の指示・自動の再開・応答の完了・予約した再開を時刻で記録する", () => {
    const s = emptySummary("claude-code", "s1");
    addClaudeLog(
      s,
      jsonl([
        human(0),
        turnEnd(5),
        {
          type: "user",
          timestamp: T(7),
          origin: { kind: "task-notification" },
          message: { content: "<task-notification>" },
        },
        { type: "system", subtype: "scheduled_task_fire", timestamp: T(9) },
      ]),
      true,
    );
    expect(s.prompts).toEqual([ms(0)]);
    expect(s.turnEnds).toEqual([ms(5)]);
    expect(s.autoResumes).toEqual([ms(7), ms(9)]);
  });

  test("AskUserQuestion と、人が判断した権限は人を待った区間にし、設定による許可は区間にしない", () => {
    const s = emptySummary("claude-code", "s1");
    const toolUse = (min: number, id: string, name: string) =>
      assistant(min, `m${id}`, { output_tokens: 1 }, [
        { type: "tool_use", id, name, input: { command: "ls" } },
      ]);
    const result = (min: number, id: string, source: string | null) => ({
      type: "user",
      timestamp: T(min),
      ...(source ? { permissionDecision: { decision: "accept", source } } : {}),
      message: { content: [{ type: "tool_result", tool_use_id: id }] },
    });
    addClaudeLog(
      s,
      jsonl([
        toolUse(1, "a", "AskUserQuestion"),
        result(4, "a", null),
        toolUse(5, "b", "Bash"),
        result(9, "b", "user_temporary"),
        toolUse(10, "c", "Bash"),
        result(11, "c", "config"),
        toolUse(12, "d", "Bash"),
        result(13, "d", "user_reject"),
      ]),
      true,
    );
    expect(s.humanWaits).toEqual([
      { start: ms(1), end: ms(4), reason: "AskUserQuestion" },
      { start: ms(5), end: ms(9), reason: "permission" },
      { start: ms(12), end: ms(13), reason: "permission" },
    ]);
    expect(s.commands).toHaveLength(4);
  });

  test("cost-state は [1m] を除いたモデル名でまとめ、直前の行の時刻を付ける", () => {
    const s = emptySummary("claude-code", "s1");
    addClaudeLog(
      s,
      jsonl([
        human(3),
        {
          type: "cost-state",
          modelUsage: {
            "claude-opus-5-5[1m]": { inputTokens: 1, outputTokens: 2, costUSD: 1.5 },
            "claude-opus-5-5": { inputTokens: 1, outputTokens: 2, costUSD: 0.5 },
            "claude-haiku-4-5-20251001": { outputTokens: 1, costUSD: 0.01 },
          },
        },
      ]),
      true,
    );
    expect(s.costSnapshots).toHaveLength(1);
    expect(s.costSnapshots[0].ts).toBe(ms(3));
    expect(s.costSnapshots[0].models["claude-opus-5-5"].costUSD).toBe(2);
    expect(s.costSnapshots[0].models["claude-haiku-4-5"].costUSD).toBe(0.01);
  });

  test("利用者が中断した応答（[Request interrupted by user]）は、指示ではなく応答の完了にする", () => {
    const s = emptySummary("claude-code", "s1");
    const lines = [
      {
        type: "user",
        timestamp: "2026-10-01T10:00:00.000Z",
        origin: { kind: "human" },
        message: { content: "やって" },
      },
      {
        type: "user",
        timestamp: "2026-10-01T10:05:00.000Z",
        message: { content: [{ type: "text", text: "[Request interrupted by user]" }] },
      },
      {
        type: "user",
        timestamp: "2026-10-01T12:05:00.000Z",
        origin: { kind: "human" },
        message: { content: "次" },
      },
    ];
    addClaudeLog(s, lines.map((l) => JSON.stringify(l)).join("\n"), true);
    expect(s.prompts).toEqual([
      Date.parse("2026-10-01T10:00:00.000Z"),
      Date.parse("2026-10-01T12:05:00.000Z"),
    ]);
    expect(s.turnEnds).toEqual([]);
    expect(s.interrupts).toEqual([Date.parse("2026-10-01T10:05:00.000Z")]);
  });

  test("サブエージェントのファイルは使用量だけを数え、指示や完了を記録しない", () => {
    const s = emptySummary("claude-code", "s1");
    addClaudeLog(s, jsonl([human(0), assistant(1, "m1", { output_tokens: 5 }), turnEnd(2)]), false);
    expect(s.messages).toHaveLength(1);
    expect(s.prompts).toEqual([]);
    expect(s.turnEnds).toEqual([]);
  });

  test("JSON として読めない行は数え、残りは読む", () => {
    const s = emptySummary("claude-code", "s1");
    addClaudeLog(s, `${JSON.stringify(human(0))}\n{broken\n${JSON.stringify(turnEnd(1))}`, true);
    expect(s.invalidLines).toBe(1);
    expect(s.turnEnds).toEqual([ms(1)]);
  });

  test("メインのファイルが無いセッションはサブエージェントとして扱う", () => {
    expect(parseClaudeSession("s1", null, []).subagent).toBe(true);
  });
});

describe("Codex のログ", () => {
  test("input からキャッシュの分を引き、output は推論を含めたまま数える", () => {
    expect(
      codexTokens({
        input_tokens: 100,
        cached_input_tokens: 30,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      }),
    ).toEqual({
      input: 70,
      cacheRead: 30,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      output: 20,
      reasoning: 5,
    });
  });

  const meta = (id: string, source: unknown) => ({
    type: "session_meta",
    timestamp: T(0),
    payload: {
      id,
      cwd: "/repo",
      source,
      git: { repository_url: "git@github.com:o/r.git", branch: "feature/1-x" },
    },
  });
  const ctx = (min: number, turn: string, model: string) => ({
    type: "turn_context",
    timestamp: T(min),
    payload: { turn_id: turn, model },
  });
  const record = (min: number, id: string, turn: string) => ({
    type: "token_usage_record",
    timestamp: T(min),
    payload: { response_id: id, turn_id: turn, usage: { input_tokens: 10, output_tokens: 1 } },
  });
  const count = (min: number) => ({
    type: "event_msg",
    timestamp: T(min),
    payload: {
      type: "token_count",
      info: { last_token_usage: { input_tokens: 7, output_tokens: 1 } },
    },
  });

  test("最初の session_meta だけを使い、子のファイルが持つ親のコピーで id を上書きしない", () => {
    const s = parseCodexLog(
      jsonl([meta("child", { subagent: "review" }), meta("parent", "cli")]),
      "file",
    );
    expect(s.sessionId).toBe("child");
    expect(s.subagent).toBe(true);
    expect(s.repoUrl).toBe("git@github.com:o/r.git");
  });

  test("token_usage_record があれば token_count を数えず、response_id で重複を除き、turn のモデルを使う", () => {
    const s = parseCodexLog(
      jsonl([
        meta("a", "cli"),
        ctx(1, "t1", "gpt-5.6-sol"),
        record(2, "r1", "t1"),
        record(2, "r1", "t1"),
        count(2),
        ctx(3, "t2", "gpt-5.5"),
        record(4, "r2", "t2"),
      ]),
      "file",
    );
    expect(s.messages.map((m) => [m.key, m.model])).toEqual([
      ["r1", "gpt-5.6-sol"],
      ["r2", "gpt-5.5"],
    ]);
  });

  test("token_usage_record の無い古いログは token_count を数え、key にファイルの id を使う", () => {
    const s = parseCodexLog(
      jsonl([meta("a", "cli"), ctx(1, "t1", "gpt-5.5"), count(2), count(3)]),
      "rollout-x",
    );
    expect(s.messages.map((m) => m.key)).toEqual(["rollout-x:3", "rollout-x:4"]);
  });

  test("累計の変わらない token_count は、同じ応答の繰り返しとして数えない", () => {
    const counted = (min: number, total: number) => ({
      type: "event_msg",
      timestamp: T(min),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: total, output_tokens: 1 },
          last_token_usage: { input_tokens: 7, output_tokens: 1 },
        },
      },
    });
    const s = parseCodexLog(
      jsonl([
        meta("a", "cli"),
        ctx(1, "t1", "gpt-5.5"),
        counted(2, 7),
        counted(2, 7),
        counted(3, 14),
      ]),
      "rollout-x",
    );
    expect(s.messages.map((m) => m.key)).toEqual(["rollout-x:3", "rollout-x:5"]);
  });

  test("人の指示・完了・中断と、request_user_input の待ちを記録する", () => {
    const s = parseCodexLog(
      jsonl([
        meta("a", "cli"),
        { type: "event_msg", timestamp: T(1), payload: { type: "user_message", message: "x" } },
        {
          type: "response_item",
          timestamp: T(2),
          payload: {
            type: "function_call",
            name: "request_user_input",
            call_id: "c1",
            arguments: "{}",
          },
        },
        {
          type: "response_item",
          timestamp: T(6),
          payload: { type: "function_call_output", call_id: "c1", output: "y" },
        },
        { type: "event_msg", timestamp: T(7), payload: { type: "task_complete" } },
        { type: "event_msg", timestamp: T(8), payload: { type: "turn_aborted" } },
      ]),
      "f",
    );
    expect(s.prompts).toEqual([ms(1)]);
    expect(s.turnEnds).toEqual([ms(7), ms(8)]);
    expect(s.humanWaits).toEqual([{ start: ms(2), end: ms(6), reason: "request_user_input" }]);
  });

  test("サブエージェントのセッションは指示と完了を持たない", () => {
    const s = parseCodexLog(
      jsonl([
        meta("a", { subagent: "review" }),
        { type: "event_msg", timestamp: T(1), payload: { type: "user_message" } },
      ]),
      "f",
    );
    expect(s.prompts).toEqual([]);
  });
});

describe("issueOf", () => {
  test.each([
    ["feature/602-agent-usage", "602"],
    ["602-x", "602"],
    ["main", ""],
    ["feature/x-602", ""],
  ])("%s", (branch, expected) => {
    expect(issueOf(branch)).toBe(expected);
  });
});

describe("buildRuns", () => {
  const summary = (parts: Partial<ReturnType<typeof emptySummary>>) => ({
    ...emptySummary("claude-code", "s"),
    ...parts,
  });

  test("完了の記録が無いログでも、中断があると推定した完了を使い続ける", () => {
    const m = (t: number) => ({ key: `m${t}`, ts: ms(t), model: "x", tokens: zeroTokens() });
    const runs = buildRuns(
      summary({
        prompts: [ms(0), ms(10), ms(20)],
        interrupts: [ms(12)],
        messages: [m(1), m(2), m(11), m(21)],
        lastTs: ms(21),
      }),
    );
    expect(runs.map((r) => [r.start, r.end])).toEqual([
      [ms(0), ms(2)],
      [ms(10), ms(12)],
      [ms(20), ms(21)],
    ]);
  });

  test("重なった人の待ち（並列のツール呼び出し）では、すべて終わってから次の run を始める", () => {
    const runs = buildRuns(
      summary({
        prompts: [ms(0)],
        humanWaits: [
          { start: ms(1), end: ms(2), reason: "permission" },
          { start: ms(1), end: ms(10), reason: "permission" },
        ],
        turnEnds: [ms(12)],
        lastTs: ms(12),
      }),
    );
    expect(runs.map((r) => [r.start, r.end])).toEqual([
      [ms(0), ms(1)],
      [ms(10), ms(12)],
    ]);
  });

  test("完了の記録が抜けたターンの後の指示は、直前の応答から 30 分を超えていれば区切る", () => {
    const m = (t: number) => ({ key: `m${t}`, ts: ms(t), model: "x", tokens: zeroTokens() });
    const runs = buildRuns(
      summary({
        prompts: [ms(0), ms(60), ms(300)],
        turnEnds: [ms(5), ms(305)],
        messages: [m(1), m(61), m(62), m(301)],
        lastTs: ms(305),
      }),
    );
    expect(runs.map((r) => [r.start, r.end])).toEqual([
      [ms(0), ms(5)],
      [ms(60), ms(62)],
      [ms(300), ms(305)],
    ]);
  });

  test("指示から完了までを 1 つの run にし、次の指示で次の run を始める", () => {
    const runs = buildRuns(
      summary({ prompts: [ms(0), ms(20)], turnEnds: [ms(5), ms(25)], lastTs: ms(25) }),
    );
    expect(runs.map((r) => [r.start, r.end, r.waitMs, r.open])).toEqual([
      [ms(0), ms(5), 0, false],
      [ms(20), ms(25), 0, false],
    ]);
  });

  test("応答の途中の指示は区切らない", () => {
    const runs = buildRuns(summary({ prompts: [ms(0), ms(2)], turnEnds: [ms(5)], lastTs: ms(5) }));
    expect(runs).toHaveLength(1);
    expect(runs[0].end).toBe(ms(5));
  });

  test("自動の再開では区切らず、完了から再開までを外部待ちとして数える", () => {
    const runs = buildRuns(
      summary({
        prompts: [ms(0)],
        turnEnds: [ms(5), ms(30)],
        autoResumes: [ms(25)],
        lastTs: ms(30),
      }),
    );
    expect(runs).toHaveLength(1);
    expect([runs[0].start, runs[0].end, runs[0].waitMs]).toEqual([ms(0), ms(30), ms(20) - ms(0)]);
  });

  test("人を待った区間の始まりで run を終え、終わりで新しい run を始める", () => {
    const runs = buildRuns(
      summary({
        prompts: [ms(0)],
        turnEnds: [ms(30)],
        humanWaits: [{ start: ms(10), end: ms(20), reason: "AskUserQuestion" }],
        lastTs: ms(30),
      }),
    );
    expect(runs.map((r) => [r.start, r.end, r.trigger])).toEqual([
      [ms(0), ms(10), "prompt"],
      [ms(20), ms(30), "human-wait"],
    ]);
  });

  test("最後の run がまだ完了していなければ、ログの最後の時刻までの open にする", () => {
    const runs = buildRuns(
      summary({ prompts: [ms(0)], turnEnds: [], messages: [], lastTs: ms(9) }),
    );
    expect(runs).toEqual([{ start: ms(0), end: ms(9), waitMs: 0, open: true, trigger: "prompt" }]);
  });

  test("完了の記録が無いログは、次の区切りの前の最後の応答を完了とみなす", () => {
    const m = (min: number) => ({
      key: `k${min}`,
      ts: ms(min),
      model: "x",
      tokens: { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, reasoning: 0 },
    });
    const s = summary({
      prompts: [ms(0), ms(20)],
      messages: [m(1), m(4), m(21), m(23)],
      lastTs: ms(23),
    });
    expect(inferTurnEnds(s)).toEqual([ms(4), ms(23)]);
    expect(buildRuns(s).map((r) => [r.start, r.end])).toEqual([
      [ms(0), ms(4)],
      [ms(20), ms(23)],
    ]);
  });

  test("サブエージェントのセッションは run を作らない", () => {
    expect(buildRuns(summary({ subagent: true, prompts: [ms(0)], turnEnds: [ms(1)] }))).toEqual([]);
  });
});
