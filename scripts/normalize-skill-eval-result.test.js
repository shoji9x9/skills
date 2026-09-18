import { describe, expect, test } from "vitest";

import {
  buildSkillUsage,
  normalizeTrace,
  parseClaudeTrace,
  parseCodexTrace,
} from "./normalize-skill-eval-result.js";

function claudeStream(events) {
  return `${events
    .flat()
    .map((event) => JSON.stringify(event))
    .join("\n")}\n`;
}

const RESULT_EVENT = {
  type: "result",
  subtype: "success",
  result: "claude response",
  is_error: false,
  num_turns: 2,
  usage: { input_tokens: 1, output_tokens: 1 },
};

let toolUseSeq = 0;

// A call plus the result that came back for it. Evidence only counts once the result
// arrives without an error, so the default pair is a successful call; `outcome` covers
// the failing and never-completed cases.
function assistantToolUse(name, input, outcome = "ok") {
  toolUseSeq += 1;
  const id = `toolu_${toolUseSeq}`;
  const call = {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  };
  if (outcome === "no-result") {
    return [call];
  }
  const result = {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          ...(outcome === "error" ? { is_error: true } : {}),
          content: outcome === "error" ? "command failed" : "ok",
        },
      ],
    },
  };
  return [call, result];
}

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

  test("reads the same final fields from a stream-json trace as from the legacy object", () => {
    const parsed = parseClaudeTrace(
      claudeStream([
        { type: "system", subtype: "init", skills: ["box"] },
        assistantToolUse("Read", { file_path: "/tmp/p/.claude/skills/box/references/api.md" }),
        RESULT_EVENT,
      ]),
    );

    expect(parsed.finalResponse).toBe("claude response");
    expect(parsed.totalSteps).toBe(2);
    expect(parsed.totalToolCalls).toBe(1);
    expect(parsed.toolCalls).toEqual({ Read: 1 });
    expect(parsed.skillEvidence.visibleSkills).toEqual(["box"]);
  });

  test("rejects a stream trace that never reached a result event", () => {
    expect(() =>
      parseClaudeTrace(claudeStream([{ type: "system", subtype: "init", skills: [] }])),
    ).toThrow(/no result event/u);
  });

  // `--output-format json` emits this exact object, so line count cannot separate it
  // from a stream; only the absence of other events can.
  test("treats a lone result object as carrying no tool record", () => {
    const parsed = parseClaudeTrace(claudeStream([RESULT_EVENT]));

    expect(parsed.finalResponse).toBe("claude response");
    expect(parsed.toolCalls).toBeNull();
    expect(parsed.totalToolCalls).toBeNull();
    expect(parsed.skillEvidence).toEqual({
      visibleSkills: null,
      invokedSkills: null,
      toolInputTexts: null,
    });
  });

  describe("skill read detection", () => {
    const evidenceFor = (rawText, executor = "claude-code") =>
      (executor === "codex" ? parseCodexTrace(rawText) : parseClaudeTrace(rawText)).skillEvidence;

    test("counts an explicit Skill invocation as read", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Skill", { skill: "box" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ visible: true, invoked: true, read: true, invalid_run: false });
    });

    test("counts a shell read of the skill directory as read", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command: "cat .claude/skills/box/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ invoked: false, read: true, invalid_run: false });
      expect(usage.files_read).toEqual([".claude/skills/box/SKILL.md"]);
    });

    test("marks a with_skill run that never touched the skill as invalid", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command: "ls ." }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({
        visible: true,
        invoked: false,
        read: false,
        invalid_run: true,
      });
      expect(usage.files_read).toEqual([]);
    });

    // Naming a path is not opening it. The excluded side needs its own cases, or the
    // detector counts an existence check and a mention as reads (PR #400 review).
    test.each([
      ["an existence check", "test ! -e .claude/skills/box/SKILL.md"],
      ["a bracket test", "[ -e .claude/skills/box/SKILL.md ] && echo missing"],
      ["a directory listing", "ls -la .claude/skills/box/"],
      ["a mention", "echo .claude/skills/box/SKILL.md"],
      ["a stat", "stat .claude/skills/box/SKILL.md"],
      ["a removal", "rm -f .claude/skills/box/SKILL.md"],
      ["a find", "find .claude/skills/box -name '*.md'"],
    ])("does not count %s as reading the skill", (_label, command) => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
      expect(usage.files_read).toEqual([]);
    });

    test.each([
      ["cat", "cat .claude/skills/box/SKILL.md"],
      ["head", "head -n 40 .claude/skills/box/SKILL.md"],
      ["sed", "sed -n '1,20p' .claude/skills/box/SKILL.md"],
      ["grep", "grep -n description .claude/skills/box/SKILL.md"],
    ])("counts %s as reading the skill", (_label, command) => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: true, invalid_run: false });
    });

    test("does not let a baseline's absence check read as an unexpected read", () => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Bash", { command: "test ! -e .claude/skills/box/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
    });

    test("counts a Read tool call on the skill but not a Glob that only locates it", () => {
      const read = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Read", { file_path: "/p/.claude/skills/box/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });
      const located = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Glob", { pattern: "**/*.md", path: "/p/.claude/skills/box" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(read).toMatchObject({ read: true, invalid_run: false });
      expect(located).toMatchObject({ read: false, invalid_run: true });
    });

    test("does not count a Write into the skill directory as having read it", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Write", {
              file_path: "/p/.claude/skills/box/SKILL.md",
              content: "overwritten",
            }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
    });

    // The command text says a read was attempted; only the result says it happened.
    test.each([
      ["the read failed", "error"],
      ["the call never completed", "no-result"],
    ])("does not count a reading command when %s", (_label, outcome) => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command: "cat .claude/skills/box/SKILL.md" }, outcome),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
      expect(usage.files_read).toEqual([]);
    });

    test("does not call a baseline contaminated when its cat of the absent skill fails", () => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Bash", { command: "cat .claude/skills/box/SKILL.md" }, "error"),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
    });

    // A zero exit for the whole command does not mean every part of it ran, and a
    // separator inside quotes is not a separator. Deciding that needs a real shell
    // parse, so a compound command yields nothing — including the two forms below
    // that do read the skill. That costs an invalid_run, never a false contamination.
    test.each([
      ["a branch that did not run", "test -f x && cat .claude/skills/box/SKILL.md || echo absent"],
      ["a separator inside quotes", "printf '%s' 'note; cat .claude/skills/box/SKILL.md'"],
      ["a command substitution", "echo $(cat .claude/skills/box/SKILL.md)"],
      ["a genuine piped read", "cat .claude/skills/box/SKILL.md | head -n 5"],
      // Leading word IS a read utility here, so only the control-flow guard can
      // reject these; the cases above are already stopped by the utility check.
      ["a read utility followed by a branch", "cat .claude/skills/box/SKILL.md && echo done"],
      ["a read utility before a semicolon", "cat .claude/skills/box/SKILL.md; echo done"],
      ["a genuine read after a test", "test -e x && cat .claude/skills/box/SKILL.md"],
    ])("takes no evidence from %s", (_label, command) => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
      expect(usage.files_read).toEqual([]);
    });

    test.each([
      ["errored", "error"],
      ["never returned", "no-result"],
    ])("does not record a Skill invocation whose result %s", (_label, outcome) => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Skill", { skill: "box" }, outcome),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ invoked: false, read: false, invalid_run: true });
    });

    test("does not count a codex command that exited nonzero", () => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          [
            {
              type: "item.completed",
              item: {
                type: "command_execution",
                command: "/bin/bash -lc 'cat .agents/skills/box/SKILL.md'",
                exit_code: 1,
              },
            },
            { type: "item.completed", item: { type: "agent_message", text: "absent" } },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n"),
          "codex",
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
    });

    test("does not let a failed read in one call cancel a successful read in another", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command: "cat .claude/skills/box/MISSING.md" }, "error"),
            assistantToolUse("Bash", { command: "cat .claude/skills/box/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: true, invalid_run: false });
      expect(usage.files_read).toEqual([".claude/skills/box/SKILL.md"]);
    });

    test("does not let a sibling skill's path count as the subject being read", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box", "issue-start"] },
            assistantToolUse("Bash", { command: "cat .claude/skills/issue-start/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
    });

    // A recognized utility does not make every argument a file it opened.
    test.each([
      ["a grep pattern", "grep .claude/skills/box/SKILL.md report.txt"],
      ["an rg pattern", "rg .claude/skills/box/SKILL.md report.txt"],
      ["a sed script", "sed .claude/skills/box/SKILL.md report.txt"],
      ["an awk program", "awk .claude/skills/box/SKILL.md report.txt"],
    ])("does not treat %s as a file it read", (_label, command) => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
      expect(usage.files_read).toEqual([]);
    });

    // An option's value is not a file it opened. `diff --label X a b` reads a and b.
    test.each([
      ["a display label", "diff --label .claude/skills/box/SKILL.md a b"],
      ["a short option value", "head -c .claude/skills/box/SKILL.md a"],
    ])("does not treat %s as a file it read", (_label, command) => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
      expect(usage.files_read).toEqual([]);
    });

    test.each([
      ["head with a count", "head -n 40 .claude/skills/box/SKILL.md"],
      ["sed with a script", "sed -n '1,20p' .claude/skills/box/SKILL.md"],
      ["grep with a flag and pattern", "grep -n name .claude/skills/box/SKILL.md"],
    ])("still counts %s", (_label, command) => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: true, invalid_run: false });
      expect(usage.files_read).toEqual([".claude/skills/box/SKILL.md"]);
    });

    test("still reads the file operand that follows a pattern", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command: "grep -n name .claude/skills/box/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: true, invalid_run: false });
      expect(usage.files_read).toEqual([".claude/skills/box/SKILL.md"]);
    });

    // The subject must be a whole directory segment; `.` and `@` are not boundaries.
    test.each([
      ["a dotted suffix", "cat .claude/skills/box.old/SKILL.md"],
      ["an at suffix", "cat .claude/skills/box@backup/SKILL.md"],
      ["a dashed suffix", "cat .claude/skills/box-2/SKILL.md"],
    ])("does not match the subject inside %s", (_label, command) => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
      expect(usage.files_read).toEqual([]);
    });

    test("does not let a skill whose name extends the subject's count as the subject", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Bash", { command: "cat .claude/skills/boxes/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
      expect(usage.files_read).toEqual([]);
    });

    // A baseline that correctly reports the skill is absent routinely writes where it
    // would live. Authored bodies must not count as evidence of opening it, or a clean
    // baseline reads as contaminated and a with_skill run that only names the path
    // escapes invalid_run.
    test("does not count a path the agent wrote into a file body as a read", () => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Write", {
              file_path: "report.md",
              content: "install it at .claude/skills/box/SKILL.md",
            }),
            assistantToolUse("Edit", {
              file_path: "report.md",
              old_string: ".agents/skills/box/SKILL.md",
              new_string: ".claude/skills/box/references/api.md",
            }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({ read: false, unexpected_read: false });
      expect(usage.files_read).toEqual([]);
    });

    // An edit is a write. The Read it requires is its own call, and that is what counts,
    // so the pair must land on read: true through the Read alone.
    test("counts the Read that precedes an edit, not the edit itself", () => {
      const editOnly = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Edit", {
              file_path: ".claude/skills/box/SKILL.md",
              old_string: "a",
              new_string: "b",
            }),
            RESULT_EVENT,
          ]),
        ),
      });
      const readThenEdit = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: ["box"] },
            assistantToolUse("Read", { file_path: ".claude/skills/box/SKILL.md" }),
            assistantToolUse("Edit", {
              file_path: ".claude/skills/box/SKILL.md",
              old_string: "a",
              new_string: "b",
            }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(editOnly).toMatchObject({ read: false, invalid_run: true });
      expect(readThenEdit).toMatchObject({ read: true, invalid_run: false });
      expect(readThenEdit.files_read).toEqual([".claude/skills/box/SKILL.md"]);
    });

    test("unwraps the `bash -lc` form codex uses to run every command", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          [
            {
              type: "item.completed",
              item: {
                type: "command_execution",
                command: "/bin/bash -lc 'test ! -e .agents/skills/box/SKILL.md'",
                exit_code: 0,
              },
            },
            { type: "item.completed", item: { type: "agent_message", text: "absent" } },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n"),
          "codex",
        ),
      });

      expect(usage).toMatchObject({ read: false, invalid_run: true });
    });

    test("never turns an empty Codex trace into a measured 'not read'", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor("", "codex"),
      });

      expect(usage).toMatchObject({ read: null, invalid_run: null });
      expect(usage.undeterminable).toEqual(["visible", "invoked", "files_read"]);
    });

    test("leaves Codex's offered and invoked axes undeterminable while still reading paths", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          [
            {
              type: "item.completed",
              item: {
                type: "command_execution",
                command: "/bin/bash -lc 'cat .agents/skills/box/SKILL.md'",
                exit_code: 0,
              },
            },
            { type: "item.completed", item: { type: "agent_message", text: "done" } },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n"),
          "codex",
        ),
      });

      expect(usage).toMatchObject({
        visible: null,
        invoked: null,
        read: true,
        invalid_run: false,
        undeterminable: ["visible", "invoked"],
      });
      expect(usage.files_read).toEqual([".agents/skills/box/SKILL.md"]);
    });

    test("never turns an unreadable trace into a measured 'not read'", () => {
      const usage = buildSkillUsage({
        config: "with_skill",
        skill: "box",
        evidence: evidenceFor(
          JSON.stringify({ result: "legacy", is_error: false, num_turns: 1, usage: {} }),
        ),
      });

      expect(usage).toMatchObject({ read: null, invalid_run: null });
      expect(usage.undeterminable).toEqual(["visible", "invoked", "files_read"]);
    });

    test("reports a baseline that reached the skill as an unexpected read", () => {
      const usage = buildSkillUsage({
        config: "without_skill",
        skill: "box",
        evidence: evidenceFor(
          claudeStream([
            { type: "system", subtype: "init", skills: [] },
            assistantToolUse("Bash", { command: "cat ../.claude/skills/box/SKILL.md" }),
            RESULT_EVENT,
          ]),
        ),
      });

      expect(usage).toMatchObject({
        visible: false,
        read: true,
        invalid_run: false,
        unexpected_read: true,
      });
    });
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
