// run-skill-eval.sh が、読み取りの隔離を確かめられない run を executor の起動前に止めるかのテスト（Issue #1020）。
//
// 入力の状態は、runner の指定 × sandbox の有無 × bwrap の有無 × SKILL_EVAL_ALLOW_UNISOLATED の値である。
// | runner の指定                         | sandbox     | bwrap | 判定         |
// | ------------------------------------- | ----------- | ----- | ------------ |
// | 無い                                  | 実行可能    | 在る  | sandboxed    |
// | 無い                                  | 無い・非実行 | 在る  | UNISOLATED   |
// | 無い                                  | 実行可能    | 無い  | UNISOLATED   |
// | sandbox の絶対パス・シンボリックリンク | 実行可能    | 在る  | sandboxed    |
// | 無い・sandbox のリンク先の実体         | <repo>/scripts/eval/sandbox/ の外へのシンボリックリンク | 在る | UNISOLATED |
// | 無い                                  | 同じディレクトリの別名へのシンボリックリンク | 在る | UNISOLATED |
// | 無い                                  | scripts/eval/sandbox のディレクトリが外へのシンボリックリンク | 在る | UNISOLATED |
// | sandbox の絶対パス                    | 実行可能    | 無い  | UNISOLATED   |
// | sandbox の相対パス・同名の別ファイル・実在しないパス・スタブ | 実行可能 | 在る | UNVERIFIED |
// sandboxed 以外は、変数が 1 のときだけ続け、未設定・空・1 以外の値では exit 7 で止める。
// --repo がリポジトリへのシンボリックリンクでも、ハーネスは解決してから比べるので、sandbox が実行可能で bwrap が在れば sandboxed になる。
//
// 止まる側のテストは変数を渡さない（ヘルパーのデフォルトに持たせると、止まることを確かめられない）。
// 子の環境からは、操作する人の SKILL_EVAL_RUNNER と SKILL_EVAL_ALLOW_UNISOLATED を消してから、ケースの値を置く。
// bwrap はスタブにし、無い構成は PATH から bwrap だけを除いたディレクトリで作る。本物の bwrap は起動しない。
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { spawnAsync } from "../../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import {
  copyHarness,
  makeStub,
  repository,
  runEval,
  tempDir,
  writeInstallRecordingStub,
  writeSubjectSkill,
} from "./run-skill-eval-helpers.ts";

type Runner =
  | "none"
  | "sandbox"
  | "sandbox-symlink"
  | "sandbox-target"
  | "sandbox-relative"
  | "same-name-copy"
  | "missing"
  | "stub";
type Sandbox = "executable" | "symlink" | "alias" | "dir-link" | "missing" | "not-executable";

type Case = {
  runner: Runner;
  sandbox: Sandbox;
  bwrap: boolean;
  allow: string | undefined;
  /** --repo に、一時のリポジトリへのシンボリックリンクを渡す。 */
  repoLink?: boolean;
};

/** PATH の各ディレクトリの中身を、bwrap だけを除いてリンクしたディレクトリを作る。 */
function linkPathWithoutBwrap(bin: string) {
  const seen = new Set(readdirSync(bin));
  for (const directory of (process.env.PATH ?? "").split(":")) {
    if (directory === "" || !existsSync(directory) || !statSync(directory).isDirectory()) continue;
    for (const name of readdirSync(directory)) {
      if (name === "bwrap" || seen.has(name)) continue;
      seen.add(name);
      symlinkSync(join(directory, name), join(bin, name));
    }
  }
}

