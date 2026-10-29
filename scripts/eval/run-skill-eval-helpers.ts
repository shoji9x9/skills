// run-skill-eval.test.ts のヘルパー（executor のスタブを作り、run-skill-eval.sh を子プロセスで起動する）。
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { makeTempDirFactory } from "../lib/testing/test-tmpdir.ts";
import { spawnAsync } from "../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// **テストは `describe.concurrent` で並べて実行する**（Issue #590）。どのテストも run-skill-eval.sh の子プロセスの終了を
// 待つだけなので、並べた分だけ 1 回の実行が縮み、ミューテーションテストでは変異の数だけ反映される。
// そのため、テストの間で状態を共有しない。スタブと出力はテストごとに別の一時ディレクトリに作る（`tempDir`）。
// 子に渡す環境変数は `process.env` を書き換えず、`runEval` の `env` で渡す（書き換えると並んだテストの子にも渡る）。
export const tempDir = makeTempDirFactory("skill-eval-");

// executor のスタブのうち、呼び出しの記録を書く行より後の本文。prompt に含めた EXPECT_* の印で振る舞いを変える。
const EXECUTOR_STUB_BODY = `args="$*"
if [[ "$args" == *EXPECT_EXECUTOR_AND_NORMALIZER_FAIL* ]]; then
  printf 'not-json\n'
  exit 7
fi
if [[ "$args" == *EXPECT_REVIEW_ENV_CLEARED* ]]; then test -z "\${SKILLS_REVIEW_TOOL+x}"; fi
if [[ "$args" == *EXPECT_USER_CONFIG_IGNORED* ]]; then test "\${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG-}" = 1; fi
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
  if [[ "$args" == *EXPECT_CODEX_SURFACE_EMPTY* ]]; then
    printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"codex stub response"}}'
    exit 0
  fi
  printf '%s\n' '{"type":"thread.started","thread_id":"stub"}'
  # Codex emits item.started and item.completed for each command, like the real trace.
  codex_command() {
    printf '{"type":"item.started","item":{"id":"c1","type":"command_execution","command":%s,"aggregated_output":"","exit_code":null,"status":"in_progress"}}\n' "$1"
    printf '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":%s,"aggregated_output":%s,"exit_code":0,"status":"completed"}}\n' "$1" "$2"
  }
  if [[ "$args" == *EXPECT_MARKER_MENTION* ]]; then
    printf '%s\n' '{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"I will not open references/oauth-setup.md"}}'
    codex_command '"/bin/bash -lc '"'"'echo references/oauth-setup.md'"'"'"' '"references/oauth-setup.md\\n"'
  elif [[ "$args" == *EXPECT_MARKER_READ* ]]; then
    codex_command '"/bin/bash -lc '"'"'cat /src/skills/box/references/oauth-setup.md | head -5'"'"'"' '"# OAuth\\n"'
  elif [[ "$args" == *EXPECT_MARKER_IN_OUTPUT* ]]; then
    codex_command '"/bin/bash -lc '"'"'cat /src/skills/box/SKILL.md'"'"'"' '"See references/oauth-setup.md\\n"'
  fi
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
`;

