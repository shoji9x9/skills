// agent-usage のログの解析（Claude Code・Codex）と、稼働の区間（timeline）のテスト。
//
// 入力の軸:
//   Claude Code の user の行   origin.kind（human・task-notification・peer・その他）／origin なしの古い行（isMeta・本文の先頭のタグ）／ツールの結果。
//   応答の使用量               同じ message.id のストリーミングの複数行（欄ごとの最大）／<synthetic>／サブエージェントのファイル。
//   人を待った区間             AskUserQuestion／人が判断した権限（user_*）／設定による許可（config）。
//   cost-state                 [1m] の付いたモデル名／時刻を持たない行の前の時刻。
//   Codex                      最初の session_meta だけを使う（子のファイルは親のコピーを持つ）／token_usage_record と token_count の片方だけ。
//   timeline                   応答の途中の指示／自動の再開（外部待ち）／人を待った区間での区切り／完了の無いログ（推定）／まだ完了していない run。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { classifyUserEntry } from "../../../skills/agent-usage/scripts/lib/sources/claude-log.mjs";
import {
  codexTokens,
  parseCodexLog,
  parseCodexSession,
} from "../../../skills/agent-usage/scripts/lib/sources/codex-log.mjs";
import { zeroTokens } from "../../../skills/agent-usage/scripts/lib/pricing.mjs";
import { emptySummary, issueOf } from "../../../skills/agent-usage/scripts/lib/sources/session.mjs";
import { buildRuns } from "../../../skills/agent-usage/scripts/lib/sources/timeline.mjs";
import {
  discoverClaude,
  discoverCodex,
  encodeProjectPath,
} from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { isInside } from "../../../skills/agent-usage/scripts/lib/repo.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { T, ms, jsonl, human, assistant, turnEnd, parseClaude } from "./logs-helpers.ts";

