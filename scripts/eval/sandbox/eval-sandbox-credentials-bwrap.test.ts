// eval-sandbox.sh が、ホームの認証情報を run から隠すことを、本物の bwrap で確かめる（Issue #1008）。
// bwrap が無ければ飛ばす。スタブで確かめるテストは eval-sandbox-credentials.test.ts にある。
// 使い捨ての $HOME は /tmp の外（/var/tmp）に置く。eval-sandbox.sh は /tmp を tmpfs で隠すので、
// /tmp の下の $HOME では、$HOME の扱いを変えても目印が見えなくなり、検出できない。
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { makeSharedTempDir, makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import {
  allowedFiles,
  credentialFiles,
  sourceScript,
  writeHomeFiles,
} from "./eval-sandbox-helpers.ts";

const hasBwrap =
  spawnSync("sh", ["-c", "command -v bwrap >/dev/null 2>&1"], { timeout: CHILD_TIMEOUT_MS })
    .status === 0;
const outsideTmp =
  hasBwrap && existsSync("/var/tmp") ? makeSharedTempDir("eval-sandbox-home-", "/var/tmp") : null;

/** /tmp の外に使い捨ての $HOME と runtime dir を作り、目印を置く。 */
function makeRealHome(name: string) {
  if (outsideTmp === null) throw new Error("bwrap が無い環境では呼ばない");
  const base = join(outsideTmp, name);
  const home = join(base, "home");
  const runtimeDir = join(base, "run");
  writeHomeFiles(home, {
    ...credentialFiles,
    ...allowedFiles,
    ".claude/.credentials.json": "MARKER-CLAUDE-AUTH\n",
    ".claude/projects/transcript.jsonl": "MARKER-TRANSCRIPT\n",
  });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, "bus"), "");
  return { home, runtimeDir };
}

describe.skipIf(outsideTmp === null)("本物の bwrap", () => {
  test("run の中から、許可リストの外の目印は読めず、許可リストの中と CLI の認証は読める", () => {
    const { home, runtimeDir } = makeRealHome("run");
    const project = makeTempDir("eval-sandbox-credentials-project-");
    const fakeBin = join(project, "bin");
    mkdirSync(fakeBin);
    const fakeCli = join(fakeBin, "claude-wrapper");
    writeFileSync(
      fakeCli,
      `#!/usr/bin/env bash
for p in ${Object.keys(credentialFiles).join(" ")} .claude/projects/transcript.jsonl; do
  if test -r "$HOME/$p"; then echo "READABLE $p"; else echo "hidden $p"; fi
done
for p in ${Object.keys(allowedFiles).join(" ")} .claude/.credentials.json; do
  if test -r "$HOME/$p"; then echo "readable $p"; else echo "HIDDEN $p"; fi
done
if [ -n "$(ls -A "$XDG_RUNTIME_DIR")" ]; then echo "RUNTIME VISIBLE"; else echo "runtime hidden"; fi
echo "dbus=\${DBUS_SESSION_BUS_ADDRESS-unset}"
if touch "$HOME/.probe" 2>/dev/null; then echo "HOME WRITABLE"; else echo "home read-only"; fi
if touch "$HOME/.claude/.probe" 2>/dev/null; then echo "claude writable"; else echo "CLAUDE READ-ONLY"; fi
`,
      "utf8",
    );
    chmodSync(fakeCli, 0o755);
    const result = spawnSync(sourceScript, ["--version"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_SANDBOX_CLI: "claude-wrapper",
        EVAL_SANDBOX_VENDOR: "claude-code",
        EVAL_SANDBOX_NET: "off",
        HOME: home,
        XDG_RUNTIME_DIR: runtimeDir,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split("\n").filter(Boolean)).toEqual([
      ...Object.keys(credentialFiles).map((p) => `hidden ${p}`),
      "hidden .claude/projects/transcript.jsonl",
      ...Object.keys(allowedFiles).map((p) => `readable ${p}`),
      "readable .claude/.credentials.json",
      "runtime hidden",
      "dbus=unset",
      "home read-only",
      "claude writable",
    ]);
  });

  test("--verify の stage 5 は、使い捨ての $HOME で 4 つとも ok を出す", () => {
    const { home, runtimeDir } = makeRealHome("verify");
    const result = spawnSync(sourceScript, ["--verify", "MARKER-NOT-PLANTED-1008"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: "/",
      encoding: "utf8",
      env: {
        ...process.env,
        // --verify も起動の前に CLI を探す。claude の無い環境（CI）でも止まらないよう、在る実行ファイルを渡す。
        EVAL_SANDBOX_CLI: "bash",
        EVAL_SANDBOX_VENDOR: "claude-code",
        EVAL_SANDBOX_NET: "off",
        EVAL_SANDBOX_CLONE_PROBE_URL: "/nonexistent/repo",
        HOME: home,
        XDG_RUNTIME_DIR: runtimeDir,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
      },
    });
    expect(result.stdout, result.stderr).toMatch(
      /^stage5 home allowlist positive control: \d+ bound paths readable \(ok\)$/mu,
    );
    expect(result.stdout).toMatch(
      /^stage5 home outside the allowlist: \d+ host paths absent \(ok\)$/mu,
    );
    expect(result.stdout).toContain(
      `stage5 runtime dir ${runtimeDir}: hidden (ok; 1 entries on the host)`,
    );
    expect(result.stdout).toContain("stage5 agent socket variables: unset (ok)");
  });
});
