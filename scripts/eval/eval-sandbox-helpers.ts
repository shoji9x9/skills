// eval-sandbox.test.ts のヘルパー（スタブの bwrap・getent・CLI を置いて eval-sandbox.sh を起動する）。
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

export const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "eval-sandbox.sh");

/** worktree の親のマウントを確かめるテスト用に、CLI・git・bwrap のスタブを bin に置く。 */
export function writeWorktreeFakeBin(fakeBin: string, sharedParent: string, capturedArgs: string) {
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
const FAKE_BWRAP = `#!/usr/bin/env bash
printf '%s\\n' "$@" >"$FAKE_BWRAP_ARGS"
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
};

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
  writeSandboxFakeBin(bin, cli, options);
  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    PATH: sandboxPath(bin, options),
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
    timeout: CHILD_TIMEOUT_MS,
  });
  return { result, bwrapArgs: readBwrapArgs(capturedArgs), home, root };
}
