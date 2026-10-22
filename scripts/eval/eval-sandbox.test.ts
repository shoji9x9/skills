import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";
import { sandbox, sourceScript, writeWorktreeFakeBin } from "./eval-sandbox-helpers.ts";

const temporaryDirectories: string[] = [];
const hasBwrap =
  spawnSync("sh", ["-c", "command -v bwrap >/dev/null 2>&1"], { timeout: CHILD_TIMEOUT_MS })
    .status === 0;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses to replace an existing managed Codex directory", () => {
  const root = makeTempDir("eval-sandbox-managed-");
  temporaryDirectories.push(root);
  const managedDirectory = join(root, "etc", "codex");
  const fakeHome = join(root, "home");
  const fakeBin = join(root, "bin");
  const copiedScript = join(root, "scripts", "eval", "eval-sandbox.sh");
  mkdirSync(managedDirectory, { recursive: true });
  mkdirSync(join(fakeHome, ".codex"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(dirname(copiedScript), { recursive: true });
  writeFileSync(join(managedDirectory, "requirements.toml"), "managed-policy-marker\n", "utf8");
  writeFileSync(join(fakeHome, ".codex", "auth.json"), "{}\n", "utf8");

  const fakeCodex = join(fakeBin, "codex-wrapper");
  const fakeBwrap = join(fakeBin, "bwrap");
  writeFileSync(fakeCodex, "#!/usr/bin/env bash\nexit 99\n", "utf8");
  writeFileSync(fakeBwrap, "#!/usr/bin/env bash\nexit 98\n", "utf8");
  chmodSync(fakeCodex, 0o755);
  chmodSync(fakeBwrap, 0o755);
  const rewritten = readFileSync(sourceScript, "utf8").replaceAll("/etc/codex", managedDirectory);
  writeFileSync(copiedScript, rewritten, "utf8");
  chmodSync(copiedScript, 0o755);

  const result = spawnSync(copiedScript, ["--version"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      EVAL_SANDBOX_CLI: "codex-wrapper",
      EVAL_SANDBOX_VENDOR: "codex",
      HOME: fakeHome,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  });

  expect(result.status).toBe(3);
  expect(result.stderr).toMatch(/refusing to replace managed requirements/u);
  expect(readFileSync(join(managedDirectory, "requirements.toml"), "utf8")).toBe(
    "managed-policy-marker\n",
  );
});

