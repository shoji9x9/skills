// eval-sandbox.sh が、ホームの認証情報を run から隠すことを、本物の bwrap で確かめる（Issue #1008）。
// bwrap が無ければ飛ばす。スタブで確かめるテストは eval-sandbox-credentials.test.ts にある。
// 使い捨ての $HOME は /tmp の外（/var/tmp）に置く。eval-sandbox.sh は /tmp を tmpfs で隠すので、
// /tmp の下の $HOME では、$HOME の扱いを変えても目印が見えなくなり、検出できない。
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { makeSharedTempDir, makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import {
  allowedFiles,
  credentialFiles,
  hostEnv,
  shellQuote,
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

/** run の中で、目印・runtime dir・ソケットの変数・書き込みの可否を 1 行ずつ報告する CLI のスタブ。 */
function visibilityReport() {
  return `#!/usr/bin/env bash
for p in ${Object.keys(credentialFiles).join(" ")} .claude/projects/transcript.jsonl; do
  if test -r "$HOME/$p"; then echo "READABLE $p"; else echo "hidden $p"; fi
done
for p in ${Object.keys(allowedFiles).join(" ")} .claude/.credentials.json; do
  if test -r "$HOME/$p"; then echo "readable $p"; else echo "HIDDEN $p"; fi
done
if [ -n "$(ls -A "$XDG_RUNTIME_DIR")" ]; then echo "RUNTIME VISIBLE"; else echo "runtime hidden"; fi
echo "dbus=\${DBUS_SESSION_BUS_ADDRESS-unset} gh=\${GH_TOKEN+set} lang=\${LANG-unset}"
if touch "$HOME/.probe" 2>/dev/null; then echo "HOME WRITABLE"; else echo "home read-only"; fi
if touch "$HOME/.claude/.probe" 2>/dev/null; then echo "claude writable"; else echo "CLAUDE READ-ONLY"; fi
`;
}

describe.skipIf(outsideTmp === null)("本物の bwrap", () => {
  test("run の中から、許可リストの外の目印は読めず、許可リストの中と CLI の認証は読める", () => {
    const { home, runtimeDir } = makeRealHome("run");
    const project = makeTempDir("eval-sandbox-credentials-project-");
    const fakeBin = join(project, "bin");
    mkdirSync(fakeBin);
    const fakeCli = join(fakeBin, "claude-wrapper");
    writeFileSync(fakeCli, visibilityReport(), "utf8");
    chmodSync(fakeCli, 0o755);
    const result = spawnSync(sourceScript, ["--version"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: project,
      encoding: "utf8",
      env: {
        ...hostEnv(),
        EVAL_SANDBOX_CLI: "claude-wrapper",
        EVAL_SANDBOX_VENDOR: "claude-code",
        EVAL_SANDBOX_NET: "off",
        HOME: home,
        XDG_RUNTIME_DIR: runtimeDir,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
        GH_TOKEN: "MARKER-GH-TOKEN-NOT-A-SECRET",
        LANG: "C.UTF-8",
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
      "dbus=unset gh= lang=C.UTF-8",
      "home read-only",
      "claude writable",
    ]);
  });

  test("--verify の stage 5 は、使い捨ての $HOME で 5 つとも ok を出す", () => {
    const { home, runtimeDir } = makeRealHome("verify");
    const result = spawnSync(sourceScript, ["--verify", "MARKER-NOT-PLANTED-1008"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: "/",
      encoding: "utf8",
      env: {
        ...hostEnv(),
        // --verify も起動の前に CLI を探す。claude の無い環境（CI）でも止まらないよう、在る実行ファイルを渡す。
        EVAL_SANDBOX_CLI: "bash",
        EVAL_SANDBOX_VENDOR: "claude-code",
        EVAL_SANDBOX_NET: "off",
        EVAL_SANDBOX_CLONE_PROBE_URL: "/nonexistent/repo",
        HOME: home,
        XDG_RUNTIME_DIR: runtimeDir,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
        GH_TOKEN: "MARKER-GH-TOKEN-NOT-A-SECRET",
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
    expect(result.stdout).toMatch(
      /^stage5 environment allowlist positive control: \d+ host variables as expected \(ok\)$/mu,
    );
    expect(result.stdout).toMatch(
      /^stage5 environment outside the allowlist: \d+ host variables as expected \(ok\)$/mu,
    );
  });
});

/** $HOME の下に CLI のスタブを置き、PATH を最小にして sandbox を起動する。 */
function startWithCli(
  home: string,
  options: {
    cliDir: string;
    path: string[];
    homeEnv?: string;
    body?: string;
    env?: Record<string, string>;
  },
) {
  const project = makeTempDir("eval-sandbox-probe-project-");
  const cli = join(home, options.cliDir, "claude-wrapper");
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, `#!/usr/bin/env bash\n${options.body ?? ""}echo STARTED\n`, { mode: 0o755 });
  return spawnSync(sourceScript, ["--version"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: project,
    encoding: "utf8",
    env: {
      ...hostEnv(),
      EVAL_SANDBOX_CLI: "claude-wrapper",
      EVAL_SANDBOX_VENDOR: "claude-code",
      EVAL_SANDBOX_NET: "off",
      HOME: options.homeEnv ?? home,
      XDG_RUNTIME_DIR: join(home, "..", "run-absent"),
      PATH: [
        join(options.homeEnv ?? home, options.cliDir),
        ...options.path,
        "/usr/bin",
        "/bin",
      ].join(":"),
      ...options.env,
    },
  });
}

/** run の中で、各パスが見えるかを 1 行ずつ出す CLI のスタブの本文（パスは単一引用符で包んで渡す）。 */
function reportPaths(paths: string[]) {
  return `for p in ${paths.map(shellQuote).join(" ")}; do if [ -r "$p" ]; then echo "readable $p"; else echo "hidden $p"; fi; done\n`;
}

describe.skipIf(outsideTmp === null)(
  "起動の前の確認（本物の bwrap で、中で見えるかを測る）",
  () => {
    test("許可リストの外の CLI（~/.nvm/bin）は、起動の前に止める", () => {
      const { home } = makeRealHome("probe-cli");
      const result = startWithCli(home, { cliDir: ".nvm/bin", path: [] });
      expect(result.status).toBe(3);
      expect(result.stderr).toContain(
        `the sandbox hides the CLI: ${join(home, ".nvm/bin/claude-wrapper")}.`,
      );
      expect(result.stdout).not.toContain("STARTED");
    });

    test("PATH のディレクトリが隠れても止めない（確かめるのは CLI だけ）", () => {
      const { home } = makeRealHome("probe-path-hidden");
      writeHomeFiles(home, { ".cargo/bin/tool": "" });
      // run の中で .cargo/bin の中身が見えないこと（隠れた状態を作れたこと）も、CLI のスタブに出させて確かめる。
      const result = startWithCli(home, {
        cliDir: ".local/bin",
        path: [join(home, ".cargo/bin")],
        // sandbox の中の $HOME に頼らず、目印の絶対パスで確かめる。同じ方式で CLI のスタブ自身が
        // 見えることも出させ、判定が動いていることを区別する（パスは単一引用符で包んで渡す）。
        body: `for p in ${shellQuote(join(home, ".cargo/bin/tool"))} ${shellQuote(join(home, ".local/bin/claude-wrapper"))}; do if [ -e "$p" ]; then echo "visible $p"; else echo "hidden $p"; fi; done\n`,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(
        `hidden ${join(home, ".cargo/bin/tool")}\nvisible ${join(home, ".local/bin/claude-wrapper")}\nSTARTED\n`,
      );
    });

    test("$HOME がシンボリックリンクでも、許可リストの中の CLI は起動する", () => {
      const { home } = makeRealHome("probe-home-link");
      const homeEnv = join(dirname(home), "home-link");
      symlinkSync(home, homeEnv);
      const result = startWithCli(home, { cliDir: ".local/bin", path: [], homeEnv });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("STARTED\n");
    });
  },
);

describe.skipIf(outsideTmp === null)("$HOME の外に置いた設定の場所（本物の bwrap）", () => {
  test("XDG_CONFIG_HOME が $HOME の外なら、その中の認証情報は隠れ、許可リストの場所は読める", () => {
    const { home } = makeRealHome("xdg-outside");
    const xdg = join(dirname(home), "xdg-config");
    writeHomeFiles(xdg, {
      "gh/hosts.yml": "MARKER-XDG-GH\n",
      "mise/config.toml": "MARKER-XDG-MISE\n",
    });
    const result = startWithCli(home, {
      cliDir: ".local/bin",
      path: [],
      env: { XDG_CONFIG_HOME: xdg },
      body: reportPaths([join(xdg, "gh/hosts.yml"), join(xdg, "mise/config.toml")]),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      `hidden ${join(xdg, "gh/hosts.yml")}\nreadable ${join(xdg, "mise/config.toml")}\nSTARTED\n`,
    );
  });

  test("~/.config が $HOME の外へのシンボリックリンクなら、リンク先の認証情報は隠れ、許可リストの場所は読める", () => {
    const { home } = makeRealHome("config-link-outside");
    const target = join(dirname(home), "dotfiles-config");
    writeHomeFiles(target, {
      "box/refresh_token": "MARKER-LINKED-BOX\n",
      "mise/config.toml": "MARKER-LINKED-MISE\n",
    });
    rmSync(join(home, ".config"), { recursive: true, force: true });
    symlinkSync(target, join(home, ".config"));
    const result = startWithCli(home, {
      cliDir: ".local/bin",
      path: [],
      body: reportPaths([
        join(target, "box/refresh_token"),
        join(target, "mise/config.toml"),
        join(home, ".config/box/refresh_token"),
        join(home, ".config/mise/config.toml"),
      ]),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      [
        `hidden ${join(target, "box/refresh_token")}`,
        `readable ${join(target, "mise/config.toml")}`,
        `hidden ${join(home, ".config/box/refresh_token")}`,
        `readable ${join(home, ".config/mise/config.toml")}`,
        "STARTED",
        "",
      ].join("\n"),
    );
  });

  test("$HOME のシンボリックリンクが /tmp（sandbox が隠す場所）に在っても、run の $HOME は解決する", () => {
    const { home } = makeRealHome("home-link-in-tmp");
    const homeEnv = join(makeTempDir("eval-sandbox-home-link-"), "home");
    symlinkSync(home, homeEnv);
    const result = startWithCli(home, {
      cliDir: ".local/bin",
      path: [],
      homeEnv,
      body: `if cd "$HOME" && [ -r .gitconfig ]; then echo "home resolves"; else echo "HOME DOES NOT RESOLVE"; fi\n`,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("home resolves\nSTARTED\n");
  });

  test("--verify の stage 5 は、~/.config が $HOME の中へのシンボリックリンクでも、誤って FAIL を出さない", () => {
    const { home, runtimeDir } = makeRealHome("verify-config-link");
    renameSync(join(home, ".config"), join(home, "dotfiles-config"));
    symlinkSync(join(home, "dotfiles-config"), join(home, ".config"));
    const result = spawnSync(sourceScript, ["--verify", "MARKER-NOT-PLANTED-1011"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: "/",
      encoding: "utf8",
      env: {
        ...hostEnv(),
        EVAL_SANDBOX_CLI: "bash",
        EVAL_SANDBOX_VENDOR: "claude-code",
        EVAL_SANDBOX_NET: "off",
        EVAL_SANDBOX_CLONE_PROBE_URL: "/nonexistent/repo",
        HOME: home,
        XDG_RUNTIME_DIR: runtimeDir,
      },
    });
    expect(result.stdout, result.stderr).toMatch(
      /^stage5 home outside the allowlist: \d+ host paths absent \(ok\)$/mu,
    );
    expect(result.stdout).toMatch(
      /^stage5 home allowlist positive control: \d+ bound paths readable \(ok\)$/mu,
    );
  });
});
