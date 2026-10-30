import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { basename, join, relative } from "node:path";
import { assert, describe, expect, test } from "vitest";
import { spawnAsync } from "../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";
import { makeTempDirFactory } from "../lib/testing/test-tmpdir.ts";
import {
  copyHarness,
  envWithoutCliVersion,
  expectRunContractUsage,
  type FingerprintFile,
  makeStub,
  repository,
  type ResultFile,
  runEval,
  tempDir,
  writeInstallRecordingStub,
  writeSiblingSkill,
  writeSubjectSkill,
} from "./run-skill-eval-helpers.ts";
import { readJson } from "./read-json-helpers.ts";
import { removePartialTarget } from "./reuse-skill-eval-baseline.ts";

/** socket のパスの長さの上限に収まる、短い /tmp の下の一時ディレクトリ（afterAll で消す）。 */
const shortTempDir = makeTempDirFactory("sk-", "/tmp");

/** codex の without_skill の run を iteration-1 に作り、再利用先として iteration-2 の同じ位置を返す。 */
async function withoutSkillSource() {
  const { directory, stub } = makeStub();
  const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
  const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
  await runEval({
    executor: "codex",
    config: "without_skill",
    prompt: "EXPECT_WITHOUT_SKILL",
    output: source,
    stub,
  });
  return { directory, stub, source, target };
}

