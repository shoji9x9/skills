import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const repository = resolve(import.meta.dirname, "..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeStub() {
  const directory = mkdtempSync(join(tmpdir(), "skill-eval-stub-"));
  temporaryDirectories.push(directory);
  const stub = join(directory, "executor-stub.sh");
  const claudeMarker = join(directory, "claude-was-invoked");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *EXPECT_CREATE_FILE* ]]; then printf 'generated\n' >generated.txt; fi
if [[ "$args" == *EXPECT_WITH_SKILL* ]]; then
  if [ "$1" = "exec" ]; then test -f .agents/skills/box/SKILL.md; else test -f .claude/skills/box/SKILL.md; fi
else
  test ! -e .agents/skills/box/SKILL.md
  test ! -e .claude/skills/box/SKILL.md
fi
if [ "$1" = "exec" ]; then
  [[ " $args " == *" --approve-for-me "* ]]
  [[ " $args " != *" --sandbox "* ]]
  printf '%s\n' '{"type":"thread.started","thread_id":"stub"}'
  printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"codex stub response"}}'
  printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":4,"cache_write_input_tokens":0,"output_tokens":3,"reasoning_output_tokens":1}}'
else
  printf '%s\n' '{"result":"claude stub response","is_error":false,"num_turns":1,"usage":{"input_tokens":8,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4}}'
fi
`,
    "utf8",
  );
  chmodSync(stub, 0o755);
  const poisonClaude = join(directory, "claude");
  writeFileSync(
    poisonClaude,
    `#!/usr/bin/env bash
touch ${JSON.stringify(claudeMarker)}
exit 91
`,
    "utf8",
  );
  chmodSync(poisonClaude, 0o755);
  return { claudeMarker, directory, stub };
}

function runEval({ executor, config, prompt, output, stub, fixture }) {
  const effectiveExecutor = executor ?? "claude-code";
  const executorArgs = executor ? ["--executor", executor] : [];
  const fixtureArgs = fixture ? ["--fixture", fixture] : [];
  execFileSync(
    join(repository, "scripts", "run-skill-eval.sh"),
    [
      "--skill",
      "box",
      "--prompt",
      prompt,
      "--config",
      config,
      "--out",
      output,
      ...executorArgs,
      "--model",
      "model-stub",
      "--reasoning-effort",
      "low",
      "--eval-id",
      "1",
      ...fixtureArgs,
      "--repo",
      repository,
    ],
    {
      env: {
        ...process.env,
        PATH: `${dirname(stub)}:${process.env.PATH}`,
        SKILL_EVAL_RUNNER: stub,
        SKILL_EVAL_CLI_VERSION: `${effectiveExecutor} stub-version`,
      },
      stdio: "pipe",
    },
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("run-skill-eval executor compatibility", () => {
  test.each([
    ["claude-code", "claude-code.json", "claude stub response", 17],
    ["codex", "codex.jsonl", "codex stub response", 15],
  ])("emits the common run contract for %s", (executor, rawName, response, totalTokens) => {
    const { claudeMarker, directory, stub } = makeStub();
    const iteration = join(directory, "iteration-1");
    const output = join(iteration, "eval-1", "with_skill", "run-1");

    runEval({ executor, config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub });

    const result = readJson(join(output, "result.json"));
    const timing = readJson(join(output, "timing.json"));
    const metrics = readJson(join(output, "outputs", "metrics.json"));
    const metadata = readJson(join(iteration, "eval-1", "eval_metadata.json"));
    expect(result).toMatchObject({
      schema_version: 1,
      executor: {
        name: executor,
        model: "model-stub",
        reasoning_effort: "low",
        cli_version: `${executor} stub-version`,
        harness_version: "run-skill-eval/1",
      },
      status: "succeeded",
      exit_code: 0,
      result: response,
      raw_trace: `raw/${rawName}`,
    });
    expect(timing.total_tokens).toBe(totalTokens);
    expect(metadata).toMatchObject({ eval_id: 1, prompt: "EXPECT_WITH_SKILL" });
    expect(readFileSync(join(output, "outputs", "response.md"), "utf8")).toBe(`${response}\n`);
    expect(readJson(join(output, "eval_metadata.json"))).toEqual(metadata);
    expect(metrics.files_created).toEqual([]);
    if (executor === "claude-code") {
      expect(metrics).not.toHaveProperty("tool_calls");
      expect(metrics).not.toHaveProperty("total_tool_calls");
    } else {
      expect(metrics).toMatchObject({ tool_calls: {}, total_tool_calls: 0 });
    }
    expect(readFileSync(join(output, "project-tree.txt"), "utf8")).not.toMatch(
      /\.(?:agents|claude)\/skills/u,
    );
    if (executor === "codex") {
      expect(existsSync(claudeMarker)).toBe(false);
    }
  });

  test("Codex baseline stays uninstalled and writes a fail-closed contamination verdict", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output,
      stub,
    });

    expect(readFileSync(join(output, "contamination.txt"), "utf8")).toMatch(/^verdict: clean$/mu);
    expect(readJson(join(output, "result.json")).executor.name).toBe("codex");
  });

  test("keeps Claude Code as the default executor for existing callers", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");

    runEval({ config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub });

    expect(readJson(join(output, "result.json"))).toMatchObject({
      executor: { name: "claude-code", cli_version: "claude-code stub-version" },
      result: "claude stub response",
    });
  });

  test("reports only captured files created after fixture seeding", () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(fixture);
    writeFileSync(join(fixture, "existing.txt"), "fixture\n", "utf8");

    runEval({
      config: "with_skill",
      prompt: "EXPECT_WITH_SKILL EXPECT_CREATE_FILE",
      output,
      stub,
      fixture,
    });

    expect(readJson(join(output, "outputs", "metrics.json")).files_created).toEqual([
      "generated.txt",
    ]);
    expect(readFileSync(join(output, "project-files", "existing.txt"), "utf8")).toBe("fixture\n");
  });
});
