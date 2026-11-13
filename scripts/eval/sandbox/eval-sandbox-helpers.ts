// eval-sandbox.test.ts のヘルパー（スタブの bwrap・getent・CLI を置いて eval-sandbox.sh を起動する）。
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

export const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "eval-sandbox.sh");
const sanitizeScript = resolve(dirname(sourceScript), "sanitize-claude-settings.ts");

/** worktree の親のマウントを確かめるテスト用に、CLI・git・bwrap のスタブを bin に置く。 */
export function writeWorktreeFakeBin(fakeBin: string, worktrees: string[], capturedArgs: string) {
  writeFileSync(join(fakeBin, "claude-wrapper"), "#!/usr/bin/env bash\nexit 99\n", {
    mode: 0o755,
  });
  writeFileSync(
    join(fakeBin, "git"),
    `#!/usr/bin/env bash
printf 'worktree %s\\n' ${worktrees.map((w) => `"${w}"`).join(" ")}
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
}

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
// | ホストの settings.json | 無い / 許可リストの外のキーを含む / JSON でない                 |
// | ホストの $HOME      | 許可リストの場所が在る / 無い、許可リストの外に認証情報が在る / 無い |
// | runtime dir         | 中身が在る / 空 / XDG_RUNTIME_DIR が実在しない                     |
//
// bwrap のスタブは呼び出しごとに引数を追記する（--verify は 2 回呼ぶ）。
// FAKE_BWRAP_MODE=exec-credentials では、--verify の stage 5 の呼び出しだけを、隠さずにホストの上で実行する。
// --setenv と --unsetenv は反映し、FAKE_BWRAP_KEEP_ENV=1 なら --unsetenv を反映しない。
const FAKE_BWRAP_EXEC = `if [ "\${FAKE_BWRAP_MODE:-}" = exec-credentials ]; then
  envs=() unsets=() cmd=()
  while [ $# -gt 0 ]; do
    case "$1" in
    --setenv) envs+=("$2=$3"); shift 3 ;;
    --unsetenv) unsets+=("$2"); shift 2 ;;
    --) shift; cmd=("$@"); break ;;
    *) shift ;;
    esac
  done
  case " \${envs[*]} " in *" HOME_LISTS="*) ;; *) exit 0 ;; esac
  if [ "\${FAKE_BWRAP_KEEP_ENV:-}" != 1 ]; then for u in "\${unsets[@]}"; do unset "$u"; done; fi
  exec env "\${envs[@]}" "\${cmd[@]}"
fi
`;
const FAKE_BWRAP = `#!/usr/bin/env bash
printf '%s\\n' "$@" >>"$FAKE_BWRAP_ARGS"
${FAKE_BWRAP_EXEC}
# settings.json に bind されたコピーを、終了時に消される前に残す。
if [ -n "\${FAKE_BWRAP_SETTINGS:-}" ]; then
  prev2="" prev1=""
  for a in "$@"; do
    if [ "$prev2" = "--ro-bind" ] && [ "$a" = "$HOME/.claude/settings.json" ]; then cp -- "$prev1" "$FAKE_BWRAP_SETTINGS"; fi
    prev2="$prev1" prev1="$a"
  done
