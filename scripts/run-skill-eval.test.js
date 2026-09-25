import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeStub() {
  const directory = makeTempDir("skill-eval-stub-");
  temporaryDirectories.push(directory);
  const stub = join(directory, "executor-stub.sh");
  const claudeMarker = join(directory, "claude-was-invoked");
  const invocationLog = join(directory, "executor-invocations");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'invoked\n' >>${JSON.stringify(invocationLog)}
args="$*"
if [[ "$args" == *EXPECT_EXECUTOR_AND_NORMALIZER_FAIL* ]]; then
  printf 'not-json\n'
  exit 7
fi
if [[ "$args" == *EXPECT_REVIEW_ENV_CLEARED* ]]; then test -z "\${SKILLS_REVIEW_TOOL+x}"; fi
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
  [[ " $args " == *" --output-format stream-json "* ]]
  [[ " $args " == *" --verbose "* ]]
  if [[ "$args" == *EXPECT_WITH_SKILL* ]]; then
    printf '%s\n' '{"type":"system","subtype":"init","skills":["box"]}'
  else
    printf '%s\n' '{"type":"system","subtype":"init","skills":[]}'
  fi
  # Evidence counts only when the matching tool_result comes back without an error,
  # so the stub emits the call/result pair the real stream emits.
  if [[ "$args" == *EXPECT_SKILL_SHELL_READ* ]]; then
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"cat .claude/skills/box/SKILL.md"}}]}}'
    printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"name: box"}]}}'
  elif [[ "$args" == *EXPECT_MARKER_MENTION* ]]; then
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"echo references/oauth-setup.md"}}]}}'
    printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"references/oauth-setup.md"}]}}'
  elif [[ "$args" == *EXPECT_SKILL_UNREAD* ]]; then
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls ."}}]}}'
    printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"generated.txt"}]}}'
  elif [[ "$args" == *EXPECT_WITH_SKILL* ]]; then
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"box"}}]}}'
    printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"skill loaded"}]}}'
  fi
  printf '%s\n' '{"type":"result","subtype":"success","result":"claude stub response","is_error":false,"num_turns":1,"usage":{"input_tokens":8,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4}}'
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
  return { claudeMarker, directory, invocationLog, stub };
}