/** 一時のリポジトリにハーネス・対象のスキル・スタブ・sandbox・fixture を置く。 */
function makeRepository(sandbox: Sandbox, skill: string) {
  const root = tempDir("skill-eval-isolation-");
  copyHarness(root);
  // ヘルパーは scripts/lib を import するので、node_modules のあるリポジトリへリンクする。
  symlinkSync(join(repository, "scripts", "lib"), join(root, "scripts", "lib"));
  writeSubjectSkill(root, {}, skill);
  const { installedLog, stub } = writeInstallRecordingStub(root);

  const sandboxDir = join(root, "scripts", "eval", "sandbox");
  const sandboxPath = join(sandboxDir, "eval-sandbox.sh");
  const sandboxLog = join(root, "sandbox-invoked");
  const sandboxTarget = sandboxTargetOf(sandbox, root, sandboxDir);
  if (sandbox !== "missing") {
    writeSandbox({ sandbox, sandboxDir, sandboxPath, sandboxTarget });
    writeFileSync(
      sandboxTarget,
      `#!/usr/bin/env bash\nprintf '%s\\n' "\${EVAL_SANDBOX_VENDOR}" >>${JSON.stringify(sandboxLog)}\nexec ${JSON.stringify(stub)} "$@"\n`,
      "utf8",
    );
    chmodSync(sandboxTarget, sandbox === "not-executable" ? 0o644 : 0o755);
  }

  // fixture の setup.sh は、使い捨てのプロジェクトを作った後に実行される。止めた run では実行されない。
  const fixture = join(root, "fixture");
  const setupLog = join(root, "setup-ran");
  mkdirSync(fixture);
  writeFileSync(
    join(fixture, "setup.sh"),
    `#!/usr/bin/env bash\ntouch ${JSON.stringify(setupLog)}\n`,
    "utf8",
  );
  chmodSync(join(fixture, "setup.sh"), 0o755);
  return { root, installedLog, stub, sandboxPath, sandboxTarget, sandboxLog, fixture, setupLog };
}

/**
 * sandbox の実体を置くパスを返す。リンクの構成では、ハーネスの sandbox のパスとは別の場所になる。
 * symlink は <repo>/scripts/eval/sandbox/ の外の実体へのファイルのリンク、alias は同じディレクトリの別名へのリンク、
 * dir-link は scripts/eval/sandbox のディレクトリ自体を外のディレクトリへのリンクにする構成である。
 */
function sandboxTargetOf(sandbox: Sandbox, root: string, sandboxDir: string) {
  if (sandbox === "symlink") return join(root, "real-sandbox", "eval-sandbox.sh");
  if (sandbox === "alias") return join(sandboxDir, "eval-sandbox-impl.sh");
  if (sandbox === "dir-link") return join(root, "sandbox-v2", "eval-sandbox.sh");
  return join(sandboxDir, "eval-sandbox.sh");
}

/** sandbox の実体を置くディレクトリと、構成ごとのリンクを作る。実体の中身は呼び出し元が書く。 */
function writeSandbox({
  sandbox,
  sandboxDir,
  sandboxPath,
  sandboxTarget,
}: {
  sandbox: Sandbox;
  sandboxDir: string;
  sandboxPath: string;
  sandboxTarget: string;
}) {
  mkdirSync(dirname(sandboxTarget), { recursive: true });
  if (sandbox === "dir-link") {
    symlinkSync(dirname(sandboxTarget), sandboxDir);
    return;
  }
  mkdirSync(sandboxDir, { recursive: true });
  if (sandboxTarget !== sandboxPath) symlinkSync(sandboxTarget, sandboxPath);
}

/** ハーネスを起動する PATH を作る。bwrap はスタブを置くか、PATH から除く。 */
function makePath(root: string, stub: string, bwrap: boolean) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  // runner の指定が無く sandbox も使わない構成では、ハーネスは PATH の claude を起動する。
  symlinkSync(stub, join(bin, "claude"));
  if (!bwrap) {
    linkPathWithoutBwrap(bin);
    return bin;
  }
  writeFileSync(join(bin, "bwrap"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  chmodSync(join(bin, "bwrap"), 0o755);
  return `${bin}:${process.env.PATH}`;
}

/** 一時のリポジトリにケースの構成を置き、ハーネスを起動する。skill を渡すと、対象のスキルをその名前で作る。 */
async function runCase(
  { runner, sandbox, bwrap, allow, repoLink = false }: Case,
  skill = "subject-skill",
) {
  const repo = makeRepository(sandbox, skill);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: makePath(repo.root, repo.stub, bwrap),
    SKILL_EVAL_CLI_VERSION: "stub-version",
  };
  delete env.SKILL_EVAL_RUNNER;
  delete env.SKILL_EVAL_ALLOW_UNISOLATED;
  const runnerValue = runnerValueOf(runner, repo);
  if (runnerValue !== undefined) env.SKILL_EVAL_RUNNER = runnerValue;
  if (allow !== undefined) env.SKILL_EVAL_ALLOW_UNISOLATED = allow;

  const output = join(repo.root, "iteration-1", "eval-1", "with_skill", "run-1");
  const repoArgument = repoArgumentOf(repo.root, repoLink);
  const result = await spawnAsync(
    join(repo.root, "scripts", "eval", "run", "run-skill-eval.sh"),
    [
      "--skill",
      skill,
      "--prompt",
      "PROMPT",
      "--config",
      "with_skill",
      "--out",
      output,
      "--model",
      "model-stub",
      "--reasoning-effort",
      "low",
      "--eval-id",
      "1",
      "--fixture",
      repo.fixture,
      "--repo",
      repoArgument,
    ],
    { cwd: repo.root, timeout: CHILD_TIMEOUT_MS, env },
  );
  return {
    result,
    output,
    executorRan: existsSync(repo.installedLog),
    sandboxRan: existsSync(repo.sandboxLog),
    setupRan: existsSync(repo.setupLog),
  };
}

