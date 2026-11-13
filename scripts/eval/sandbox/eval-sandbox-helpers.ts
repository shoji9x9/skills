// eval-sandbox.test.ts のヘルパー（スタブの bwrap・getent・CLI を置いて eval-sandbox.sh を起動する）。
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

export const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "eval-sandbox.sh");
const sanitizeScript = resolve(dirname(sourceScript), "sanitize-claude-settings.ts");

/**
 * `git worktree list --porcelain` に答える git のスタブを bin に置く。
 * worktrees を渡すと、実物と同じ形（work tree ごとに worktree・HEAD・branch の行と空行）で出力する。
 * "fail" を渡すと、WSL の dubious ownership と同じように stderr に理由を出して 128 で終わる。
 */
export function writeFakeGit(bin: string, worktrees: string[] | "fail") {
  const body =
    worktrees === "fail"
      ? "echo \"fatal: detected dubious ownership in repository at '$2'\" >&2\nexit 128\n"
      : `for w in ${worktrees.map((w) => shellQuote(w)).join(" ")}; do
  printf 'worktree %s\\nHEAD 0000000000000000000000000000000000000000\\nbranch refs/heads/main\\n\\n' "$w"
done
`;
  writeFileSync(join(bin, "git"), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
}

/** worktree の親のマウントを確かめるテスト用に、CLI・git・bwrap のスタブを bin に置く。 */
export function writeWorktreeFakeBin(fakeBin: string, worktrees: string[], capturedArgs: string) {
  writeFileSync(join(fakeBin, "claude-wrapper"), "#!/usr/bin/env bash\nexit 99\n", {
    mode: 0o755,
  });
  writeFakeGit(fakeBin, worktrees);
  writeFileSync(
    join(fakeBin, "bwrap"),
    `#!/usr/bin/env bash
${FAKE_BWRAP_PROBE}printf '%s\\n' "$@" >"${capturedArgs}"
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
// | 起動の前の確認      | CLI が見える / 隠れる（PATH のディレクトリは確かめない）              |
// | 環境変数            | 許可リストの外 / 中（軸の一覧は eval-sandbox-env.test.ts）          |
// | 起動の前に止める構成 | runtime dir と git worktree list（軸の一覧は eval-sandbox-preflight.test.ts） |
//
// bwrap のスタブは呼び出しごとに引数を追記する（--verify は 2 回呼ぶ）。
// 起動の前の確認（CLI が見えるか）の呼び出しは記録せず、FAKE_BWRAP_HIDDEN（改行区切り）に
// 挙げたパスを除いて「見える」と答える。何が隠れるかを測るのは、本物の bwrap のテストである。
// FAKE_BWRAP_MODE=exec-credentials では、--verify の stage 5 の呼び出しだけを、隠さずにホストの上で実行する。
// --setenv と --unsetenv は反映する。FAKE_BWRAP_LEAK_ENV に挙げた名前は 1 を入れて渡し（許可リストの外の変数が run に渡った状態）、
// FAKE_BWRAP_DROP_ENV に挙げた名前は外す（渡すはずの変数が欠けた状態）。
// eval-sandbox.sh は bwrap を許可リストの環境変数だけで起動するので、スタブの設定（FAKE_BWRAP_*）は
// 環境変数では届かない。スタブは隣の fake-bwrap.env から読む（export しないので、実行するコマンドには渡らない）。
// FAKE_BWRAP_ENV_OUT を指定すると、呼び出しごとに、受け取った環境変数の名前（値は書かない）を 1 行ずつ追記し、
// 呼び出しの区切りに "--" を書く。
const FAKE_BWRAP_CONFIG = `config="$(dirname -- "$0")/fake-bwrap.env"
[ ! -f "$config" ] || . "$config"
[ -z "\${FAKE_BWRAP_ENV_OUT:-}" ] || {
  while IFS= read -r -d '' e; do printf '%s\\n' "\${e%%=*}"; done </proc/$$/environ
  echo --
} >>"$FAKE_BWRAP_ENV_OUT"
`;
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
  # ホストの /run/user/<uid> の中身で結果が変わらないよう、runtime dir の一覧をテストの下に絞る。
  if [ -n "\${FAKE_BWRAP_RUNTIME_UNDER:-}" ]; then
    for e in "\${envs[@]}"; do case "$e" in HOME_LISTS=*) lists="\${e#HOME_LISTS=}" ;; esac; done
    while IFS= read -r -d '' l; do
      case "\${l#*|}" in "$FAKE_BWRAP_RUNTIME_UNDER"/*) printf '%s\\0' "$l" ;; esac
    done <"$lists/runtime" >"$lists/runtime.kept"
    mv -- "$lists/runtime.kept" "$lists/runtime"
  fi
  for u in "\${unsets[@]}"; do unset "$u"; done
  for u in \${FAKE_BWRAP_DROP_ENV:-}; do unset "$u"; done
  for u in \${FAKE_BWRAP_LEAK_ENV:-}; do envs+=("$u=1"); done
  # SHLVL は、このスタブ（bash）が exec のときに足す。本物の bwrap は足さないので、env -u で外して揃える。
  exec env -u SHLVL "\${envs[@]}" "\${cmd[@]}"
fi
`;
const FAKE_BWRAP_PROBE = `case " $* " in *" EVAL_SANDBOX_PROBE 1 "*)
  [ -z "\${FAKE_BWRAP_PROBE_ARGS:-}" ] || printf '%s\\n' "$@" >"$FAKE_BWRAP_PROBE_ARGS"
  after=""
  for a in "$@"; do
    if [ -n "$after" ] && ! printf '%s\\n' "\${FAKE_BWRAP_HIDDEN:-}" | grep -qxF -- "$a"; then printf '%s\\0' "$a"; fi
    [ "$a" != _ ] || after=1
  done
  exit 0 ;;
esac
`;
const FAKE_BWRAP = `#!/usr/bin/env bash
${FAKE_BWRAP_CONFIG}${FAKE_BWRAP_PROBE}printf '%s\\n' "$@" >>"$FAKE_BWRAP_ARGS"
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
  /** スクリプトのコピー（とそのリポジトリ）を $HOME の下に置く。 */
  repoUnderHome?: boolean;
  /** PATH の先頭に足す、$HOME からの相対ディレクトリ。中にツールを 1 つ置く。 */
  pathHomeDirs?: string[];
  /** 起動の前の確認で、CLI を隠れていると答える。 */
  hiddenCli?: boolean;
  /** git worktree list のスタブが失敗する（省くと、スクリプトのコピーを置いたリポジトリだけを返す）。 */
  gitFails?: boolean;
  /** $HOME を作った後に呼ぶ。足す環境変数と cwd を返す（$HOME の外の場所を作るテスト用）。 */
  setup?: (paths: { root: string; home: string }) => { env?: Record<string, string>; cwd?: string };
};

/** PATH の先頭に足すディレクトリを作ってツールを 1 つ置き、PATH の接頭辞を返す。 */
function homePathPrefix(home: string, dirs: string[]) {
  for (const dir of dirs) {
    mkdirSync(join(home, dir), { recursive: true });
    writeFileSync(join(home, dir, "tool"), "", { mode: 0o755 });
  }
  return dirs.map((dir) => `${join(home, dir)}:`).join("");
}

/**
 * テストを実行する環境の変数から、XDG の場所（XDG_*_HOME）と eval-sandbox.sh の設定（EVAL_SANDBOX_*）を
 * 除いて返す。GitHub Actions の runner は XDG_CONFIG_HOME を設定するので、そのまま渡すと、sandbox が
 * runner の設定の場所まで隠して戻し、使い捨ての $HOME だけを見るはずの判定の結果が変わる。
 * 手元のシェルで export した EVAL_SANDBOX_ENV_ALLOW なども、同じように結果を変える。
 */
export function hostEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^XDG_.*_HOME$/u.test(name) || name.startsWith("EVAL_SANDBOX_")) continue;
    env[name] = value;
  }
  return env;
}

/** bwrap の引数から、指定したフラグの n 個目の値を集める。 */
export function flagValues(args: string[], flag: string, offset = 1) {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + offset]] : []));
}

/** 使い捨ての $HOME にファイルを置く。 */
export function writeHomeFiles(home: string, files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(join(home, relative)), { recursive: true });
    writeFileSync(join(home, relative), content);
  }
}

/** runtime dir を作り、そのパスを返す。 */
function makeRuntimeDir(root: string, entries: string[] | undefined) {
  const runtimeDir = join(root, "run");
  if (entries === undefined) return runtimeDir;
  mkdirSync(runtimeDir);
  for (const entry of entries) writeFileSync(join(runtimeDir, entry), "");
  return runtimeDir;
}

/** 文字列を bash の単一引用符で包む（中の単一引用符は、引用を閉じてエスケープした 1 文字を足す）。 */
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** スタブの bwrap の設定（環境変数のうち FAKE_BWRAP_* の名前のもの）を、スタブの隣のファイルに書く。 */
function writeFakeBwrapConfig(bin: string, env: Record<string, string | undefined>) {
  const lines = Object.entries(env).flatMap(([name, value]) =>
    name.startsWith("FAKE_BWRAP_") && value !== undefined ? [`${name}=${shellQuote(value)}\n`] : [],
  );
  writeFileSync(join(bin, "fake-bwrap.env"), lines.join(""));
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

/** スタブの bwrap が呼び出しごとに記録した環境変数の名前を読む。呼ばれていなければ空の配列を返す。 */
function readEnvNames(envOut: string) {
  let text: string;
  try {
    text = readFileSync(envOut, "utf8");
  } catch {
    return [];
  }
  return text
    .split("--\n")
    .slice(0, -1)
    .map((call) => call.split("\n").filter(Boolean));
}

/** スクリプトを起動する環境変数を作る。 */
function sandboxEnv(
  paths: Record<
    "root" | "home" | "bin" | "cli" | "runtimeDir" | "capturedArgs" | "probeArgs",
    string
  >,
  options: SandboxOptions,
) {
  const { root, home, bin, cli } = paths;
  const env: Record<string, string> = {
    ...hostEnv(),
    HOME: home,
    PATH: `${homePathPrefix(home, options.pathHomeDirs ?? [])}${sandboxPath(bin, options)}`,
    EVAL_SANDBOX_CLI: cli === "" ? "absent-cli" : cli,
    FAKE_BWRAP_ARGS: paths.capturedArgs,
    XDG_RUNTIME_DIR: paths.runtimeDir,
    FAKE_BWRAP_RUNTIME_UNDER: root,
    FAKE_BWRAP_PROBE_ARGS: paths.probeArgs,
    FAKE_BWRAP_HIDDEN: options.hiddenCli === true ? join(bin, cli) : "",
    ...options.env,
  };
  if (options.vendor !== undefined) env.EVAL_SANDBOX_VENDOR = options.vendor;
  else delete env.EVAL_SANDBOX_VENDOR;
  delete env.CODEX_HOME;
  return env;
}

/**
 * スクリプトは /run/user/<uid> を runtime dir として隠し、それが使い捨ての $HOME を含めば止まる。
 * その環境ではすべての呼び出しが同じ理由で止まるので、テストの期待と違う理由で落ちる前に前提の誤りとして示す。
 */
function assertOutsideRunUser(root: string) {
  const runUser = `/run/user/${process.geteuid?.() ?? "unknown"}/`;
  if (`${realpathSync(root)}/`.startsWith(runUser)) {
    throw new Error(
      `一時ディレクトリ ${root} が ${runUser} の下にある。TMPDIR をその外に置いて実行する`,
    );
  }
}

export function sandbox(args: string[], options: SandboxOptions = {}) {
  const root = makeTempDir("eval-sandbox-preflight-");
  assertOutsideRunUser(root);
  const home = join(root, "home");
  const repo = options.repoUnderHome === true ? join(home, "projects", "repo") : join(root, "repo");
  const bin = join(root, "bin");
  const copiedScript = join(repo, "scripts", "eval", "sandbox", "eval-sandbox.sh");
  const capturedArgs = join(root, "bwrap-args.txt");
  const envOut = join(root, "bwrap-env-names.txt");
  const probeArgs = join(root, "bwrap-probe-args.txt");
  mkdirSync(dirname(copiedScript), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeHomeFiles(home, options.homeFiles ?? {});
  const runtimeDir = makeRuntimeDir(root, options.runtimeEntries);
  mkdirSync(bin);
  // 内容を変えずにコピーする（同じ内容のスクリプトは、カバレッジで原本の実行として数える）。
  writeFileSync(copiedScript, readFileSync(sourceScript), { mode: 0o755 });
  // settings.json のコピーを作るスクリプトは、相対 import を原本の側で解決させるためにリンクで置く。
  symlinkSync(sanitizeScript, join(dirname(copiedScript), "sanitize-claude-settings.ts"));
  const cli = options.cli ?? "claude";
  writeSandboxFakeBin(bin, cli, options);
  // スクリプトのコピーは git のリポジトリの外にあるので、git worktree list にはスタブで答える。
  writeFakeGit(bin, options.gitFails === true ? "fail" : [repo]);
  const extra = options.setup?.({ root, home }) ?? {};
  const env = {
    ...sandboxEnv({ root, home, bin, cli, runtimeDir, capturedArgs, probeArgs }, options),
    ...extra.env,
  };
  writeFakeBwrapConfig(bin, { FAKE_BWRAP_ENV_OUT: envOut, ...env });
  const result = spawnSync("/bin/bash", [copiedScript, ...args], {
    cwd: extra.cwd ?? options.cwd ?? root,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  });
  return {
    result,
    bwrapArgs: readBwrapArgs(capturedArgs),
    probeArgs: readBwrapArgs(probeArgs),
    envNames: readEnvNames(envOut),
    home,
    root,
    runtimeDir,
    bin,
  };
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