// classifyUserEntry の戻り値は、user の行が prompt の行（human）になるか、自動の再開（auto）か、どちらでもない（other）かの判定と同じ意味を持つ。
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
    const s = parseClaude([
      assistant(1, "m1", {
        usage: {
          input_tokens: 2,
          output_tokens: 10,
          cache_read_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 },
        },
      }),
      assistant(1, "m1", {
        usage: {
          input_tokens: 2,
          output_tokens: 300,
          cache_read_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 },
          output_tokens_details: { thinking_tokens: 40 },
        },
      }),
      {
        type: "assistant",
        timestamp: T(2),
        message: { id: "m2", model: "<synthetic>", usage: { output_tokens: 9 } },
      },
    ]);
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
    const s = parseClaude([
      human(0),
      turnEnd(5),
      {
        type: "user",
        timestamp: T(7),
        origin: { kind: "task-notification" },
        message: { content: "<task-notification>" },
      },
      { type: "system", subtype: "scheduled_task_fire", timestamp: T(9) },
    ]);
    expect(s.prompts).toEqual([ms(0)]);
    expect(s.turnEnds).toEqual([ms(5)]);
    expect(s.autoResumes).toEqual([ms(7), ms(9)]);
  });

  test("AskUserQuestion と、人が判断した権限は人を待った区間にし、設定による許可は区間にしない", () => {
    const toolUse = (min: number, id: string, name: string) =>
      assistant(min, `m${id}`, {
        usage: { output_tokens: 1 },
        content: [{ type: "tool_use", id, name, input: { command: "ls" } }],
      });
    const result = (min: number, id: string, source: string | null) => ({
      type: "user",
      timestamp: T(min),
      ...(source ? { permissionDecision: { decision: "accept", source } } : {}),
      message: { content: [{ type: "tool_result", tool_use_id: id }] },
    });
    const s = parseClaude([
      toolUse(1, "a", "AskUserQuestion"),
      result(4, "a", null),
      toolUse(5, "b", "Bash"),
      result(9, "b", "user_temporary"),
      toolUse(10, "c", "Bash"),
      result(11, "c", "config"),
      toolUse(12, "d", "Bash"),
      result(13, "d", "user_reject"),
    ]);
    expect(s.humanWaits).toEqual([
      { start: ms(1), end: ms(4), reason: "AskUserQuestion" },
      { start: ms(5), end: ms(9), reason: "permission" },
      { start: ms(12), end: ms(13), reason: "permission" },
    ]);
    expect(s.commands).toHaveLength(4);
  });

  test("cost-state は [1m] を除いたモデル名でまとめ、直前の行の時刻を付ける", () => {
    const s = parseClaude([
      human(3),
      {
        type: "cost-state",
        modelUsage: {
          "claude-opus-5-5[1m]": { inputTokens: 1, outputTokens: 2, costUSD: 1.5 },
          "claude-opus-5-5": { inputTokens: 1, outputTokens: 2, costUSD: 0.5 },
          "claude-haiku-4-5-20251001": { outputTokens: 1, costUSD: 0.01 },
        },
      },
    ]);
    expect(s.costSnapshots).toHaveLength(1);
    expect(s.costSnapshots[0].ts).toBe(ms(3));
    expect(s.costSnapshots[0].models["claude-opus-5-5"].costUSD).toBe(2);
    expect(s.costSnapshots[0].models["claude-haiku-4-5"].costUSD).toBe(0.01);
  });

  test("利用者が中断した応答（[Request interrupted by user]）は、指示ではなく応答の完了にする", () => {
    const s = parseClaude([
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
    ]);
    expect(s.prompts).toEqual([
      Date.parse("2026-10-01T10:00:00.000Z"),
      Date.parse("2026-10-01T12:05:00.000Z"),
    ]);
    expect(s.turnEnds).toEqual([]);
    expect(s.interrupts).toEqual([Date.parse("2026-10-01T10:05:00.000Z")]);
  });

  test("サブエージェントのファイルは使用量だけを数え、指示や完了を記録しない", () => {
    const s = parseClaude(
      [],
      [[human(0), assistant(1, "m1", { usage: { output_tokens: 5 } }), turnEnd(2)]],
    );
    expect(s.subagent).toBe(false);
    expect(s.messages.map((m) => m.key)).toEqual(["m1"]);
    expect(s.prompts).toEqual([]);
    expect(s.turnEnds).toEqual([]);
  });

  test("JSON として読めない行は数え、残りは読む", () => {
    const s = parseClaude(
      `${JSON.stringify(human(0))}\n{broken\n[1]\n${JSON.stringify(turnEnd(1))}`,
    );
    expect(s.invalidLines).toBe(2);
    expect(s.prompts).toEqual([ms(0)]);
    expect(s.turnEnds).toEqual([ms(1)]);
  });

  test("メインのファイルが無いセッションはサブエージェントとして扱う", () => {
    expect(parseClaude(null).subagent).toBe(true);
  });
});

