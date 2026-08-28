import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "eval-sandbox.sh");
const temporaryDirectories = [];
const hasBwrap = spawnSync("sh", ["-c", "command -v bwrap >/dev/null 2>&1"]).status === 0;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses to replace an existing managed Codex directory", () => {
  const root = mkdtempSync(join(tmpdir(), "eval-sandbox-managed-"));
  temporaryDirectories.push(root);
  const managedDirectory = join(root, "etc", "codex");
  const fakeHome = join(root, "home");
  const fakeBin = join(root, "bin");
  const copiedScript = join(root, "scripts", "eval-sandbox.sh");
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
  const root = mkdtempSync(join(tmpdir(), "eval-sandbox-codex-home-"));
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
  const source = readFileSync(sourceScript, "utf8");
  const worktreeSection = source.slice(
    source.indexOf("# 1b. other work trees"),
    source.indexOf("# 2. sibling runs"),
  );

  // Positive control: the pre-fix loop mounted every existing parent unconditionally.
  expect('[ -e "${wt_parent}" ] && args+=(--tmpfs "${wt_parent}")').toMatch(
    /args\+=\(--tmpfs "\$\{wt_parent\}"\)/u,
  );
  expect(worktreeSection).toMatch(/declare -A hidden_worktree_parents=/u);
  expect(worktreeSection).toMatch(/\["\/tmp"\]=1/u);
  expect(worktreeSection).toMatch(/hidden_worktree_parents\["\$\{wt_parent\}"\]=1/u);
  expect(worktreeSection).not.toContain('[ -e "${wt_parent}" ] && args+=(--tmpfs "${wt_parent}")');
});
