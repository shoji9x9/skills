import { describe, expect, test } from "vitest";

import {
  normalizeTrace,
  parseClaudeTrace,
  parseCodexTrace,
} from "./normalize-skill-eval-result.js";

describe("skill eval result normalization", () => {
  test("normalizes Claude Code final JSON and cache token fields", () => {
    const parsed = parseClaudeTrace(
      JSON.stringify({
        result: "claude response",
        is_error: false,
        num_turns: 2,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 40,
        },
      }),
    );

    expect(parsed.finalResponse).toBe("claude response");
    expect(parsed.usage).toEqual({
      input_tokens: 100,
      cached_input_tokens: 30,
      cache_write_input_tokens: 20,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      total_tokens: 190,
    });
    expect(parsed.totalSteps).toBe(2);
    expect(parsed.toolCalls).toBeNull();
    expect(parsed.totalToolCalls).toBeNull();
  });

  test("normalizes Codex JSONL, retaining the last agent message and usage", () => {
    const parsed = parseCodexTrace(
      [
        { type: "thread.started", thread_id: "thread-1" },
        { type: "item.completed", item: { type: "agent_message", text: "progress" } },
        {
          type: "item.completed",
          item: { type: "command_execution", command: "true", exit_code: 0 },
        },
        { type: "item.completed", item: { type: "agent_message", text: "codex response" } },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 60,
            cache_write_input_tokens: 5,
            output_tokens: 40,
            reasoning_output_tokens: 10,
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );

    expect(parsed.finalResponse).toBe("codex response");
    expect(parsed.usage.total_tokens).toBe(215);
    expect(parsed.usage.cached_input_tokens).toBe(60);
    expect(parsed.toolCalls).toEqual({ command_execution: 1 });
    expect(parsed.totalToolCalls).toBe(1);
  });

  test("fails closed when a successful executor trace has no final response", () => {
    const normalized = normalizeTrace({
      executor: "codex",
      rawText: `${JSON.stringify({ type: "turn.completed", usage: {} })}\n`,
      exitCode: 0,
      model: "gpt-test",
      reasoningEffort: "high",
      cliVersion: "codex-cli test",
      harnessVersion: "run-skill-eval/1",
      rawTrace: "raw/codex.jsonl",
      durationMs: 1500,
      startedAt: "2026-08-27T00:00:00.000Z",
      endedAt: "2026-08-27T00:00:01.500Z",
    });

    expect(normalized.result.status).toBe("failed");
    expect(normalized.result.normalization_error).toMatch(/no final response/u);
    expect(normalized.metrics).not.toHaveProperty("files_created");
  });

  test("fails closed when Codex reports a tool-host error despite exit zero", () => {
    const rawText = [
      { type: "item.completed", item: { type: "error", message: "tool host unavailable" } },
      { type: "item.completed", item: { type: "agent_message", text: "used an assumption" } },
      { type: "turn.completed", usage: {} },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const normalized = normalizeTrace({
      executor: "codex",
      rawText,
      exitCode: 0,
      model: "gpt-test",
      reasoningEffort: "low",
      cliVersion: "codex-cli test",
      harnessVersion: "run-skill-eval/1",
      rawTrace: "raw/codex.jsonl",
      durationMs: 1,
      startedAt: "2026-08-27T00:00:00.000Z",
      endedAt: "2026-08-27T00:00:00.001Z",
    });

    expect(normalized.result.status).toBe("failed");
    expect(normalized.result.normalization_error).toMatch(/fatal error item/u);
  });
});