describe("Codex のログ", () => {
  test("input からキャッシュの分を引き、output は推論を含めたまま数える", () => {
    // codexTokens の戻り値は、usage の行の input_tokens・cache_read_tokens・output_tokens・reasoning_tokens になる。
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

  test("ファイルから読み、JSON として読めない行と object でない行を数え、時刻の無い行は飛ばす", () => {
    const dir = makeTempDir("agent-usage-codex-log-");
    const path = join(dir, "rollout-x.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify(meta("a", "cli")),
        "{broken",
        "[1]",
        JSON.stringify({ type: "event_msg", payload: { type: "user_message" } }),
        JSON.stringify({ type: "event_msg", timestamp: T(2), payload: { type: "user_message" } }),
      ].join("\n"),
    );
    const s = parseCodexSession(path, "rollout-x");
    expect(s.sessionId).toBe("a");
    expect(s.invalidLines).toBe(2);
    expect(s.prompts).toEqual([ms(2)]);
  });

  test("turn_id の無い応答は直前の turn のモデルを使い、モデルが分からない応答と response_id の無い応答は数えない", () => {
    const usage = { input_tokens: 1, output_tokens: 1 };
    const s = parseCodexLog(
      jsonl([
        meta("a", "cli"),
        { type: "token_usage_record", timestamp: T(1), payload: { response_id: "r0", usage } },
        { type: "turn_context", timestamp: T(2), payload: { model: "gpt-5.5", cwd: "/repo/sub" } },
        { type: "token_usage_record", timestamp: T(3), payload: { response_id: "", usage } },
        { type: "token_usage_record", timestamp: T(4), payload: { response_id: "r1", usage } },
      ]),
      "f",
    );
    expect(s.messages.map((m) => [m.key, m.model])).toEqual([["r1", "gpt-5.5"]]);
    expect(s.cwds).toEqual(["/repo", "/repo/sub"]);
  });

  test("info の無い token_count と、モデルが分かる前の token_count は数えない", () => {
    const s = parseCodexLog(
      jsonl([
        meta("a", "cli"),
        count(1),
        ctx(2, "t1", "gpt-5.5"),
        { type: "event_msg", timestamp: T(3), payload: { type: "token_count" } },
        count(4),
      ]),
      "rollout-x",
    );
    expect(s.messages.map((m) => m.key)).toEqual(["rollout-x:5"]);
  });

  test("custom_tool_call の input をコマンドとして記録し、本文の無い呼び出しは記録しない。custom_tool_call_output で待ちを閉じる", () => {
    const item = (min: number, payload: object) => ({
      type: "response_item",
      timestamp: T(min),
      payload,
    });
    const s = parseCodexLog(
      jsonl([
        meta("a", "cli"),
        item(1, {
          type: "custom_tool_call",
          name: "request_user_input",
          call_id: "c1",
          input: "q",
        }),
        item(2, { type: "function_call", name: "shell" }),
        item(3, { type: "custom_tool_call_output", output: "no id" }),
        item(5, { type: "custom_tool_call_output", call_id: "c1", output: "a" }),
      ]),
      "f",
    );
    expect(s.commands).toEqual([{ ts: ms(1), text: "q" }]);
    expect(s.humanWaits).toEqual([{ start: ms(1), end: ms(5), reason: "request_user_input" }]);
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

describe("ログの探索", () => {
  const sessionMeta = (payload: object) => JSON.stringify({ type: "session_meta", payload });
  function codexDir() {
    const home = makeTempDir("agent-usage-codex-home-");
    const day = join(home, "sessions", "2026", "10", "01");
    mkdirSync(day, { recursive: true });
    return { home, day };
  }
  const ids = (sources: { id: string }[]) => sources.map((x) => x.id).sort();

  test("Codex: cwd がルートの中にあるか、リモートが一致するログだけを返し、最初の行が session_meta でないログは飛ばす", () => {
    const { home, day } = codexDir();
    const write = (name: string, first: string) =>
      writeFileSync(join(day, name), `${first}\n{"type":"event_msg"}\n`);
    write("rollout-in.jsonl", sessionMeta({ id: "in", cwd: "/repo/wt" }));
    write(
      "rollout-remote.jsonl",
      sessionMeta({
        id: "remote",
        cwd: "/elsewhere",
        git: { repository_url: "git@github.com:O/R.git" },
      }),
    );
    write(
      "rollout-out.jsonl",
      sessionMeta({ id: "out", cwd: "/other", git: { repository_url: "" } }),
    );
    write("rollout-noid.jsonl", sessionMeta({ cwd: "/repo" }));
    write("rollout-broken.jsonl", "{broken");
    write(
      "rollout-notmeta.jsonl",
      JSON.stringify({ type: "event_msg", payload: { cwd: "/repo" } }),
    );
    write("rollout-nopayload.jsonl", JSON.stringify({ type: "session_meta", payload: "x" }));
    writeFileSync(join(day, "notes.txt"), sessionMeta({ id: "txt", cwd: "/repo" }));
    const found = discoverCodex({
      roots: ["/repo"],
      remote: "github.com/o/r",
      env: { CODEX_HOME: home },
      inside: isInside,
    });
    expect(ids(found)).toEqual(["in", "remote", "rollout-noid"]);
    expect(found.every((x) => x.agent === "codex" && x.subagents.length === 0)).toBe(true);
  });

  test("Codex: リモートが分からなければ、URL の無いログをリモートの一致として扱わない", () => {
    const { home, day } = codexDir();
    writeFileSync(join(day, "rollout-a.jsonl"), `${sessionMeta({ id: "a", cwd: "/other" })}\n`);
    expect(
      discoverCodex({ roots: ["/repo"], remote: "", env: { CODEX_HOME: home }, inside: isInside }),
    ).toEqual([]);
  });

  test("Codex: ログのディレクトリが無ければ空を返す", () => {
    const env = { AGENT_USAGE_CODEX_SESSIONS: join(makeTempDir("agent-usage-none-"), "missing") };
    expect(
      discoverCodex({ roots: ["/repo"], remote: "github.com/o/r", env, inside: isInside }),
    ).toEqual([]);
  });

  test("Codex: 最初の行が読み込みの塊の境目で複数バイトの文字を分けても、文字を壊さずに読む", () => {
    const { home, day } = codexDir();
    const prefix = '{"type":"session_meta","payload":{"id":"';
    // 「あ」（3 バイト）が 65535 バイト目から始まり、64 KiB の塊の境目をまたぐようにする
    const id = `${"a".repeat(65535 - prefix.length)}あ`;
    writeFileSync(join(day, "rollout-long.jsonl"), `${prefix}${id}","cwd":"/repo"}}\nnot json\n`);
    const found = discoverCodex({
      roots: ["/repo"],
      remote: "",
      env: { CODEX_HOME: home },
      inside: isInside,
    });
    expect(found.map((x) => x.id)).toEqual([id]);
  });

  test("Codex: 改行の無いまま 4 MiB を超える最初の行は読み切らず、そのログを飛ばす", () => {
    const { home, day } = codexDir();
    const meta = sessionMeta({ id: "big", cwd: "/repo", pad: "x".repeat(4.5 * 1024 * 1024) });
    writeFileSync(join(day, "rollout-big.jsonl"), meta);
    writeFileSync(join(day, "rollout-small.jsonl"), sessionMeta({ id: "small", cwd: "/repo" }));
    expect(
      ids(
        discoverCodex({
          roots: ["/repo"],
          remote: "",
          env: { CODEX_HOME: home },
          inside: isInside,
        }),
      ),
    ).toEqual(["small"]);
  });

  test("Claude Code: サブエージェントのファイルしか無いセッションは、ディレクトリ名が作業ツリーと一致するときだけ返す", () => {
    const config = makeTempDir("agent-usage-claude-home-");
    const projects = join(config, "projects");
    const exact = join(projects, encodeProjectPath("/repo"));
    const prefixed = join(projects, encodeProjectPath("/repo-other"));
    mkdirSync(join(exact, "s-main", "subagents"), { recursive: true });
    mkdirSync(join(exact, "s-sub", "subagents"), { recursive: true });
    mkdirSync(join(exact, "s-empty", "subagents"), { recursive: true });
    mkdirSync(join(prefixed, "s-other", "subagents"), { recursive: true });
    writeFileSync(join(exact, "s-main.jsonl"), "");
    writeFileSync(join(exact, "s-main", "subagents", "agent-1.jsonl"), "");
    writeFileSync(join(exact, "s-sub", "subagents", "agent-2.jsonl"), "");
    writeFileSync(join(prefixed, "s-other", "subagents", "agent-3.jsonl"), "");
    writeFileSync(join(projects, "file.jsonl"), "");
    const found = discoverClaude(["/repo"], { CLAUDE_CONFIG_DIR: config });
    expect(
      found
        .map((x) => [x.id, x.main !== null, x.subagents.length])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["s-main", true, 1],
      ["s-sub", false, 1],
    ]);
  });

  test("Claude Code: プロジェクトのディレクトリが無ければ空を返す", () => {
    const env = { AGENT_USAGE_CLAUDE_PROJECTS: join(makeTempDir("agent-usage-none-"), "missing") };
    expect(discoverClaude(["/repo"], env)).toEqual([]);
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
    expect(buildRuns(s).map((r) => [r.start, r.end])).toEqual([
      [ms(0), ms(4)],
      [ms(20), ms(23)],
    ]);
  });

  test("サブエージェントのセッションは run を作らない", () => {
    expect(buildRuns(summary({ subagent: true, prompts: [ms(0)], turnEnds: [ms(1)] }))).toEqual([]);
  });
});