fi
case "\${FAKE_BWRAP_MODE:-ok}" in
leak) printf 'SENTINEL-EVAL-SANDBOX-ESCAPE' >"$HOME/.claude/.eval-sandbox-escape-probe" ;;
fail) exit 1 ;;
esac
exit 0
`;

export type SandboxOptions = {
  cli?: string;
  vendor?: string;
  getent?: "ok" | "fail";
  bwrap?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  /** 使い捨ての $HOME に置くファイル（$HOME からの相対パス → 内容）。 */
  homeFiles?: Record<string, string>;
  /** runtime dir に置くファイル名。省くと、XDG_RUNTIME_DIR を実在しないパスにする（ホストの runtime dir を読ませない）。 */
  runtimeEntries?: string[];
  /** CLI のスタブを置く、$HOME からの相対ディレクトリ。省くと $HOME の外の bin に置く。 */
  cliHomeDir?: string;
  /** /run/user/<uid> の代わりに置くディレクトリのファイル名。省くと実在しないパスにする（ホストの /run/user を読ませない）。 */
  runUserEntries?: string[];
  /** スクリプトのコピー（とそのリポジトリ）を $HOME の下に置く。 */
  repoUnderHome?: boolean;
  /** PATH の先頭に足す、$HOME からの相対ディレクトリ。exists が false なら作らない。 */
  pathHomeDirs?: { dir: string; exists: boolean }[];
  /** $HOME を、使い捨ての $HOME へのシンボリックリンクとして渡す。 */
  homeSymlink?: boolean;
};

/** PATH の先頭に足すディレクトリを（指定があれば）作り、PATH の接頭辞を返す。 */
function homePathPrefix(home: string, dirs: { dir: string; exists: boolean }[]) {
  for (const { dir, exists } of dirs) if (exists) mkdirSync(join(home, dir), { recursive: true });
  return dirs.map(({ dir }) => `${join(home, dir)}:`).join("");
}

/** 使い捨ての $HOME にファイルを置く。 */
export function writeHomeFiles(home: string, files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(join(home, relative)), { recursive: true });
    writeFileSync(join(home, relative), content);
  }
}

/** runtime dir を作り、そのパスを返す。 */
function makeRuntimeDir(root: string, entries: string[] | undefined, name = "run") {
  const runtimeDir = join(root, name);
  if (entries === undefined) return runtimeDir;
  mkdirSync(runtimeDir);
  for (const entry of entries) writeFileSync(join(runtimeDir, entry), "");
  return runtimeDir;
}

/** CLI・bwrap・getent のスタブを bin に置く。 */
function writeSandboxFakeBin(bin: string, cli: string, options: SandboxOptions) {
  if (cli !== "") writeFileSync(join(bin, cli), "#!/usr/bin/env bash\nexit 99\n", { mode: 0o755 });
  if (options.bwrap !== false) writeFileSync(join(bin, "bwrap"), FAKE_BWRAP, { mode: 0o755 });
  writeFileSync(
    join(bin, "getent"),
    options.getent === "fail"
      ? "#!/usr/bin/env bash\nexit 2\n"
      : "#!/usr/bin/env bash\nprintf '127.0.0.2 STREAM %s\\n' \"$2\"\n",
    { mode: 0o755 },
  );
}

/** スクリプトを起動する PATH を決める。 */
function sandboxPath(bin: string, options: SandboxOptions) {
  // bwrap を外す実行では、PATH に置くのは検査の前に使うコマンドだけにする。
  if (options.bwrap !== false) return `${bin}:${process.env.PATH}`;
  for (const tool of ["readlink", "dirname", "basename", "realpath"]) {
    const real = spawnSync("bash", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
    symlinkSync(real.stdout.trim(), join(bin, tool));
  }
  return bin;
}

/** bwrap のスタブが記録した引数を読む。bwrap が呼ばれていなければ null を返す。 */
function readBwrapArgs(capturedArgs: string) {
  try {
    return readFileSync(capturedArgs, "utf8").split("\n");
  } catch {
    return null;
  }
}

export function sandbox(args: string[], options: SandboxOptions = {}) {
  const root = makeTempDir("eval-sandbox-preflight-");
  const home = join(root, "home");
  const repo = options.repoUnderHome === true ? join(home, "projects", "repo") : join(root, "repo");
  const bin = join(root, "bin");
  const copiedScript = join(repo, "scripts", "eval", "sandbox", "eval-sandbox.sh");
  const capturedArgs = join(root, "bwrap-args.txt");
  mkdirSync(dirname(copiedScript), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeHomeFiles(home, options.homeFiles ?? {});
  const runtimeDir = makeRuntimeDir(root, options.runtimeEntries);
  const runUserDir = makeRuntimeDir(root, options.runUserEntries, "run-user");
  mkdirSync(bin);
  // 内容を変えずにコピーする（同じ内容のスクリプトは、カバレッジで原本の実行として数える）。
  writeFileSync(copiedScript, readFileSync(sourceScript), { mode: 0o755 });
  // settings.json のコピーを作るスクリプトは、相対 import を原本の側で解決させるためにリンクで置く。
  symlinkSync(sanitizeScript, join(dirname(copiedScript), "sanitize-claude-settings.ts"));
  const cli = options.cli ?? "claude";
  const cliDir = options.cliHomeDir === undefined ? bin : join(home, options.cliHomeDir);
  mkdirSync(cliDir, { recursive: true });
  writeSandboxFakeBin(bin, cli, options);
  if (cliDir !== bin && cli !== "") {
    writeFileSync(join(cliDir, cli), "#!/usr/bin/env bash\nexit 99\n", { mode: 0o755 });
  }
  const homeEnv = options.homeSymlink === true ? join(root, "home-link") : home;
  if (homeEnv !== home) symlinkSync(home, homeEnv);
  const pathPrefix =
    homePathPrefix(homeEnv, options.pathHomeDirs ?? []) + (cliDir === bin ? "" : `${cliDir}:`);
  const env: Record<string, string> = {
    ...process.env,
    HOME: homeEnv,
    PATH: `${pathPrefix}${sandboxPath(bin, options)}`,
    EVAL_SANDBOX_CLI: cli === "" ? "absent-cli" : cli,
    FAKE_BWRAP_ARGS: capturedArgs,
    XDG_RUNTIME_DIR: runtimeDir,
    EVAL_SANDBOX_RUN_USER_DIR: runUserDir,
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
    timeout: CHILD_TIMEOUT_MS,
  });
  return { result, bwrapArgs: readBwrapArgs(capturedArgs), home, root, runtimeDir, runUserDir };
}

/** 許可リストの外に置く、認証情報に見立てた目印。 */
export const credentialFiles = {
  ".config/box/refresh_token": "MARKER-BOX\n",
  ".config/gh/hosts.yml": "MARKER-GH\n",
  ".ssh/id_ed25519": "MARKER-SSH\n",
  ".aws/credentials": "MARKER-AWS\n",
  ".local/share/keyrings/login.keyring": "MARKER-KEYRING\n",
  ".unlisted-tool/token": "MARKER-UNLISTED\n",
  ".config/git/credentials": "MARKER-GIT-CREDENTIALS\n",
};
/** 許可リストの中に置く目印。 */
export const allowedFiles = {
  ".config/mise/config.toml": "MARKER-MISE\n",
  ".gitconfig": "[user]\n\tname = test\n",
  ".config/git/ignore": "*.swp\n",
  ".local/share/mise/installs/marker": "MARKER-MISE-INSTALL\n",
};