export function makeStub() {
  const directory = tempDir("skill-eval-stub-");
  const stub = join(directory, "executor-stub.sh");
  const claudeMarker = join(directory, "claude-was-invoked");
  const invocationLog = join(directory, "executor-invocations");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'invoked\n' >>${JSON.stringify(invocationLog)}
${EXECUTOR_STUB_BODY}`,
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

export type RunEvalOptions = {
  executor?: string;
  config: string;
  prompt: string;
  output: string;
  stub: string;
  fixture?: string;
  reuseBaseline?: string;
  evalId?: string | null;
  env?: Record<string, string>;
};

/** runEval が run-skill-eval.sh に渡す引数を組み立てる。 */
function runEvalArgs({
  executor,
  config,
  prompt,
  output,
  fixture,
  reuseBaseline,
  evalId = "1",
}: RunEvalOptions) {
  const executorArgs = executor ? ["--executor", executor] : [];
  const fixtureArgs = fixture ? ["--fixture", fixture] : [];
  const reuseArgs = reuseBaseline ? ["--reuse-baseline", reuseBaseline] : [];
  const evalArgs = evalId === null ? [] : ["--eval-id", evalId];
  return [
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
  ];
}

/**
 * run-skill-eval.sh を実行する。`execFileSync` と同じく、0 以外で終わったら `status` を持つ例外にする。
 */
export async function runEval(options: RunEvalOptions) {
  const { executor, config, output, stub, reuseBaseline, env = {} } = options;
  const effectiveExecutor = executor ?? "claude-code";
  const res = await spawnAsync(
    join(repository, "scripts", "eval", "run-skill-eval.sh"),
    runEvalArgs(options),
    {
      timeout: CHILD_TIMEOUT_MS,
      env: {
        ...process.env,
        PATH: `${dirname(stub)}:${process.env.PATH}`,
        SKILL_EVAL_RUNNER: stub,
        SKILL_EVAL_CLI_VERSION: `${effectiveExecutor} stub-version`,
        ...env,
      },
    },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw Object.assign(new Error(`run-skill-eval.sh exited ${res.status}: ${res.stderr}`), {
      status: res.status,
      stdout: res.stdout,
      stderr: res.stderr,
    });
  }
  if (config === "without_skill" && !reuseBaseline) {
    const isolationPath = join(output, "isolation.txt");
    const isolation = readFileSync(isolationPath, "utf8").replace(
      /^isolation: .*$/mu,
      "isolation: sandboxed (scripts/eval/eval-sandbox.sh)",
    );
    writeFileSync(isolationPath, isolation, "utf8");
  }
}

// The parts of result.json and eval-fingerprint.json these tests read.
export type ResultFile = {
  raw_trace: string;
  executor: { name: unknown };
  skill_usage: { files_read?: unknown; [key: string]: unknown };
};
export type FingerprintFile = {
  inputs: {
    assertions: unknown[];
    required_skills?: { name: unknown; sha256: string }[];
    [key: string]: unknown;
  };
};

/** with_skill の run の metrics と skill_usage を、executor ごとの共通の取り決めと突き合わせる。 */
export function expectRunContractUsage(
  executor: string,
  { metrics, result }: { metrics: Record<string, unknown>; result: Record<string, unknown> },
) {
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
}

/** バージョンを答えない codex を PATH の先頭に置き、SKILL_EVAL_CLI_VERSION を外した環境を返す。 */
export function envWithoutCliVersion(directory: string, stub: string) {
  const fakeCodex = join(directory, "codex");
  writeFileSync(fakeCodex, "#!/usr/bin/env bash\nexit 91\n", "utf8");
  chmodSync(fakeCodex, 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    SKILL_EVAL_RUNNER: stub,
  };
  delete env.SKILL_EVAL_CLI_VERSION;
  return env;
}

/** run-skill-eval.sh と、それが呼ぶスクリプトを root にコピーする。 */
export function copyHarness(root: string) {
  mkdirSync(join(root, "scripts", "eval"), { recursive: true });
  for (const name of [
    "run-skill-eval.sh",
    "normalize-skill-eval-result.ts",
    "skill-eval-fingerprint.ts",
    "reuse-skill-eval-baseline.ts",
  ]) {
    writeFileSync(
      join(root, "scripts", "eval", name),
      readFileSync(join(repository, "scripts", "eval", name)),
    );
    chmodSync(join(root, "scripts", "eval", name), 0o755);
  }
}

/** 対象のスキル subject-skill と、その evals.json を root に書く。 */
export function writeSubjectSkill(root: string, evalDefinition: Record<string, unknown>) {
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
  // 配布先には届く同梱物。設定を読むスキルは、run の中で config-schemas/ を読む。
  mkdirSync(join(subject, "config-schemas"));
  writeFileSync(join(subject, "config-schemas", "subject-skill.schema.json"), "{}\n", "utf8");
  writeFileSync(join(subject, "checks.json"), "{}\n", "utf8");
  writeFileSync(
    join(subjectEvals, "evals.json"),
    `${JSON.stringify({ evals: [{ id: 1, prompt: "p", assertions: ["a"], ...evalDefinition }] })}\n`,
    "utf8",
  );
}

/** 兄弟のスキル sibling-skill を root に書き、そのディレクトリを返す。 */
export function writeSiblingSkill(root: string) {
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
  return sibling;
}

/** インストールされたスキルを記録する executor のスタブを root に書く。 */
export function writeInstallRecordingStub(root: string) {
  const stub = join(root, "stub.sh");
  const installedLog = join(root, "installed");
  const installedFilesLog = join(root, "installed-files");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -euo pipefail
{ find .claude/skills -name SKILL.md 2>/dev/null || true; } | LC_ALL=C sort >${JSON.stringify(installedLog)}
{ find .claude/skills -type f 2>/dev/null || true; } | LC_ALL=C sort >${JSON.stringify(installedFilesLog)}
text="stub response"
if [[ "$*" == *CITE_SIBLING* ]]; then text="ran scripts/sibling-tool.mjs with assets/shared-template.json"; fi
if [[ "$*" == *CITE_SUBJECT* ]]; then text="read references/subject-guide.md"; fi
printf '{"result":"%s","is_error":false,"num_turns":1,"usage":{"input_tokens":1,"output_tokens":1}}\\n' "$text"
`,
    "utf8",
  );
  chmodSync(stub, 0o755);
  return { installedFilesLog, installedLog, stub };
}