/** --repo に渡す値を返す。repoLink なら、リポジトリへのシンボリックリンクを作って返す。 */
function repoArgumentOf(root: string, repoLink: boolean) {
  if (!repoLink) return root;
  // 一時ディレクトリの外に作ると後片付けされないので、リポジトリの中に自分自身へのリンクを置く。
  const link = join(root, "repo-link");
  symlinkSync(root, link);
  return link;
}

/** ケースの runner の指定を、SKILL_EVAL_RUNNER に渡す値にする。 */
function runnerValueOf(
  runner: Runner,
  {
    root,
    sandboxPath,
    sandboxTarget,
    stub,
  }: { root: string; sandboxPath: string; sandboxTarget: string; stub: string },
) {
  switch (runner) {
    case "none":
      return undefined;
    case "sandbox":
      return sandboxPath;
    case "sandbox-symlink": {
      const link = join(root, "linked-sandbox.sh");
      symlinkSync(sandboxPath, link);
      return link;
    }
    case "sandbox-target":
      return sandboxTarget;
    case "sandbox-relative":
      return join("scripts", "eval", "sandbox", "eval-sandbox.sh");
    case "same-name-copy": {
      const copy = join(root, "copy", "eval-sandbox.sh");
      mkdirSync(join(root, "copy"));
      copyFileSync(sandboxPath, copy);
      chmodSync(copy, 0o755);
      return copy;
    }
    case "missing":
      return join(root, "no-such-runner.sh");
    case "stub":
      return stub;
  }
}

