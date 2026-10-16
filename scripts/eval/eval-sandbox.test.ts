import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "eval-sandbox.sh");
const temporaryDirectories: string[] = [];
const hasBwrap = spawnSync("sh", ["-c", "command -v bwrap >/dev/null 2>&1"]).status === 0;

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

  writeFileSync(join(fakeBin, "claude-wrapper"), "#!/usr/bin/env bash\nexit 99\n", {
    mode: 0o755,
  });
  writeFileSync(
    join(fakeBin, "git"),
    `#!/usr/bin/env bash
printf 'worktree %s/one\\nworktree %s/two\\nworktree /tmp/three\\n' "${sharedParent}" "${sharedParent}"
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(fakeBin, "bwrap"),
    `#!/usr/bin/env bash
printf '%s\\n' "$@" >"${capturedArgs}"
`,
    { mode: 0o755 },
  );

  const result = spawnSync(copiedScript, ["--version"], {
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

// --- 起動前の検査・使い方・--verify の後半（ホストへの書き込みの確認）---
//
// bwrap と getent はスタブにする。bwrap のスタブは受け取った引数を記録し、FAKE_BWRAP_MODE で
// 中の検査が書く印（~/.claude の脱出の確認）や終了コードを再現する。getent のスタブは、
// ネットワークの有無に関わらず名前の解決の成否を決める。
//
// | 軸                  | 値                                                                 |
// | ------------------- | ------------------------------------------------------------------ |
// | CLI の名前と vendor | codex / claude から推定 / ラッパーで vendor 無し / 未知の vendor    |
// | CODEX_HOME          | 在る / 無い                                                        |
// | CLI と bwrap        | 在る / CLI が PATH に無い / bwrap が PATH に無い                   |
// | 名前の解決          | 解決できる / 1 つも解決できない                                    |
// | 引数                | CLI の引数 / 無し / --verify だけ                                  |
// | ホストの ~/.claude  | 印が無い / この検査の印 / 別の内容の同名ファイル                   |
// | cwd                 | /tmp の下 / /tmp の外                                              |
const FAKE_BWRAP = `#!/usr/bin/env bash
printf '%s\\n' "$@" >"$FAKE_BWRAP_ARGS"
case "\${FAKE_BWRAP_MODE:-ok}" in
leak) printf 'SENTINEL-EVAL-SANDBOX-ESCAPE' >"$HOME/.claude/.eval-sandbox-escape-probe" ;;
fail) exit 1 ;;
esac
exit 0
`;

type SandboxOptions = {
  cli?: string;
  vendor?: string;
  getent?: "ok" | "fail";
  bwrap?: boolean;
  env?: Record<string, string>;
  cwd?: string;
};

function sandbox(args: string[], options: SandboxOptions = {}) {
  const root = makeTempDir("eval-sandbox-preflight-");
  const repo = join(root, "repo");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const copiedScript = join(repo, "scripts", "eval", "eval-sandbox.sh");
  const capturedArgs = join(root, "bwrap-args.txt");
  mkdirSync(dirname(copiedScript), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(bin);
  // 内容を変えずにコピーする（同じ内容のスクリプトは、カバレッジで原本の実行として数える）。
  writeFileSync(copiedScript, readFileSync(sourceScript), { mode: 0o755 });
  const cli = options.cli ?? "claude";
  if (cli !== "") writeFileSync(join(bin, cli), "#!/usr/bin/env bash\nexit 99\n", { mode: 0o755 });
  if (options.bwrap !== false) writeFileSync(join(bin, "bwrap"), FAKE_BWRAP, { mode: 0o755 });
  writeFileSync(
    join(bin, "getent"),
    options.getent === "fail"
      ? "#!/usr/bin/env bash\nexit 2\n"
      : "#!/usr/bin/env bash\nprintf '127.0.0.2 STREAM %s\\n' \"$2\"\n",
    { mode: 0o755 },
  );
  // bwrap を外す実行では、PATH に置くのは検査の前に使うコマンドだけにする。
  let path = `${bin}:${process.env.PATH}`;
  if (options.bwrap === false) {
    for (const tool of ["readlink", "dirname", "basename", "realpath"]) {
      const real = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" });
      symlinkSync(real.stdout.trim(), join(bin, tool));
    }
    path = bin;
  }
  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    PATH: path,
    EVAL_SANDBOX_CLI: cli === "" ? "absent-cli" : cli,
    FAKE_BWRAP_ARGS: capturedArgs,
    ...options.env,
  };
  if (options.vendor !== undefined) env.EVAL_SANDBOX_VENDOR = options.vendor;
  else delete env.EVAL_SANDBOX_VENDOR;
  delete env.CODEX_HOME;
  const result = spawnSync("/bin/bash", [copiedScript, ...args], {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bwrapArgs = (() => {
    try {
      return readFileSync(capturedArgs, "utf8").split("\n");
    } catch {
      return null;
    }
  })();
  return { result, bwrapArgs, home, root };
}

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
