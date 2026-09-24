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
  return [call, toolResult(id, outcome)];
}

// `outcome` is "ok", "error", or `{ content }` for a successful call whose output
// matters (the Bash tool reports a cwd reset there).
function toolResult(id, outcome = "ok") {
  let content = outcome === "error" ? "command failed" : "ok";
  if (typeof outcome === "object") {
    content = outcome.content;
  }
  return {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          ...(outcome === "error" ? { is_error: true } : {}),
          content,
        },
      ],
    },
  };
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
    // separator inside quotes is not a separator. Only a pure `&&` list says that
    // (see the next table); anything else yields nothing — including the forms below
    // that do read the skill. That costs an invalid_run, never a false contamination.
    test.each([
      ["a branch that did not run", "test -f x && cat .claude/skills/box/SKILL.md || echo absent"],
      ["a separator inside quotes", "printf '%s' 'note; cat .claude/skills/box/SKILL.md'"],
      ["an and-list inside quotes", "printf '%s' 'x && cat .claude/skills/box/SKILL.md'"],
      ["a command substitution", "echo $(cat .claude/skills/box/SKILL.md)"],
      ["a genuine piped read", "cat .claude/skills/box/SKILL.md | head -n 5"],
      ["a piped read inside an and-list", "true && cat .claude/skills/box/SKILL.md | head"],
      // Leading word IS a read utility here, so only the control-flow guard can
      // reject these; the cases above are already stopped by the utility check.
      ["a read utility before a semicolon", "cat .claude/skills/box/SKILL.md; echo done"],
      ["a read after a semicolon", "false; cat .claude/skills/box/SKILL.md && echo done"],
      ["a read in a background list", "false & cat .claude/skills/box/SKILL.md && echo done"],
      // `a && b || c` is `(a && b) || c` and `a && b & c` backgrounds `a && b`: both
      // exit zero with the read failed, though splitting at `&&` alone yields `cat X`.
      ["a read before a fallback", "cat .claude/skills/box/SKILL.md && echo done || true"],
      [
        "a read before a semicolon-joined command",
        "cat .claude/skills/box/SKILL.md && echo done; true",
      ],
      [
        "a read before a newline-joined command",
        "cat .claude/skills/box/SKILL.md && echo done\ntrue",
      ],
      ["a read in a backgrounded list", "cat .claude/skills/box/SKILL.md && echo done & true"],
      ["a read behind a comment", "true # && cat .claude/skills/box/SKILL.md"],
      ["a read in a subshell", "true && (cat .claude/skills/box/SKILL.md)"],
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

    // A pure `&&` list that exited zero ran every element, and every element exited
    // zero, so a plain read anywhere in it happened.
    test.each([
      ["a read followed by a branch", "cat .claude/skills/box/SKILL.md && echo done"],
      ["a read after a test", "test -e x && cat .claude/skills/box/SKILL.md"],
      ["a read after a redirect", "ls 2>&1 && cat .claude/skills/box/SKILL.md"],
    ])("counts %s in a successful and-list", (_label, command) => {
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

      expect(usage).toMatchObject({ read: true, unexpected_read: true });
      expect(usage.files_read).toEqual([".claude/skills/box/SKILL.md"]);
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

    // #455: the Bash tool keeps one shell, so `cd <skill dir>` then `cat SKILL.md`
    // reads the skill without its path appearing in any single command.
    describe("reads relative to the shell's working directory", () => {
      const SKILL_DIR = "/p/.claude/skills/box";
      const INIT = { type: "system", subtype: "init", skills: ["box"], cwd: "/p" };
      const bash = (command, outcome) => assistantToolUse("Bash", { command }, outcome);
      const usageOf = (events, config = "with_skill") =>
        buildSkillUsage({
          config,
          skill: "box",
          evidence: evidenceFor(claudeStream([...events, RESULT_EVENT])),
        });

      test.each([
        ["after an absolute cd", [bash(`cd ${SKILL_DIR} && ls`), bash("cat SKILL.md")], "SKILL.md"],
        [
          "after a cd relative to the start",
          [bash("cd .claude/skills/box"), bash("cat SKILL.md")],
          "SKILL.md",
        ],
        ["after a quoted cd", [bash(`cd "${SKILL_DIR}"`), bash("cat SKILL.md")], "SKILL.md"],
        [
          "up from a subdirectory",
          [bash(`cd ${SKILL_DIR}/references`), bash("cat ../SKILL.md")],
          "SKILL.md",
        ],
        ["inside the same and-list", [bash(`cd ${SKILL_DIR} && cat SKILL.md`)], "SKILL.md"],
        [
          // The shape eval 44 recorded (iteration-44, with_skill run-2).
          "after a cd whose list pipes and substitutes",
          [
            bash(
              `cd ${SKILL_DIR} && find . -type f | head -50 && echo "=== SIZES ===" && wc -l $(find . -type f -name "*.md") 2>/dev/null`,
            ),
            bash('echo "===== fit =====" && cat scripts/fit.mjs'),
          ],
          "scripts/fit.mjs",
        ],
      ])("counts a relative read %s", (_label, events, file) => {
        const usage = usageOf([INIT, ...events]);

        expect(usage).toMatchObject({ read: true, invalid_run: false });
        expect(usage.files_read).toEqual([`.claude/skills/box/${file}`]);
      });

      // Each of these either may not have reached the skill directory or may have
      // left it again, so the relative read after it must not resolve there.
      test.each([
        // The shape eval 44 recorded (iteration-44, with_skill run-1): the list
        // exits with `ls`'s status, which says nothing about the cd.
        [
          "a cd followed by a semicolon",
          [bash(`cd ${SKILL_DIR} && wc -l SKILL.md 2>/dev/null; echo "==="; ls assets/`)],
        ],
        ["a cd with a fallback", [bash(`cd ${SKILL_DIR} || true`)]],
        ["a cd in the background", [bash(`cd ${SKILL_DIR} & true`)]],
        ["a cd whose call failed", [bash(`cd ${SKILL_DIR} && ls`, "error")]],
        ["a cd whose call never returned", [bash(`cd ${SKILL_DIR}`, "no-result")]],
        ["a cd in a child shell", [bash(`bash -c 'cd ${SKILL_DIR}'`)]],
        [
          "a cd run in the background",
          [assistantToolUse("Bash", { command: `cd ${SKILL_DIR}`, run_in_background: true })],
        ],
        [
          "a cd relative to an unknown start",
          [bash("cd .claude/skills/box")],
          { ...INIT, cwd: undefined },
        ],
      ])("does not resolve a relative read after %s", (_label, events, init = INIT) => {
        const usage = usageOf([init, ...events, bash("cat SKILL.md")]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      test.each([
        ["a pushd", `pushd /tmp`],
        ["a cd behind a variable", `cd "$HOME"`],
        ["a cd home", "cd ~"],
        ["a cd back", "cd -"],
        ["a cd before a semicolon", "cd /tmp; ls"],
        ["a cd with a fallback", "cd /tmp || true"],
        ["a sourced script", "source env.sh"],
        ["a dot-sourced script", ". env.sh"],
        ["an eval of an expanded command", 'eval "$MOVE"'],
        ["an expanded command word", "$GO /tmp"],
        ["a cd later in the list", "ls && cd /tmp"],
        ["a cd after a child shell", `bash -c "echo hi" && cd "/tmp"`],
        ["an eval of a quoted cd", `eval "cd /tmp" && ls`],
        ["a quoted cd word", `"cd" /tmp && ls`],
        ["an escaped cd word", String.raw`\cd /tmp`],
        ["a cd word split by quotes", "c'd' /tmp"],
      ])("forgets the skill directory after %s", (_label, command) => {
        const usage = usageOf([INIT, bash(`cd ${SKILL_DIR}`), bash(command), bash("cat SKILL.md")]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      test("forgets the skill directory once the tool reports resetting the cwd", () => {
        const usage = usageOf([
          INIT,
          bash(`cd ${SKILL_DIR}`),
          bash("ls", { content: "SKILL.md\nShell cwd was reset to /p" }),
          bash("cat SKILL.md"),
        ]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      // Already in the skill directory, so only the pending cd can make the read
      // unresolvable: it may have run first and moved away.
      test("does not resolve a read issued alongside a cd that may run first", () => {
        const usage = usageOf([
          INIT,
          bash(`cd ${SKILL_DIR}`),
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "toolu_par_cd",
                  name: "Bash",
                  input: { command: "cd /tmp" },
                },
                {
                  type: "tool_use",
                  id: "toolu_par_cat",
                  name: "Bash",
                  input: { command: "cat SKILL.md" },
                },
              ],
            },
          },
          toolResult("toolu_par_cd"),
          toolResult("toolu_par_cat"),
        ]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      // Codex review on #463: results arrive in some order, but the calls may have run
      // in another, so neither move nor a read issued before the move is placed.
      const parallel = (...calls) => [
        {
          type: "assistant",
          message: {
            content: calls.map(([id, command]) => ({
              type: "tool_use",
              id,
              name: "Bash",
              input: { command },
            })),
          },
        },
        ...calls.map(([id]) => toolResult(id)),
      ];

      test("does not settle on whichever of two parallel moves reported last", () => {
        const usage = usageOf([
          INIT,
          ...parallel(["toolu_mv_tmp", "cd /tmp"], ["toolu_mv_skill", `cd ${SKILL_DIR}`]),
          bash("cat SKILL.md"),
        ]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      test("does not resolve a read issued just before a parallel move", () => {
        const usage = usageOf([
          INIT,
          bash(`cd ${SKILL_DIR}`),
          ...parallel(["toolu_rd_first", "cat SKILL.md"], ["toolu_mv_after", "cd /tmp"]),
        ]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      test("does not resolve a read that leaves the skill directory", () => {
        const usage = usageOf([INIT, bash(`cd ${SKILL_DIR}`), bash("cat ../../../README.md")]);

        expect(usage).toMatchObject({ read: false, invalid_run: true });
      });

      // The issue's negative control: with no skill installed the cd fails, and the
      // baseline's later relative read must not count as contamination.
      test("does not call a baseline contaminated after its cd into the absent skill fails", () => {
        const usage = usageOf(
          [{ ...INIT, skills: [] }, bash(`cd ${SKILL_DIR} && ls`, "error"), bash("cat SKILL.md")],
          "without_skill",
        );

        expect(usage).toMatchObject({ read: false, unexpected_read: false });
      });

      const codexTrace = (...commands) =>
        [
          ...commands.map((command) => ({
            type: "item.completed",
            item: { type: "command_execution", command, exit_code: 0 },
          })),
          { type: "item.completed", item: { type: "agent_message", text: "done" } },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n");

      test("counts a codex read inside the command that moved there", () => {
        const usage = buildSkillUsage({
          config: "with_skill",
          skill: "box",
          evidence: evidenceFor(
            codexTrace("/bin/bash -lc 'cd /p/.agents/skills/box && cat SKILL.md'"),
            "codex",
          ),
        });

        expect(usage).toMatchObject({ read: true, invalid_run: false });
        expect(usage.files_read).toEqual([".agents/skills/box/SKILL.md"]);
      });

      test("does not carry a codex cd into the next command", () => {
        const usage = buildSkillUsage({
          config: "with_skill",
          skill: "box",
          evidence: evidenceFor(
            codexTrace("/bin/bash -lc 'cd /p/.agents/skills/box'", "/bin/bash -lc 'cat SKILL.md'"),
            "codex",
          ),
        });

        expect(usage).toMatchObject({ read: false, invalid_run: true });
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