test.skipIf(!hasBwrap)("isolates and reopens only required state from a custom CODEX_HOME", () => {
  const root = makeTempDir("eval-sandbox-codex-home-");
  temporaryDirectories.push(root);
  const fakeHome = join(root, "home");
  const codexHome = join(root, "custom-codex-home");
  const fakeBin = join(codexHome, "packages", "standalone", "releases", "test", "bin");
  const fakeCodex = join(fakeBin, "codex-wrapper");
  mkdirSync(join(codexHome, "skills", "leaked-skill"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(join(fakeHome, ".claude"), { recursive: true });
  writeFileSync(join(fakeHome, ".claude.json"), "{}\n", "utf8");
  writeFileSync(join(codexHome, "auth.json"), "{}\n", "utf8");
  writeFileSync(join(codexHome, "skills", "leaked-skill", "SKILL.md"), "LEAKED_SKILL\n", "utf8");
  writeFileSync(
    fakeCodex,
    `#!/usr/bin/env bash
set -euo pipefail
test "$CODEX_HOME" = ${JSON.stringify(codexHome)}
test -r "$CODEX_HOME/auth.json"
test ! -e "$CODEX_HOME/skills/leaked-skill/SKILL.md"
grep -Fqx 'deny_read = ["${codexHome}/auth.json"]' /etc/codex/requirements.toml
echo CUSTOM_CODEX_HOME_OK
`,
    "utf8",
  );
  chmodSync(fakeCodex, 0o755);

  const result = spawnSync(sourceScript, ["--version"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      EVAL_SANDBOX_CLI: "codex-wrapper",
      EVAL_SANDBOX_VENDOR: "codex",
      HOME: fakeHome,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  });

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("CUSTOM_CODEX_HOME_OK\n");
});

test("deduplicates worktree parent mounts and leaves /tmp to the sibling-run mount", () => {
  const root = makeTempDir("eval-sandbox-worktrees-");
  temporaryDirectories.push(root);
  const repo = join(root, "repo");
  const project = join(root, "project");
  const sharedParent = join(root, "shared");
  const fakeHome = join(root, "home");
  const fakeBin = join(root, "bin");
  const copiedScript = join(repo, "scripts", "eval", "eval-sandbox.sh");
  const capturedArgs = join(root, "bwrap-args.txt");
  mkdirSync(dirname(copiedScript), { recursive: true });
  mkdirSync(project);
  mkdirSync(sharedParent);
  mkdirSync(fakeHome);
  mkdirSync(fakeBin);
  writeFileSync(copiedScript, readFileSync(sourceScript));
  chmodSync(copiedScript, 0o755);

  writeWorktreeFakeBin(fakeBin, sharedParent, capturedArgs);

  const result = spawnSync(copiedScript, ["--version"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      EVAL_SANDBOX_CLI: "claude-wrapper",
      EVAL_SANDBOX_VENDOR: "claude-code",
      HOME: fakeHome,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  const args = readFileSync(capturedArgs, "utf8").split("\n");
  const tmpfsTargets = args.flatMap((arg, index) => (arg === "--tmpfs" ? [args[index + 1]] : []));
  expect(tmpfsTargets.filter((target) => target === sharedParent)).toHaveLength(1);
  expect(tmpfsTargets.filter((target) => target === "/tmp")).toHaveLength(1);
});

test.each([
  ["codex", { mkCodexHome: true }, true],
  ["claude", { mkCodexHome: false }, false],
])("vendor を省くと CLI の名前 %s から決める", (cli, { mkCodexHome }, codex) => {
  const root = makeTempDir("eval-sandbox-vendor-");
  const home = join(root, "home");
  if (mkCodexHome) mkdirSync(join(home, ".codex"), { recursive: true });
  const { result, bwrapArgs } = sandbox(["--version"], {
    cli,
    env: { HOME: home },
  });
  expect(result.status, result.stderr).toBe(0);
  if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
  expect(bwrapArgs.includes("CODEX_HOME")).toBe(codex);
});

test.each([
  [
    "ラッパーの CLI で vendor が無い",
    { cli: "my-wrapper" },
    /EVAL_SANDBOX_VENDOR is required when the CLI is a wrapper: my-wrapper/u,
  ],
  ["未知の vendor", { vendor: "copilot" }, /unsupported EVAL_SANDBOX_VENDOR: copilot/u],
  ["codex で CODEX_HOME が無い", { cli: "codex" }, /CODEX_HOME does not exist: /u],
  ["CLI が PATH に無い", { cli: "", vendor: "claude-code" }, /CLI not found: absent-cli/u],
  ["bwrap が無い", { bwrap: false }, /bwrap not found; cannot isolate reads/u],
  [
    "API のホストを 1 つも解決できない",
    { getent: "fail" as const },
    /could not resolve any allowlisted API host \(api\.anthropic\.com, statsig\.anthropic\.com/u,
  ],
])("%s なら exit 3 で止め、bwrap を起動しない", (_label, options, stderr) => {
  const { result, bwrapArgs } = sandbox(["--version"], options);
  expect(result.status).toBe(3);
  expect(result.stderr).toMatch(stderr);
  expect(bwrapArgs).toBeNull();
});

test.each([
  ["引数が無い", [], /^usage: .*<cli-args\.\.\.>/mu],
  ["--verify に印が無い", ["--verify"], /^usage: .*--verify <marker> \[<marker>\.\.\.\]/mu],
])("%s なら使い方を出して exit 2 で止める", (_label, args, stderr) => {
  const { result, bwrapArgs } = sandbox(args);
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(stderr);
  expect(bwrapArgs).toBeNull();
});

test("--verify は、中の検査が成功してホストの ~/.claude に印が無ければ exit 0 で終える", () => {
  const { result, bwrapArgs } = sandbox(["--verify", "MARKER"]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("stage3 host leak check (~/.claude): no leak (ok)");
  if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
  expect(bwrapArgs).toContain("MARKER");
});

test("--verify は、中の検査の失敗を終了コードに残す", () => {
  const { result } = sandbox(["--verify", "MARKER"], { env: { FAKE_BWRAP_MODE: "fail" } });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("no leak (ok)");
});

test("--verify は、中で書いた印がホストの ~/.claude に届いていれば失敗にし、その印を消す", () => {
  const { result, home } = sandbox(["--verify", "MARKER"], { env: { FAKE_BWRAP_MODE: "leak" } });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("LEAKED (FAIL: writes under ~/.claude reach the host)");
  expect(existsSync(join(home, ".claude", ".eval-sandbox-escape-probe"))).toBe(false);
});

test("--verify は、同じ名前の別のファイルを印と取り違えず、失敗にして残す", () => {
  const root = makeTempDir("eval-sandbox-collision-");
  const home = join(root, "home");
  const probe = join(home, ".claude", ".eval-sandbox-escape-probe");
  mkdirSync(dirname(probe), { recursive: true });
  writeFileSync(probe, "user file\n");
  const { result } = sandbox(["--verify", "MARKER"], { env: { HOME: home } });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("COLLISION (FAIL: ");
  expect(readFileSync(probe, "utf8")).toBe("user file\n");
});

test("cwd が /tmp の外なら、/tmp を隠すだけで cwd を戻さない", () => {
  const { result, bwrapArgs } = sandbox(["--version"], { cwd: "/" });
  expect(result.status, result.stderr).toBe(0);
  if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
  const tmpfs = bwrapArgs.flatMap((arg, i) => (arg === "--tmpfs" ? [bwrapArgs[i + 1]] : []));
  expect(tmpfs).toContain("/tmp");
  const binds = bwrapArgs.flatMap((arg, i) => (arg === "--bind" ? [bwrapArgs[i + 1]] : []));
  expect(binds).not.toContain("/");
  expect(bwrapArgs[bwrapArgs.lastIndexOf("--chdir") + 1]).toBe("/");
});