describe.concurrent("run-skill-eval executor compatibility", () => {
  test("tells the skill config reader not to read the operator's personal config layer", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    await runEval({
      executor: "codex",
      config: "with_skill",
      prompt: "EXPECT_WITH_SKILL EXPECT_USER_CONFIG_IGNORED",
      output,
      stub,
    });
    expect(readJson(join(output, "result.json")).status).toBe("succeeded");
  });

  test("does not leak an operator-local reviewer override into eval runs", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    await runEval({
      executor: "codex",
      config: "with_skill",
      prompt: "EXPECT_WITH_SKILL EXPECT_REVIEW_ENV_CLEARED",
      output,
      stub,
      env: { SKILLS_REVIEW_TOOL: "codex" },
    });
    expect(readJson(join(output, "result.json")).status).toBe("succeeded");
  });

  test.each([
    {
      executor: "claude-code",
      rawName: "claude-code.jsonl",
      response: "claude stub response",
      totalTokens: 17,
    },
    { executor: "codex", rawName: "codex.jsonl", response: "codex stub response", totalTokens: 20 },
  ])(
    "emits the common run contract for $executor",
    async ({ executor, rawName, response, totalTokens }) => {
      const { claudeMarker, directory, stub } = makeStub();
      const iteration = join(directory, "iteration-1");
      const output = join(iteration, "eval-1", "with_skill", "run-1");

      await runEval({ executor, config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub });

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
          harness_version: "run-skill-eval/5",
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
      expectRunContractUsage(executor, { metrics, result });
      expect(readFileSync(join(output, "project-tree.txt"), "utf8")).not.toMatch(
        /\.(?:agents|claude)\/skills/u,
      );
      if (executor === "codex") {
        expect(existsSync(claudeMarker)).toBe(false);
      }
    },
  );

  // The three ways a with_skill run can relate to the subject skill. Only the third
  // may be dropped from a comparison, so each one has to be distinguishable in the
  // artifact rather than inferred from the score (#377).
  test.each([
    // An invocation names the skill, not a path, so files_read stays empty while read holds.
    ["EXPECT_WITH_SKILL", true, true, [], false],
    ["EXPECT_WITH_SKILL EXPECT_SKILL_SHELL_READ", false, true, ["SKILL.md"], false],
    ["EXPECT_WITH_SKILL EXPECT_SKILL_UNREAD", false, false, [], true],
    // `$prompt` で名前を作ると、40 文字を超える prompt が切られて名前が変わる。行は配列のまま `%s` で展開し、1 つの残余引数で受ける。
  ])(
    "records skill reads for %s",
    async (...[prompt, invoked, read, expectedPaths, invalidRun]) => {
      const { directory, stub } = makeStub();
      const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");

      await runEval({ executor: "claude-code", config: "with_skill", prompt, output, stub });

      const usage = readJson<ResultFile>(join(output, "result.json")).skill_usage;
      expect(usage).toMatchObject({ visible: true, invoked, read, invalid_run: invalidRun });
      expect(usage.files_read).toEqual(expectedPaths.map((name) => `.claude/skills/box/${name}`));
    },
  );

  // stream-json put intermediate messages and tool inputs into raw/. Scanning that for
  // contamination markers turns a mention into a discarded baseline, so claude-code's
  // raw is out of the scan and the read evidence in skill_usage carries the signal.
  test("does not call a claude baseline contaminated for merely naming a marker", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    await runEval({
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

  test("a baseline that reached the skill is reported as an unexpected read", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    await runEval({
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

  test("Codex baseline stays uninstalled and writes a contamination verdict that treats an unverifiable check as failure", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    await runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output,
      stub,
    });

    expect(readFileSync(join(output, "contamination.txt"), "utf8")).toMatch(/^verdict: clean$/mu);
    expect(readJson<ResultFile>(join(output, "result.json")).executor.name).toBe("codex");
    expect(readJson(join(output, "eval-fingerprint.json"))).toMatchObject({
      algorithm: "sha256",
      inputs: {
        executor: "codex",
        model: "model-stub",
        reasoning_effort: "low",
        harness_version: "run-skill-eval/5",
      },
    });
  });

  // Codex's raw is an event stream too, but unlike claude-code it has always been
  // scanned, so it is narrowed to the surface that can carry a read instead of being
  // dropped (#401). Both sides are pinned: the mention passes, and a read — named in
  // the command or only visible in its output — is still caught.
  test.each([
    ["EXPECT_MARKER_MENTION", "clean"],
    ["EXPECT_MARKER_READ", "CONTAMINATED"],
    ["EXPECT_MARKER_IN_OUTPUT", "CONTAMINATED"],
  ])("judges a codex baseline with %s as %s", async (marker, verdict) => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    const run = () =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: `EXPECT_WITHOUT_SKILL ${marker}`,
        output,
        stub,
      });
    if (verdict === "clean") {
      await run();
    } else {
      await expect(run()).rejects.toThrow(expect.objectContaining({ status: 4 }));
    }

    const contamination = readFileSync(join(output, "contamination.txt"), "utf8");
    expect(contamination).toMatch(new RegExp(`^verdict: ${verdict}$`, "mu"));
    expect(contamination).toMatch(/^scanned: .*\/contamination-surface$/mu);
    expect(contamination).not.toMatch(/\/raw(?:\s|$)/mu);
    if (verdict === "CONTAMINATED") {
      expect(contamination).toMatch(
        /^references\/oauth-setup\.md\t.*contamination-surface\/codex\.jsonl$/mu,
      );
    }
  });

  test("calls a codex baseline CHECK-BROKEN when its contamination surface is empty", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    await expect(
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL EXPECT_CODEX_SURFACE_EMPTY",
        output,
        stub,
      }),
    ).rejects.toThrow(expect.objectContaining({ status: 4 }));

    const contamination = readFileSync(join(output, "contamination.txt"), "utf8");
    expect(contamination).toMatch(/^verdict: CHECK-BROKEN$/mu);
    expect(contamination).toMatch(/^codex contamination surface is empty or unreadable;/mu);
  });

  test("infers the eval id before fingerprinting so ordinary runs include assertions", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");

    await runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output,
      stub,
      evalId: null,
    });

    const fingerprint = readJson<FingerprintFile>(join(output, "eval-fingerprint.json"));
    const metadata = readJson(join(output, "eval_metadata.json"));
    expect(fingerprint.inputs.eval_id).toBe("1");
    expect(fingerprint.inputs.assertions).toEqual(metadata.assertions);
    expect(fingerprint.inputs.assertions.length).toBeGreaterThan(0);
  });

  test("reuses only a matching successful clean baseline and records its provenance", async () => {
    const { directory, invocationLog, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    await runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });

    await runEval({
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
      harness_version: "run-skill-eval/5",
    });
    expect(readJson(join(target, "eval-fingerprint.json"))).toEqual(
      readJson(join(source, "eval-fingerprint.json")),
    );
    expect(readFileSync(invocationLog, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test.each([
    ["changed prompt", { prompt: "CHANGED EXPECT_WITHOUT_SKILL" }],
    ["changed model", { model: "different-model" }],
  ])(
    "rejects baseline reuse with %s",
    async (_label, mutation: { prompt?: string; model?: string }) => {
      const { stub, source, target } = await withoutSkillSource();
      const result = await spawnAsync(
        join(repository, "scripts", "eval", "run-skill-eval.sh"),
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
          timeout: CHILD_TIMEOUT_MS,
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
    },
  );

  test("rejects reuse when a required source artifact is missing", async () => {
    const { stub, source, target } = await withoutSkillSource();
    rmSync(join(source, "result.json"));
    await expect(
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  test("rejects a baseline whose read isolation is not trusted", async () => {
    const { stub, source, target } = await withoutSkillSource();
    writeFileSync(join(source, "isolation.txt"), "isolation: UNISOLATED (bwrap missing)\n", "utf8");

    await expect(
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  // The sandbox moved from scripts/ to scripts/eval/ (Issue #514). Baselines recorded
  // before the move carry the old label and must stay reusable; any other path must not.
  test.each([
    ["the pre-move sandbox path", "isolation: sandboxed (scripts/eval-sandbox.sh)", true],
    ["an unknown sandbox path", "isolation: sandboxed (scripts/other/eval-sandbox.sh)", false],
  ])("isolation label with %s", async (_, label, reusable) => {
    const { stub, source, target } = await withoutSkillSource();
    writeFileSync(join(source, "isolation.txt"), `${label}\n`, "utf8");

    const reuse = () =>
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      });
    if (reusable) {
      await reuse();
      expect(readJson(join(target, "baseline-reuse.json"))).toMatchObject({ reused_from: source });
    } else {
      await expect(reuse()).rejects.toThrow();
      expect(existsSync(target)).toBe(false);
    }
  });

  test("rejects a complete baseline artifact stored outside without_skill/run-N", async () => {
    const { directory, stub } = makeStub();
    const source = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    const target = join(directory, "iteration-2", "eval-1", "without_skill", "run-1");
    await runEval({
      executor: "codex",
      config: "without_skill",
      prompt: "EXPECT_WITHOUT_SKILL",
      output: source,
      stub,
    });

    await expect(
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  test("rejects baseline reuse without an explicit eval id before fingerprinting", async () => {
    const { stub, source, target } = await withoutSkillSource();

    const result = await spawnAsync(
      join(repository, "scripts", "eval", "run-skill-eval.sh"),
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
        timeout: CHILD_TIMEOUT_MS,
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

  test("rejects baseline reuse when the executor CLI version is unknown", async () => {
    const { directory, stub, source, target } = await withoutSkillSource();
    const env = envWithoutCliVersion(directory, stub);
    const result = await spawnAsync(
      join(repository, "scripts", "eval", "run-skill-eval.sh"),
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
      { timeout: CHILD_TIMEOUT_MS, env },
    );

    expect(result.status).toBe(6);
    expect(result.stderr).toMatch(/CLI version could not be determined/u);
    expect(existsSync(target)).toBe(false);
  });

  test.each([
    ["model", ["--reasoning-effort", "low"]],
    ["reasoning effort", ["--model", "model-stub"]],
  ])("rejects baseline reuse without an explicit %s", async (_label, executionArgs) => {
    const { stub, source, target } = await withoutSkillSource();

    const result = await spawnAsync(
      join(repository, "scripts", "eval", "run-skill-eval.sh"),
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
        timeout: CHILD_TIMEOUT_MS,
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
      (source: string) => {
        const path = join(source, "eval-fingerprint.json");
        const fingerprint = readJson(path);
        fingerprint.schema_version = 2;
        writeFileSync(path, `${JSON.stringify(fingerprint)}\n`, "utf8");
      },
      /fingerprint metadata is unsupported/u,
    ],
    [
      "raw trace",
      (source: string) => {
        const result = readJson<ResultFile>(join(source, "result.json"));
        rmSync(join(source, result.raw_trace));
      },
      /raw trace missing or empty/u,
    ],
  ])("rejects reuse with invalid %s", async (_label, mutate, errorPattern) => {
    const { stub, source, target } = await withoutSkillSource();
    mutate(source);

    await expect(
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    const result = await reuseDirectly(source, target);
    expect(result.stderr).toMatch(errorPattern);
  });

  test.each([
    [
      "required artifact",
      (source: string, external: string) => {
        const artifact = join(source, "timing.json");
        rmSync(artifact);
        symlinkSync(external, artifact);
      },
    ],
    [
      "raw trace",
      (source: string, external: string) => {
        const result = readJson<ResultFile>(join(source, "result.json"));
        const rawTrace = join(source, result.raw_trace);
        rmSync(rawTrace);
        symlinkSync(external, rawTrace);
      },
    ],
  ])("rejects a symlinked %s", async (_label, replaceWithSymlink) => {
    const { directory, stub, source, target } = await withoutSkillSource();
    const external = join(directory, "external-artifact");
    writeFileSync(external, "external\n", "utf8");
    replaceWithSymlink(source, external);

    await expect(
      runEval({
        executor: "codex",
        config: "without_skill",
        prompt: "EXPECT_WITHOUT_SKILL",
        output: target,
        reuseBaseline: source,
        stub,
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  /** raw_trace を、source の中の dir（シンボリックリンク）の下のファイルに付け替える。 */
  function pointRawTraceThrough(source: string, linkTarget: string, rawName: string) {
    symlinkSync(linkTarget, join(source, "via"));
    const resultPath = join(source, "result.json");
    const result = readJson<ResultFile>(resultPath);
    writeFileSync(resultPath, `${JSON.stringify({ ...result, raw_trace: `via/${rawName}` })}\n`);
  }

  function reuseDirectly(source: string, target: string) {
    return spawnAsync(
      "node",
      [
        join(repository, "scripts", "eval", "reuse-skill-eval-baseline.ts"),
        source,
        target,
        join(source, "eval-fingerprint.json"),
      ],
      { timeout: CHILD_TIMEOUT_MS },
    );
  }

  test.each([
    [
      "a directory link to outside that raw_trace reads through",
      "via",
      (directory: string, source: string) => {
        const outside = join(directory, "outside");
        mkdirSync(outside);
        writeFileSync(join(outside, "trace.jsonl"), "{}\n", "utf8");
        pointRawTraceThrough(source, relative(source, outside), "trace.jsonl");
      },
    ],
    [
      "a parent directory of a required artifact linked to outside",
      "outputs",
      (directory: string, source: string) => {
        const outside = join(directory, "outside-outputs");
        renameSync(join(source, "outputs"), outside);
        symlinkSync(relative(source, outside), join(source, "outputs"));
      },
    ],
    [
      "a file link to outside that no artifact names",
      "project-files/leak.txt",
      (directory: string, source: string) => {
        writeFileSync(join(directory, "secret.txt"), "secret\n", "utf8");
        symlinkSync(
          relative(join(source, "project-files"), join(directory, "secret.txt")),
          join(source, "project-files", "leak.txt"),
        );
      },
    ],
    [
      "a relative directory link inside the source",
      "via",
      (_directory: string, source: string) => {
        const rawName = basename(readJson<ResultFile>(join(source, "result.json")).raw_trace);
        pointRawTraceThrough(source, "raw", rawName);
      },
    ],
    [
      "an absolute directory link inside the source",
      "via",
      (_directory: string, source: string) => {
        const rawName = basename(readJson<ResultFile>(join(source, "result.json")).raw_trace);
        pointRawTraceThrough(source, join(source, "raw"), rawName);
      },
    ],
    [
      "a file link inside the source",
      "project-files/alias.txt",
      (_directory: string, source: string) => {
        writeFileSync(join(source, "project-files", "real.txt"), "real\n", "utf8");
        symlinkSync("real.txt", join(source, "project-files", "alias.txt"));
      },
    ],
    [
      "a dangling link",
      "via",
      (_directory: string, source: string) => {
        pointRawTraceThrough(source, join("raw", "missing"), "x.jsonl");
      },
    ],
    [
      "a link to a directory that contains it",
      "raw/loop",
      (_directory: string, source: string) => {
        symlinkSync("..", join(source, "raw", "loop"));
      },
    ],
  ])("rejects %s, since the baseline contains no symlinks", async (_label, name, addLink) => {
    const { directory, source, target } = await withoutSkillSource();
    addLink(directory, source);

    const result = await reuseDirectly(source, target);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`baseline contains a symlink: ${name}\n`);
    expect(existsSync(target)).toBe(false);
  });

  test.each([
    ["points at a real run", (real: string, _source: string) => real],
    ["points at nothing", (real: string, _source: string) => `${real}-missing`],
    ["points at itself", (_real: string, source: string) => source],
  ])("rejects a source run directory that is itself a symlink that %s", async (_label, linkTo) => {
    const { directory, source, target } = await withoutSkillSource();
    const real = join(directory, "real-run");
    renameSync(source, real);
    symlinkSync(linkTo(real, source), source);

    const result = await reuseDirectly(source, target);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("baseline contains a symlink: .\n");
    expect(existsSync(target)).toBe(false);
  });

  test.each([
    [
      "a FIFO",
      async (path: string) => {
        execFileSync("mkfifo", [path], { timeout: CHILD_TIMEOUT_MS });
        return () => {};
      },
    ],
    [
      "a socket",
      async (path: string) => {
        // socket のパスには上限（約 104〜108 バイト）があるので、短い /tmp の下で listen してから移す。
        const short = shortTempDir("s");
        const server = createServer();
        // listen の失敗は error イベントで届くので、待ち続けないように reject する。
        await new Promise<void>((done, fail) => {
          server.once("error", fail);
          server.listen(join(short, "s"), done);
        });
        try {
          renameSync(join(short, "s"), path);
        } catch (error) {
          server.close();
          throw error;
        }
        return () => server.close();
      },
    ],
  ])("rejects %s inside the source", async (_label, create) => {
    const { source, target } = await withoutSkillSource();
    const close = await create(join(source, "project-files", "special"));
    try {
      const result = await reuseDirectly(source, target);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "baseline contains an entry that is not a file or directory: project-files/special\n",
      );
      expect(existsSync(target)).toBe(false);
    } finally {
      close();
    }
  });

  // root はファイルの権限を無視して読めるので、読めないファイルを作れない。
  test.skipIf(process.getuid?.() === 0)(
    "removes the partly copied target when the copy fails on an unreadable file",
    async () => {
      const { source, target } = await withoutSkillSource();
      const unreadable = join(source, "project-files", "unreadable.txt");
      writeFileSync(unreadable, "secret\n", "utf8");
      chmodSync(unreadable, 0o000);

      const result = await reuseDirectly(source, target);

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/EACCES/u);
      expect(existsSync(target)).toBe(false);
    },
  );

  /** chmod -R a-w と同じく、木のファイルとディレクトリから書き込みを外す。戻すときは mode に 0o755 / 0o644 を渡す。 */
  function setTreeMode(root: string, directoryMode: number, fileMode: number): void {
    for (const name of readdirSync(root)) {
      const path = join(root, name);
      if (lstatSync(path).isDirectory()) setTreeMode(path, directoryMode, fileMode);
      else chmodSync(path, fileMode);
    }
    chmodSync(root, directoryMode);
  }

  // root はファイルの権限を無視して書けるので、読み取り専用の木を作れない。
  test.skipIf(process.getuid?.() === 0)(
    "reuses a read-only source and leaves the copied tree writable",
    async () => {
      const { source, target } = await withoutSkillSource();
      // 前に再利用した run には baseline-reuse.json があり、chmod -R a-w ではそれも読み取り専用になる。
      writeFileSync(join(source, "baseline-reuse.json"), "{}\n", "utf8");
      setTreeMode(source, 0o555, 0o444);
      try {
        const result = await reuseDirectly(source, target);

        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        for (const path of [target, join(target, "outputs"), join(target, "baseline-reuse.json")]) {
          expect(lstatSync(path).mode & 0o200).toBe(0o200);
        }
        expect(readFileSync(join(target, "baseline-reuse.json"), "utf8")).toContain("reused_from");
      } finally {
        setTreeMode(source, 0o755, 0o644);
      }
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "reports both failures when the partly copied target cannot be removed",
    () => {
      const { directory } = makeStub();
      const parent = join(directory, "read-only-parent");
      const target = join(parent, "run-1");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "partial.txt"), "partial\n", "utf8");
      // target の親に書き込めないと、target の中を書き込めるようにしても target 自体を消せない。
      chmodSync(parent, 0o555);
      try {
        expect(() => removePartialTarget(target, new Error("copy failed"))).toThrow(
          /^copy failed; the partly copied target could not be removed: .*EACCES/u,
        );
      } finally {
        chmodSync(parent, 0o755);
      }
    },
  );

  test("accepts a hard link to a file outside the source and copies it as a regular file", async () => {
    const { directory, source, target } = await withoutSkillSource();
    const outside = join(directory, "shared.txt");
    writeFileSync(outside, "shared\n", "utf8");
    linkSync(outside, join(source, "project-files", "shared.txt"));

    const result = await reuseDirectly(source, target);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const copied = join(target, "project-files", "shared.txt");
    expect(lstatSync(copied).isFile()).toBe(true);
    expect(lstatSync(copied).nlink).toBe(1);
    expect(readFileSync(copied, "utf8")).toBe("shared\n");
  });

  test("rejects an absolute raw_trace even when it points inside the source", async () => {
    const { source, target } = await withoutSkillSource();
    const resultPath = join(source, "result.json");
    const recorded = readJson<ResultFile>(resultPath);
    writeFileSync(
      resultPath,
      `${JSON.stringify({ ...recorded, raw_trace: join(source, recorded.raw_trace) })}\n`,
    );

    const result = await reuseDirectly(source, target);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/baseline raw_trace must be relative/u);
    expect(existsSync(target)).toBe(false);
  });

  test("accepts a source reached through a symlinked ancestor directory", async () => {
    const { directory, source, target } = await withoutSkillSource();
    const alias = join(directory, "alias");
    symlinkSync(join(directory, "iteration-1"), alias);

    const result = await reuseDirectly(join(alias, "eval-1", "without_skill", "run-1"), target);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(existsSync(join(target, "baseline-reuse.json"))).toBe(true);
    expect(existsSync(source)).toBe(true);
  });

  test("rejects a target that is a dangling symlink into the source without aborting", async () => {
    const { directory, source } = await withoutSkillSource();
    const target = join(directory, "dangling-target");
    symlinkSync(join(source, "nested"), target);

    const result = await reuseDirectly(source, target);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`reuse target already exists: ${target}`);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(existsSync(join(source, "nested"))).toBe(false);
  });

  test("rejects the source itself as the target with the nesting message", async () => {
    const { source } = await withoutSkillSource();

    const result = await reuseDirectly(source, source);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/reuse target must not be the source or nested inside it/u);
  });

  test("reports a target under a regular file as unresolvable", async () => {
    const { directory, source } = await withoutSkillSource();
    writeFileSync(join(directory, "plain"), "x\n", "utf8");
    const target = join(directory, "plain", "run-1");

    const result = await reuseDirectly(source, target);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`reuse target cannot be resolved: ${target}: `);
  });

  test("rejects a target nested inside the source when the source is reached through a symlink", async () => {
    const { directory, source } = await withoutSkillSource();
    const alias = join(directory, "alias");
    symlinkSync(join(directory, "iteration-1"), alias);

    const result = await reuseDirectly(
      join(alias, "eval-1", "without_skill", "run-1"),
      join(source, "nested"),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/reuse target must not be the source or nested inside it/u);
    expect(existsSync(join(source, "nested"))).toBe(false);
  });

  test("keeps Claude Code as the default executor for existing callers", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");

    await runEval({ config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub });

    expect(readJson(join(output, "result.json"))).toMatchObject({
      executor: { name: "claude-code", cli_version: "claude-code stub-version" },
      result: "claude stub response",
    });
  });

  test("reports only captured files created after fixture seeding", async () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(fixture);
    writeFileSync(join(fixture, "existing.txt"), "fixture\n", "utf8");

    await runEval({
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

  test("runs an executable fixture setup before the executor and initial manifest", async () => {
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

    await runEval({
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

  test("fails before starting the executor when fixture setup fails", async () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(fixture);
    const setup = join(fixture, "setup.sh");
    writeFileSync(setup, "#!/usr/bin/env bash\nexit 23\n", "utf8");
    chmodSync(setup, 0o755);

    await expect(
      runEval({ config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub, fixture }),
    ).rejects.toThrow();
    expect(existsSync(output)).toBe(false);
  });

  test("does not execute a fixture setup.sh directory", async () => {
    const { directory, stub } = makeStub();
    const fixture = join(directory, "fixture");
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    mkdirSync(join(fixture, "setup.sh"), { recursive: true });

    await runEval({ config: "with_skill", prompt: "EXPECT_WITH_SKILL", output, stub, fixture });

    expect(readJson(join(output, "result.json")).status).toBe("succeeded");
  });

  test("returns exit 5 when normalization and the executor both fail", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "without_skill", "run-1");
    const result = await spawnAsync(
      join(repository, "scripts", "eval", "run-skill-eval.sh"),
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
        timeout: CHILD_TIMEOUT_MS,
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

  test("rejects unsafe reasoning effort before starting the executor", async () => {
    const { directory, stub } = makeStub();
    const output = join(directory, "iteration-1", "eval-1", "with_skill", "run-1");
    const result = await spawnAsync(
      join(repository, "scripts", "eval", "run-skill-eval.sh"),
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
        timeout: CHILD_TIMEOUT_MS,
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

describe.concurrent("run-skill-eval required sibling skills", () => {
  // A throwaway repository with a subject skill and a sibling, so the harness can be
  // driven with a requires_skills declaration no real skill needs to carry. The
  // harness runs its helpers from <repo>/scripts/eval, so they are placed there.
  function makeRepository(evalDefinition: Record<string, unknown>) {
    const root = tempDir("skill-eval-required-");
    copyHarness(root);
    // The helpers import scripts/lib, which has no main() and imports js-yaml, so it
    // is symlinked: Node resolves it to the repository, where node_modules exists.
    symlinkSync(join(repository, "scripts", "lib"), join(root, "scripts", "lib"));
    writeSubjectSkill(root, evalDefinition);
    const sibling = writeSiblingSkill(root);
    const { installedFilesLog, installedLog, stub } = writeInstallRecordingStub(root);
    return { installedFilesLog, installedLog, root, sibling, stub };
  }

  async function run(
    { root, stub }: { root: string; stub: string },
    config: string,
    prompt = "PROMPT",
  ) {
    const output = join(root, "iteration-1", "eval-1", config, "run-1");
    const result = await spawnAsync(
      join(root, "scripts", "eval", "run-skill-eval.sh"),
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
        timeout: CHILD_TIMEOUT_MS,
        env: { ...process.env, SKILL_EVAL_RUNNER: stub, SKILL_EVAL_CLI_VERSION: "stub-version" },
      },
    );
    return { output, result };
  }

  test("installs declared siblings in both configurations and the subject for with_skill only", async () => {
    // The comparison must differ only by the subject skill: a sibling installed for
    // with_skill alone would credit the sibling's instructions to the subject.
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const { output, result } = await run(fixture, "with_skill");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(fixture.installedLog, "utf8")).toBe(
      ".claude/skills/sibling-skill/SKILL.md\n.claude/skills/subject-skill/SKILL.md\n",
    );
    expect(readFileSync(join(output, "isolation.txt"), "utf8")).toMatch(
      /^required_skills: sibling-skill$/mu,
    );
    // The eval declares requires_skills, so the fingerprint records them.
    const requiredSkills = readJson<FingerprintFile>(join(output, "eval-fingerprint.json")).inputs
      .required_skills;
    assert.exists(requiredSkills, "eval-fingerprint.json に required_skills が無い");
    const [recorded] = requiredSkills;
    expect(recorded).toMatchObject({ name: "sibling-skill" });
    expect(recorded.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const baseline = await run(fixture, "without_skill");
    expect(baseline.result.status, baseline.result.stderr).toBe(0);
    expect(readFileSync(fixture.installedLog, "utf8")).toBe(
      ".claude/skills/sibling-skill/SKILL.md\n",
    );
    expect(
      readJson<FingerprintFile>(join(baseline.output, "eval-fingerprint.json")).inputs
        .required_skills,
    ).toEqual([recorded]);
  });

  test("installs config-schemas/ and checks.json with the subject, as gh skill install does", async () => {
    // Copying only SKILL.md/references/assets/scripts made skill-config.mjs fail with a
    // missing schema inside every with_skill run, which the distributed skill never sees.
    const fixture = makeRepository({});
    const { result } = await run(fixture, "with_skill");

    expect(result.status, result.stderr).toBe(0);
    const installed = readFileSync(fixture.installedFilesLog, "utf8").split("\n");
    expect(installed).toContain(
      ".claude/skills/subject-skill/config-schemas/subject-skill.schema.json",
    );
    expect(installed).toContain(".claude/skills/subject-skill/checks.json");
  });

  test("changes the fingerprint when an installed sibling changes", async () => {
    // A reused baseline ran with the sibling's content; a changed sibling is a changed input.
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const before = await run(fixture, "without_skill");
    const beforeFingerprint = readJson(join(before.output, "eval-fingerprint.json")).fingerprint;
    rmSync(before.output, { recursive: true, force: true });
    writeFileSync(
      join(fixture.sibling, "scripts", "sibling-tool.mjs"),
      "export const v = 2;\n",
      "utf8",
    );
    const after = await run(fixture, "without_skill");

    expect(after.result.status, after.result.stderr).toBe(0);
    expect(readJson(join(after.output, "eval-fingerprint.json")).fingerprint).not.toBe(
      beforeFingerprint,
    );
  });

  test("installs only the subject and leaves the fingerprint unchanged without a declaration", async () => {
    const fixture = makeRepository({});
    const { output, result } = await run(fixture, "with_skill");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(fixture.installedLog, "utf8")).toBe(
      ".claude/skills/subject-skill/SKILL.md\n",
    );
    expect(readJson(join(output, "eval-fingerprint.json")).inputs).not.toHaveProperty(
      "required_skills",
    );
  });

  test("does not flag a baseline that cites the installed sibling, including a path both skills ship", async () => {
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const { output, result } = await run(fixture, "without_skill", "CITE_SIBLING");

    expect(result.status, readFileSync(join(output, "stderr.log"), "utf8")).toBe(0);
    const verdict = readFileSync(join(output, "contamination.txt"), "utf8");
    expect(verdict).toMatch(/^verdict: clean$/mu);
    const markersLine = verdict.match(/^markers: (.*)$/mu);
    assert.exists(markersLine, "contamination.txt に markers の行が無い");
    const markers = markersLine[1].split(" ");
    expect(markers).toContain("references/subject-guide.md");
    expect(markers).not.toContain("assets/shared-template.json");
    expect(markers).not.toContain("references/handoff.md");
  });

  test("still flags a baseline that cites the subject's bundle when siblings are installed", async () => {
    const fixture = makeRepository({ requires_skills: ["sibling-skill"] });
    const { output, result } = await run(fixture, "without_skill", "CITE_SUBJECT");

    expect(result.status).toBe(4);
    const verdict = readFileSync(join(output, "contamination.txt"), "utf8");
    expect(verdict).toMatch(/^verdict: CONTAMINATED$/mu);
    expect(verdict).toMatch(/^references\/subject-guide\.md\t/mu);
  });

  test.each([
    {
      label: "a non-array",
      definition: { requires_skills: "sibling-skill" },
      status: 5,
      message: /non-empty array/u,
    },
    {
      label: "an empty array",
      definition: { requires_skills: [] },
      status: 5,
      message: /non-empty array/u,
    },
    {
      label: "a non-kebab name",
      definition: { requires_skills: ["../sibling-skill"] },
      status: 5,
      message: /invalid skill name/u,
    },
    {
      label: "a non-string name",
      definition: { requires_skills: [1] },
      status: 5,
      message: /invalid skill name/u,
    },
    {
      label: "a duplicate",
      definition: { requires_skills: ["sibling-skill", "sibling-skill"] },
      status: 5,
      message: /twice/u,
    },
    {
      label: "the subject itself",
      definition: { requires_skills: ["subject-skill"] },
      status: 5,
      message: /subject skill itself/u,
    },
    {
      label: "a missing sibling",
      definition: { requires_skills: ["absent-skill"] },
      status: 1,
      message: /required skill source not found/u,
    },
  ])("fails before the executor on $label", async ({ definition, status, message }) => {
    const fixture = makeRepository(definition);
    const { output, result } = await run(fixture, "with_skill");

    expect(result.status).toBe(status);
    expect(result.stderr).toMatch(message);
    expect(existsSync(fixture.installedLog)).toBe(false);
    expect(existsSync(output)).toBe(false);
  });
});