describe.concurrent("run-skill-eval read isolation stop", () => {
  test.each<[string, Case, RegExp]>([
    [
      "sandbox が無い",
      { runner: "none", sandbox: "missing", bwrap: true, allow: undefined },
      /UNISOLATED \(.*missing or not executable\)/u,
    ],
    [
      "sandbox が実行可能でない",
      { runner: "none", sandbox: "not-executable", bwrap: true, allow: undefined },
      /UNISOLATED \(.*missing or not executable\)/u,
    ],
    [
      "bwrap が無い",
      { runner: "none", sandbox: "executable", bwrap: false, allow: undefined },
      /UNISOLATED \(bwrap not found/u,
    ],
    [
      "runner が sandbox でも bwrap が無い",
      { runner: "sandbox", sandbox: "executable", bwrap: false, allow: undefined },
      /UNISOLATED \(bwrap not found/u,
    ],
    [
      "runner がスタブ",
      { runner: "stub", sandbox: "executable", bwrap: true, allow: undefined },
      /UNVERIFIED/u,
    ],
    [
      "runner が sandbox の相対パス",
      { runner: "sandbox-relative", sandbox: "executable", bwrap: true, allow: undefined },
      /UNVERIFIED/u,
    ],
    [
      "runner が sandbox と同名の別ファイル",
      { runner: "same-name-copy", sandbox: "executable", bwrap: true, allow: undefined },
      /UNVERIFIED/u,
    ],
    [
      "runner が実在しないパス",
      { runner: "missing", sandbox: "executable", bwrap: true, allow: undefined },
      /UNVERIFIED/u,
    ],
    [
      "runner がスタブで、変数が空",
      { runner: "stub", sandbox: "executable", bwrap: true, allow: "" },
      /UNVERIFIED/u,
    ],
    [
      "runner がスタブで、変数が 0",
      { runner: "stub", sandbox: "executable", bwrap: true, allow: "0" },
      /UNVERIFIED/u,
    ],
    [
      "runner がスタブで、変数が true",
      { runner: "stub", sandbox: "executable", bwrap: true, allow: "true" },
      /UNVERIFIED/u,
    ],
    // sandbox は実体のパスから隠すリポジトリを決めるので、外の実体へのリンクだと別のディレクトリを隠す（Issue #1024）。
    [
      "sandbox が外の実体へのシンボリックリンクで、runner の指定が無い",
      { runner: "none", sandbox: "symlink", bwrap: true, allow: undefined },
      /UNISOLATED \(.*\/scripts\/eval\/sandbox\/eval-sandbox\.sh resolves to .*\/real-sandbox\/eval-sandbox\.sh, not to itself/u,
    ],
    // 隠す範囲が変わらない同じディレクトリの別名へのリンクも、実体がその場所に無いので止める（#1024 の決定 4）。
    [
      "sandbox が同じディレクトリの別名へのシンボリックリンク",
      { runner: "none", sandbox: "alias", bwrap: true, allow: undefined },
      /UNISOLATED \(.*\/scripts\/eval\/sandbox\/eval-sandbox\.sh resolves to .*\/scripts\/eval\/sandbox\/eval-sandbox-impl\.sh, not to itself/u,
    ],
    // ファイル自体はリンクでなくても、途中のディレクトリがリンクなら止める。リンクかどうかだけを見る判定では通ってしまう。
    [
      "sandbox のディレクトリが外のディレクトリへのシンボリックリンク",
      { runner: "none", sandbox: "dir-link", bwrap: true, allow: undefined },
      /UNISOLATED \(.*\/scripts\/eval\/sandbox\/eval-sandbox\.sh resolves to .*\/sandbox-v2\/eval-sandbox\.sh, not to itself/u,
    ],
    [
      "sandbox が外の実体へのシンボリックリンクで、runner がそのリンク先の実体",
      { runner: "sandbox-target", sandbox: "symlink", bwrap: true, allow: undefined },
      /UNISOLATED \(.*\/scripts\/eval\/sandbox\/eval-sandbox\.sh resolves to .*\/real-sandbox\/eval-sandbox\.sh, not to itself/u,
    ],
  ])(
    "%s なら、executor を起動する前に理由と続け方を出して exit 7 で止める",
    async (_label, testCase, reason) => {
      const run = await runCase(testCase);

      expect(run.result.status, run.result.stderr).toBe(7);
      expect(run.result.stderr).toMatch(/refusing to start the executor: read isolation is /u);
      expect(run.result.stderr).toMatch(reason);
      expect(run.result.stderr).toMatch(/set SKILL_EVAL_ALLOW_UNISOLATED=1/u);
      expect(run.executorRan).toBe(false);
      expect(run.sandboxRan).toBe(false);
      expect(run.setupRan).toBe(false);
      expect(existsSync(run.output)).toBe(false);
    },
  );

  test.each<[string, Case, RegExp]>([
    [
      "sandbox が無い",
      { runner: "none", sandbox: "missing", bwrap: true, allow: "1" },
      /^isolation: UNISOLATED \(.*missing or not executable\)$/mu,
    ],
    [
      "bwrap が無い",
      { runner: "none", sandbox: "executable", bwrap: false, allow: "1" },
      /^isolation: UNISOLATED \(bwrap not found/mu,
    ],
    [
      "runner がスタブ",
      { runner: "stub", sandbox: "executable", bwrap: true, allow: "1" },
      /^isolation: UNVERIFIED /mu,
    ],
    [
      "sandbox が外の実体へのシンボリックリンク",
      { runner: "none", sandbox: "symlink", bwrap: true, allow: "1" },
      /^isolation: UNISOLATED \(.*resolves to .*\/real-sandbox\/eval-sandbox\.sh, not to itself/mu,
    ],
    // 続けた run は、ほかの UNISOLATED・UNVERIFIED と同じに、SKILL_EVAL_RUNNER を指定していればそれを起動する。
    // 記録は UNISOLATED のままで、sandboxed とは記録しない。
    [
      "sandbox が外の実体へのシンボリックリンクで、runner がそのリンク先の実体",
      { runner: "sandbox-target", sandbox: "symlink", bwrap: true, allow: "1" },
      /^isolation: UNISOLATED \(.*resolves to .*\/real-sandbox\/eval-sandbox\.sh, not to itself/mu,
    ],
  ])("%s でも、変数が 1 なら警告を出して続ける", async (_label, testCase, isolation) => {
    const run = await runCase(testCase);

    expect(run.result.status, run.result.stderr).toBe(0);
    expect(run.result.stderr).toMatch(/warn: read isolation is (?:UNISOLATED|UNVERIFIED)/u);
    expect(run.result.stderr).not.toMatch(/refusing to start the executor/u);
    expect(readFileSync(join(run.output, "isolation.txt"), "utf8")).toMatch(isolation);
    expect(run.executorRan).toBe(true);
    expect(run.setupRan).toBe(true);
    // SKILL_EVAL_RUNNER に sandbox の実体を指定したケースだけ、その runner（sandbox のスタブ）を起動する。
    expect(run.sandboxRan).toBe(testCase.runner === "sandbox-target");
  });

  test.each<[string, Case]>([
    [
      "runner の指定が無い",
      { runner: "none", sandbox: "executable", bwrap: true, allow: undefined },
    ],
    [
      "runner が sandbox の絶対パス",
      { runner: "sandbox", sandbox: "executable", bwrap: true, allow: undefined },
    ],
    [
      "runner が sandbox へのシンボリックリンク",
      { runner: "sandbox-symlink", sandbox: "executable", bwrap: true, allow: undefined },
    ],
    // ハーネスは --repo を解決してから sandbox の実体と比べるので、リポジトリへのリンクは受け付ける（Issue #1024）。
    [
      "--repo がリポジトリへのシンボリックリンク",
      { runner: "none", sandbox: "executable", bwrap: true, allow: undefined, repoLink: true },
    ],
  ])(
    "%s で bwrap が在れば、sandboxed と記録し、変数なしで sandbox の中の executor を起動する",
    async (_label, testCase) => {
      const run = await runCase(testCase);

      expect(run.result.status, run.result.stderr).toBe(0);
      expect(run.result.stderr).not.toMatch(/warn: read isolation is/u);
      expect(readFileSync(join(run.output, "isolation.txt"), "utf8")).toMatch(
        /^isolation: sandboxed \(scripts\/eval\/sandbox\/eval-sandbox\.sh\)$/mu,
      );
      expect(run.sandboxRan).toBe(true);
      expect(run.executorRan).toBe(true);
    },
  );

  // fingerprint の一時ファイルは /tmp に、スキルの名前を含む名前で作られる。
  // 並べて実行するほかのテストと区別するため、このテストだけの名前のスキルで起動する。
  test("止めた run は、fingerprint の一時ファイルを残さない", async () => {
    const skill = `stop-tmp-${process.pid}-${Date.now()}`;
    const run = await runCase(
      { runner: "stub", sandbox: "executable", bwrap: true, allow: undefined },
      skill,
    );

    const leaked = readdirSync("/tmp").filter((name) =>
      name.startsWith(`skill-eval-fingerprint-${skill}-`),
    );
    // 変異で trap を外したときに残るファイルも、確かめる前に消しておく。
    for (const name of leaked) rmSync(join("/tmp", name), { force: true });
    expect(run.result.status, run.result.stderr).toBe(7);
    expect(leaked).toEqual([]);
  });

  // baseline の再利用は executor を起動しないので、隔離を確かめられない構成でも止めない。
  test("baseline の再利用は、変数なしでも止めない", async () => {
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

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SKILL_EVAL_CLI_VERSION: "codex stub-version",
      SKILL_EVAL_RUNNER: stub,
    };
    delete env.SKILL_EVAL_ALLOW_UNISOLATED;
    const result = await spawnAsync(
      join(repository, "scripts", "eval", "run", "run-skill-eval.sh"),
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

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(target, "baseline-reuse.json"))).toBe(true);
  });
});