function runEval({ executor, config, prompt, output, stub, fixture, reuseBaseline, evalId = "1" }) {
  const effectiveExecutor = executor ?? "claude-code";
  const executorArgs = executor ? ["--executor", executor] : [];
  const fixtureArgs = fixture ? ["--fixture", fixture] : [];
  const reuseArgs = reuseBaseline ? ["--reuse-baseline", reuseBaseline] : [];
  const evalArgs = evalId === null ? [] : ["--eval-id", evalId];
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
      ...evalArgs,
      ...fixtureArgs,
      ...reuseArgs,
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
  if (config === "without_skill" && !reuseBaseline) {
    const isolationPath = join(output, "isolation.txt");
    const isolation = readFileSync(isolationPath, "utf8").replace(
      /^isolation: .*$/mu,
      "isolation: sandboxed (scripts/eval-sandbox.sh)",
    );
    writeFileSync(isolationPath, isolation, "utf8");
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("run-skill-eval executor compatibility", () => {
  test("does not leak an operator-local reviewer override into eval runs", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    const previous = process.env.SKILLS_REVIEW_TOOL;
    process.env.SKILLS_REVIEW_TOOL = "codex";
    try {
      runEval({
        executor: "codex",
        config: "with_skill",
        prompt: "EXPECT_WITH_SKILL EXPECT_REVIEW_ENV_CLEARED",
        output,
        stub,
      });
    } finally {
      if (previous === undefined) delete process.env.SKILLS_REVIEW_TOOL;
      else process.env.SKILLS_REVIEW_TOOL = previous;
    }
    expect(readJson(join(output, "result.json")).status).toBe("succeeded");
  });

  test.each([
    ["claude-code", "claude-code.jsonl", "claude stub response", 17],
    ["codex", "codex.jsonl", "codex stub response", 20],
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
        harness_version: "run-skill-eval/3",
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
      // stream-json carries per-tool records, so claude-code now reports them too.
      expect(metrics).toMatchObject({ tool_calls: { Skill: 1 }, total_tool_calls: 1 });
      expect(result.skill_usage).toMatchObject({
        config: "with_skill",
        skill: "box",
        visible: true,
        invoked: true,
        read: true,
        invalid_run: false,
        undeterminable: [],
      });
    } else {
      expect(metrics).toMatchObject({ tool_calls: {}, total_tool_calls: 0 });
      // Codex cannot answer "was it offered" or "was it invoked"; it must say so
      // rather than report a measured false.
      expect(result.skill_usage).toMatchObject({
        config: "with_skill",
        skill: "box",
        visible: null,
        invoked: null,
        undeterminable: ["visible", "invoked"],
      });
    }
    expect(readFileSync(join(output, "project-tree.txt"), "utf8")).not.toMatch(
      /\.(?:agents|claude)\/skills/u,
    );
    if (executor === "codex") {
      expect(existsSync(claudeMarker)).toBe(false);
    }
  });

  // The three ways a with_skill run can relate to the subject skill. Only the third
  // may be dropped from a comparison, so each one has to be distinguishable in the
  // artifact rather than inferred from the score (#377).
  test.each([
    // An invocation names the skill, not a path, so files_read stays empty while read holds.
    ["EXPECT_WITH_SKILL", true, true, [], false],
    ["EXPECT_WITH_SKILL EXPECT_SKILL_SHELL_READ", false, true, ["SKILL.md"], false],
    ["EXPECT_WITH_SKILL EXPECT_SKILL_UNREAD", false, false, [], true],
  ])("records skill reads for %s", (prompt, invoked, read, expectedPaths, invalidRun) => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");

    runEval({ executor: "claude-code", config: "with_skill", prompt, output, stub });

    const usage = readJson(join(output, "result.json")).skill_usage;
    expect(usage).toMatchObject({ visible: true, invoked, read, invalid_run: invalidRun });
    expect(usage.files_read).toEqual(expectedPaths.map((name) => `.claude/skills/box/${name}`));
  });

  // stream-json put intermediate messages and tool inputs into raw/. Scanning that for
  // contamination markers turns a mention into a discarded baseline, so claude-code's
  // raw is out of the scan and the read evidence in skill_usage carries the signal.
  test("does not call a claude baseline contaminated for merely naming a marker", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    runEval({
      executor: "claude-code",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL EXPECT_MARKER_MENTION",
      output,
      stub,
    });

    expect(readFileSync(join(output, "contamination.txt"), "utf8")).toMatch(/^verdict: clean$/mu);
    expect(readJson(join(output, "result.json")).skill_usage).toMatchObject({
      read: false,
      unexpected_read: false,
    });
  });

  test("a baseline that reached the skill is reported as an unexpected read", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    runEval({
      executor: "claude-code",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output,
      stub,
    });

    expect(readJson(join(output, "result.json")).skill_usage).toMatchObject({
      config: "without_skill",
      visible: false,
      read: false,
      invalid_run: false,
      unexpected_read: false,
    });
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
    expect(readJson(join(output, "eval-fingerprint.json"))).toMatchObject({
      algorithm: "sha256",
      inputs: {
        executor: "codex",
        model: "model-stub",
        reasoning_effort: "low",
        harness_version: "run-skill-eval/3",
      },
    });
  });

  test("infers the eval id before fingerprinting so ordinary runs include assertions", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output,
      stub,
      evalId: null,
    });

    const fingerprint = readJson(join(output, "eval-fingerprint.json"));
    const metadata = readJson(join(output, "eval_metadata.json"));
    expect(fingerprint.inputs.eval_id).toBe("1");
    expect(fingerprint.inputs.assertions).toEqual(metadata.assertions);
    expect(fingerprint.inputs.assertions.length).toBeGreaterThan(0);
  });

  test("reuses only a matching successful clean baseline and records its provenance", () => {
    const { directory, invocationLog, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });

    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: target,
      reuseBaseline: source,
      stub,
    });

    expect(readJson(join(target, "baseline-reuse.json"))).toMatchObject({
      reused_from: source,
      source_run: "run-1",
      source_configuration: "without_skill",
      executor: "codex",
      model: "model-stub",
      reasoning_effort: "low",
      harness_version: "run-skill-eval/3",
    });
    expect(readJson(join(target, "eval-fingerprint.json"))).toEqual(
      readJson(join(source, "eval-fingerprint.json")),
    );
    expect(readFileSync(invocationLog, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test.each([
    ["changed prompt", { prompt: "CHANGED EXPECT_WITHOUT_SKILL" }],
    ["changed model", { model: "different-model" }],
  ])("rejects baseline reuse with %s", (_label, mutation) => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });
    const result = spawnSync(
      join(repository, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "box",
        "--prompt",
        mutation.prompt ?? "EXPECT_WITHOUT_SKILL",
        "--config",
        "without_skill",
        "--out",
        target,
        "--executor",
        "codex",
        "--model",
        mutation.model ?? "model-stub",
        "--reasoning-effort",
        "low",
        "--eval-id",
        "1",
        "--reuse-baseline",
        source,
        "--repo",
        repository,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SKILL_EVAL_CLI_VERSION: "codex stub-version",
          SKILL_EVAL_RUNNER: stub,
        },
      },
    );
    expect(result.status).toBe(6);
    expect(result.stderr).toMatch(/fingerprint mismatch/u);
    expect(existsSync(target)).toBe(false);
  });

  test("rejects reuse when a required source artifact is missing", () => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });
    rmSync(join(source, "result.json"));
    expect(() =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).toThrow();
    expect(existsSync(target)).toBe(false);
  });

  test("rejects a baseline whose read isolation is not trusted", () => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });
    writeFileSync(join(source, "isolation.txt"), "isolation: UNISOLATED (bwrap missing)\n", "utf8");

    expect(() =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).toThrow();
    expect(existsSync(target)).toBe(false);
  });

  test("rejects a complete baseline artifact stored outside without_skill/run-N", () => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });

    expect(() =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).toThrow();
    expect(existsSync(target)).toBe(false);
  });

  test("rejects baseline reuse without an explicit eval id before fingerprinting", () => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });

    const result = spawnSync(
      join(repository, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "box",
        "--prompt",
        "EXPECT_WITHOUT_SKILL",
        "--config",
        "without_skill",
        "--out",
        target,
        "--executor",
        "codex",
        "--model",
        "model-stub",
        "--reasoning-effort",
        "low",
        "--reuse-baseline",
        source,
        "--repo",
        repository,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SKILL_EVAL_CLI_VERSION: "codex stub-version",
          SKILL_EVAL_RUNNER: stub,
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/requires an explicit --eval-id/u);
    expect(existsSync(target)).toBe(false);
  });

  test("rejects baseline reuse when the executor CLI version is unknown", () => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });
    const fakeCodex = join(directory, "codex");
    writeFileSync(fakeCodex, "#!/usr/bin/env bash\nexit 91\n", "utf8");
    chmodSync(fakeCodex, 0o755);

    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      SKILL_EVAL_RUNNER: stub,
    };
    delete env.SKILL_EVAL_CLI_VERSION;
    const result = spawnSync(
      join(repository, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "box",
        "--prompt",
        "EXPECT_WITHOUT_SKILL",
        "--config",
        "without_skill",
        "--out",
        target,
        "--executor",
        "codex",
        "--model",
        "model-stub",
        "--reasoning-effort",
        "low",
        "--eval-id",
        "1",
        "--reuse-baseline",
        source,
        "--repo",
        repository,
      ],
      { encoding: "utf8", env },
    );

    expect(result.status).toBe(6);
    expect(result.stderr).toMatch(/CLI version could not be determined/u);
    expect(existsSync(target)).toBe(false);
  });

  test.each([
    ["model", ["--reasoning-effort", "low"]],
    ["reasoning effort", ["--model", "model-stub"]],
  ])("rejects baseline reuse without an explicit %s", (_label, executionArgs) => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });

    const result = spawnSync(
      join(repository, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "box",
        "--prompt",
        "EXPECT_WITHOUT_SKILL",
        "--config",
        "without_skill",
        "--out",
        target,
        "--executor",
        "codex",
        ...executionArgs,
        "--eval-id",
        "1",
        "--reuse-baseline",
        source,
        "--repo",
        repository,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SKILL_EVAL_CLI_VERSION: "codex stub-version",
          SKILL_EVAL_RUNNER: stub,
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/requires explicit --model and --reasoning-effort/u);
    expect(existsSync(target)).toBe(false);
  });

  test.each([
    [
      "schema metadata",
      (source) => {
        const path = join(source, "eval-fingerprint.json");
        const fingerprint = readJson(path);
        fingerprint.schema_version = 2;
        writeFileSync(path, `${JSON.stringify(fingerprint)}\n`, "utf8");
      },
      /fingerprint metadata is unsupported/u,
    ],
    [
      "raw trace",
      (source) => {
        const result = readJson(join(source, "result.json"));
        rmSync(join(source, result.raw_trace));
      },
      /raw trace missing or empty/u,
    ],
  ])("rejects reuse with invalid %s", (_label, mutate, errorPattern) => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });
    mutate(source);

    expect(() =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).toThrow();
    expect(existsSync(target)).toBe(false);
    const result = spawnSync(
      "node",
      [
        join(repository, "scripts", "reuse-skill-eval-baseline.js"),
        source,
        target,
        join(source, "eval-fingerprint.json"),
      ],
      { encoding: "utf8" },
    );
    expect(result.stderr).toMatch(errorPattern);
  });

  test.each([
    [
      "required artifact",
      (source, external) => {
        const artifact = join(source, "timing.json");
        rmSync(artifact);
        symlinkSync(external, artifact);
      },
    ],
    [
      "raw trace",
      (source, external) => {
        const result = readJson(join(source, "result.json"));
        const rawTrace = join(source, result.raw_trace);
        rmSync(rawTrace);
        symlinkSync(external, rawTrace);
      },
    ],
  ])("rejects a symlinked %s", (_label, replaceWithSymlink) => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    const external = join(directory, "external-artifact");
    writeFileSync(external, "external\n", "utf8");
    runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });
    replaceWithSymlink(source, external);

    expect(() =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).toThrow();
    expect(existsSync(target)).toBe(false);
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

  test("runs an executable fixture setup before the executor and initial manifest", () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(fixture);
    const setup = join(fixture, "setup.sh");
    writeFileSync(
      setup,
      "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'seeded\\n' >seeded.txt\n",
      "utf8",
    );
    chmodSync(setup, 0o755);

    runEval({
      config: "with_skill",
      prompt: "EXPECT_WITH_SKILL EXPECT_CREATE_FILE",
      output,
      stub,
      fixture,
    });

    expect(readFileSync(join(output, "project-files", "seeded.txt"), "utf8")).toBe("seeded\n");
    expect(readJson(join(output, "outputs", "metrics.json")).files_created).toEqual([
      "generated.txt",
    ]);
  });

  test("fails before starting the executor when fixture setup fails", () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(fixture);
    const setup = join(fixture, "setup.sh");
    writeFileSync(setup, "#!/usr/bin/env bash\nexit 23\n", "utf8");
    chmodSync(setup, 0o755);

    expect(() =>
      runEval({ config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub, fixture }),
    ).toThrow();
    expect(existsSync(output)).toBe(false);
  });

  test("does not execute a fixture setup.sh directory", () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(join(fixture, "setup.sh"), { recursive: true });

    runEval({ config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub, fixture });

    expect(readJson(join(output, "result.json")).status).toBe("succeeded");
  });

  test("returns exit 5 when normalization and the executor both fail", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const result = spawnSync(
      join(repository, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "box",
        "--prompt",
        "EXPECT_EXECUTOR_AND_NORMALIZER_FAIL",
        "--config",
        "without_skill",
        "--out",
        output,
        "--executor",
        "codex",
        "--eval-id",
        "1",
        "--repo",
        repository,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SKILL_EVAL_CLI_VERSION: "codex stub-version",
          SKILL_EVAL_RUNNER: stub,
        },
      },
    );

    expect(result.status).toBe(5);
    expect(result.stderr).toMatch(/codex exited 7/u);
    expect(result.stderr).toMatch(/result normalization failed/u);
    expect(readJson(join(output, "result.json"))).toMatchObject({
      exit_code: 7,
      status: "failed",
    });
  });

  test("rejects unsafe reasoning effort before starting the executor", () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    const result = spawnSync(
      join(repository, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "box",
        "--prompt",
        "EXPECT_WITH_SKILL",
        "--config",
        "with_skill",
        "--out",
        output,
        "--executor",
        "codex",
        "--reasoning-effort",
        'low" -c model="unexpected',
        "--repo",
        repository,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SKILL_EVAL_CLI_VERSION: "codex stub-version",
          SKILL_EVAL_RUNNER: stub,
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/invalid --reasoning-effort/u);
    expect(existsSync(output)).toBe(false);
  });
});

