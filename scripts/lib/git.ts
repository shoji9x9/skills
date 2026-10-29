/**
 * チェック（`scripts/gates/`）が使う git の呼び出し。
 * pre-commit で実行するチェックが git の応答を待ち続けて commit を止めないよう、すべての呼び出しに打ち切りの時間を付ける。
 * 失敗（0 以外の終了・打ち切り・起動の失敗）は、何を読もうとしたかと終わり方（spawnEnd）を書いて投げる。
 */
import { spawnSync } from "node:child_process";
import { spawnEnd } from "./errors.ts";

/** git が応答しないときに、待ち続けないよう打ち切る時間。 */
const GIT_TIMEOUT_MS = 60_000;

/** 打ち切りの時間と起動するコマンド。テストが打ち切りと起動の失敗を作るために変えられる。 */
export interface GitOptions {
  /** 打ち切る時間（ミリ秒）。デフォルトは GIT_TIMEOUT_MS */
  readonly timeoutMs?: number;
  /** 起動するコマンド。デフォルトは `git` */
  readonly command?: string;
}

/**
 * `cwd` で git を起動し、成功すれば stdout を返す。
 * 失敗は `<what>（git <サブコマンド> <終わり方>）: <stderr>` の形で投げる。
 * `what` は失敗のメッセージの先頭に書く、何をしようとしたかである。
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  options: GitOptions & { readonly what: string },
): string {
  const { what } = options;
  const res = spawnSync(options.command ?? "git", args, {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
  });
  if (res.status !== 0) {
    throw new Error(`${what}（git ${args[0] ?? ""} ${spawnEnd(res)}）: ${res.stderr ?? ""}`);
  }
  return res.stdout;
}

/** `cwd` を含むリポジトリのルート。どの場所から起動しても、同じ範囲を走査するため。 */
export function repoRoot(cwd: string, options?: GitOptions): string {
  return runGit(cwd, ["rev-parse", "--show-toplevel"], {
    ...options,
    what: "git のリポジトリのルートを特定できない",
  }).trim();
}

/**
 * `dirs` の下の、追跡しているファイルと、無視されていない未追跡のファイル。
 * `.gitignore` のものを除くのは、テストが一時的に作る fixture（`scripts/` の下の `.cjs` など）を数えないため。
 * 未追跡のファイルを含めるのは、`git add` の前に置いた違反も検出するため。
 * 作業ツリーに在るかでは絞らない。stage した違反を作業ツリーから消しても、commit には入るため。
 * `root` はリポジトリのルート（pathspec と返るパスは、起動した場所ではなくルートからの相対パスになる）。
 */
export function listFiles(root: string, dirs: readonly string[]): string[] {
  return runGit(
    root,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...dirs],
    { what: "追跡しているファイルを列挙できない" },
  )
    .split("\0")
    .filter((p) => p !== "");
}

/** index にあるファイルのパスと blob の id。 */
export function indexBlobs(root: string, paths: readonly string[]): Map<string, string> {
  const out = runGit(root, ["ls-files", "-z", "--stage", "--", ...paths], {
    what: "index のファイルを読めない",
  });
  const map = new Map<string, string>();
  for (const entry of out.split("\0")) {
    const m = /^\d+ ([0-9a-f]+) \d+\t(.+)$/s.exec(entry);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

/** blob の中身。`path` は失敗のメッセージに書く、その blob のファイルのパス。 */
export function readBlob(root: string, blob: string, path: string): string {
  return runGit(root, ["cat-file", "blob", blob], { what: `${path}: staged の中身を読めない` });
}