describe("run-skill-eval required sibling skills", () => {
  // A throwaway repository with a subject skill and a sibling, so the harness can be
  // driven with a requires_skills declaration no real skill needs to carry. Scripts
  // are copied, not symlinked: the helpers compare argv[1] with import.meta.url to
  // decide whether to run main(), and a symlinked path makes them silently no-op.
  function makeRepository(evalDefinition) {
    const root = makeTempDir("skill-eval-required-");
    temporaryDirectories.push(root);
    mkdirSync(join(root, "scripts"));
    for (const name of [
      "run-skill-eval.sh",
      "normalize-skill-eval-result.js",
      "skill-eval-fingerprint.js",
      "reuse-skill-eval-baseline.js",
    ]) {
      writeFileSync(join(root, "scripts", name), readFileSync(join(repository, "scripts", name)));
      chmodSync(join(root, "scripts", name), 0o755);
    }
    const subject = join(root, "skills", "subject-skill");
    mkdirSync(join(subject, "references"), { recursive: true });
    const subjectEvals = join(root, "evals", "subject-skill");
    mkdirSync(subjectEvals, { recursive: true });
    writeFileSync(join(subject, "SKILL.md"), "# subject\n", "utf8");
    writeFileSync(join(subject, "references", "subject-guide.md"), "guide\n", "utf8");
    // A bundle path both skills ship: the baseline has the sibling's copy installed.
    mkdirSync(join(subject, "assets"));
    writeFileSync(join(subject, "assets", "shared-template.json"), "{}\n", "utf8");
    // A subject path the sibling's own text names: the baseline can read it there.
    writeFileSync(join(subject, "references", "handoff.md"), "handoff\n", "utf8");
    writeFileSync(
      join(subjectEvals, "evals.json"),
      `${JSON.stringify({ evals: [{ id: 1, prompt: "p", assertions: ["a"], ...evalDefinition }] })}\n`,
      "utf8",
    );
    const sibling = join(root, "skills", "sibling-skill");
    mkdirSync(join(sibling, "scripts"), { recursive: true });
    writeFileSync(
      join(sibling, "SKILL.md"),
      "# sibling\n\nHand off to subject-skill's references/handoff.md.\n",
      "utf8",
    );
    writeFileSync(join(sibling, "scripts", "sibling-tool.mjs"), "export {};\n", "utf8");
    mkdirSync(join(sibling, "assets"));
    writeFileSync(join(sibling, "assets", "shared-template.json"), "{}\n", "utf8");

    const stub = join(root, "stub.sh");
    const installedLog = join(root, "installed");
    writeFileSync(
      stub,
      `#!/usr/bin/env bash
set -euo pipefail
{ find .claude/skills -name SKILL.md 2>/dev/null || true; } | LC_ALL=C sort >${JSON.stringify(installedLog)}
text="stub response"
if [[ "$*" == *CITE_SIBLING* ]]; then text="ran scripts/sibling-tool.mjs with assets/shared-template.json"; fi
if [[ "$*" == *CITE_SUBJECT* ]]; then text="read references/subject-guide.md"; fi
printf '{"result":"%s","is_error":false,"num_turns":1,"usage":{"input_tokens":1,"output_tokens":1}}\\n' "$text"
`,
      "utf8",
    );
    chmodSync(stub, 0o755);
    return { installedLog, root, sibling, stub };
  }

  function run({ root, stub }, config, prompt = "PROMPT") {
    const output = join(root, "iteration-1", "eval-1", config, "run-1");
    const result = spawnSync(
      join(root, "scripts", "run-skill-eval.sh"),
      [
        "--skill",
        "subject-skill",
        "--prompt",
        prompt,
        "--config",
        config,
        "--out",
        output,
        "--model",
        "model-stub",
        "--reasoning-effort",
        "low",
        "--eval-id",
        "1",
        "--repo",
        root,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, SKILL_EVAL_RUNNER: stub, SKILL_EVAL_CLI_VERSION: "stub-version" },
      },
    );
    return { output, result };
  }

  test("installs declared siblings in both configurations and the subject for with_skill only", () => {
    // The comparison must differ only by the subject skill: a sibling installed for
    // with_skill alone would credit the sibling's instructions to the subject.
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const { output, result } = run(fixture, "with_skill");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(fixture.installedLog, "utf8")).toBe(
      ".claude/skills/sibling-skill/SKILL.md\n.claude/skills/subject-skill/SKILL.md\n",
    );
    expect(readFileSync(join(output, "isolation.txt"), "utf8")).toMatch(
      /^required_skills: sibling-skill$/mu,
    );
    const [recorded] = readJson(join(output, "eval-fingerprint.json")).inputs.required_skills;
    expect(recorded).toMatchObject({ name: "sibling-skill" });
    expect(recorded.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const baseline = run(fixture, "without_skill");
    expect(baseline.result.status, baseline.result.stderr).toBe(0);
    expect(readFileSync(fixture.installedLog, "utf8")).toBe(
      ".claude/skills/sibling-skill/SKILL.md\n",
    );
    expect(readJson(join(baseline.output, "eval-fingerprint.json")).inputs.required_skills).toEqual(
      [recorded],
    );
  });

  test("changes the fingerprint when an installed sibling changes", () => {
    // A reused baseline ran with the sibling's content; a changed sibling is a changed input.
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const before = run(fixture, "without_skill");
    const beforeFingerprint = readJson(join(before.output, "eval-fingerprint.json")).fingerprint;
    rmSync(before.output, { recursive: true, force: true });
    writeFileSync(
      join(fixture.sibling, "scripts", "sibling-tool.mjs"),
      "export const v = 2;\n",
      "utf8",
    );
    const after = run(fixture, "without_skill");

    expect(after.result.status, after.result.stderr).toBe(0);
    expect(readJson(join(after.output, "eval-fingerprint.json")).fingerprint).not.toBe(
      beforeFingerprint,
    );
  });

  test("installs only the subject and leaves the fingerprint unchanged without a declaration", () => {
    const fixture = makeRepository({});
    const { output, result } = run(fixture, "with_skill");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(fixture.installedLog, "utf8")).toBe(
      ".claude/skills/subject-skill/SKILL.md\n",
    );
    expect(readJson(join(output, "eval-fingerprint.json")).inputs).not.toHaveProperty(
      "required_skills",
    );
  });

  test("does not flag a baseline that cites the installed sibling, including a path both skills ship", () => {
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const { output, result } = run(fixture, "without_skill", "CITE_SIBLING");

    expect(result.status, readFileSync(join(output, "stderr.log"), "utf8")).toBe(0);
    const verdict = readFileSync(join(output, "contamination.txt"), "utf8");
    expect(verdict).toMatch(/^verdict: clean$/mu);
    const markers = verdict.match(/^markers: (.*)$/mu)[1].split(" ");
    expect(markers).toContain("references/subject-guide.md");
    expect(markers).not.toContain("assets/shared-template.json");
    expect(markers).not.toContain("references/handoff.md");
  });

  test("still flags a baseline that cites the subject's bundle when siblings are installed", () => {
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const { output, result } = run(fixture, "without_skill", "CITE_SUBJECT");

    expect(result.status).toBe(4);
    const verdict = readFileSync(join(output, "contamination.txt"), "utf8");
    expect(verdict).toMatch(/^verdict: CONTAMINATED$/mu);
    expect(verdict).toMatch(/^references\/subject-guide\.md\t/mu);
  });

  test.each([
    ["a non-array", { requires_skills: "sibling-skill" }, 5, /non-empty array/u],
    ["an empty array", { requires_skills: [] }, 5, /non-empty array/u],
    ["a non-kebab name", { requires_skills: ["../sibling-skill"] }, 5, /invalid skill name/u],
    ["a non-string name", { requires_skills: [1] }, 5, /invalid skill name/u],
    ["a duplicate", { requires_skills: ["sibling-skill", "sibling-skill"] }, 5, /twice/u],
    ["the subject itself", { requires_skills: ["subject-skill"] }, 5, /subject skill itself/u],
    [
      "a missing sibling",
      { requires_skills: ["absent-skill"] },
      1,
      /required skill source not found/u,
    ],
  ])("fails before the executor on %s", (_label, definition, status, message) => {
    const fixture = makeRepository(definition);
    const { output, result } = run(fixture, "with_skill");

    expect(result.status).toBe(status);
    expect(result.stderr).toMatch(message);
    expect(existsSync(fixture.installedLog)).toBe(false);
    expect(existsSync(output)).toBe(false);
  });
});
