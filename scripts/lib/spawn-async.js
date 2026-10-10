// 子プロセスを起動して終了を待つ、`spawnSync` の非同期版（Issue #590）。
//
// ミューテーションテストは変異 1 件ごとにテストファイルを丸ごと実行するので、子プロセスの終了を待つテストを
// `test.concurrent` で並べると、並べた分だけ 1 回の実行が縮み、変異の数だけ反映される。
// `spawnSync` はイベントループを止めるので、並べても 1 本ずつしか進まない。
//
// 書き換えを機械的に保つため、受け付けるオプションと返す形は、テストが使う `spawnSync` の部分に合わせる。
// - オプション: `cwd`・`env`・`input`（文字列。渡さなければ stdin はすぐ閉じる）。出力は常に utf8 の文字列で返す
// - 返す形: `pid`・`status`・`signal`・`stdout`・`stderr`・`error`（起動できなかったときだけ。`spawnSync` と同じく reject しない）
import { spawn } from "node:child_process";

/**
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string }} [options]
 * @returns {Promise<{ pid: number | undefined, status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string, error?: Error }>}
 */
export function spawnAsync(command, args = [], options = {}) {
  const { input, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    /** @type {Error | undefined} */
    let error;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    // stdin を読まずに終わる子へ書くと EPIPE になる。`spawnSync` と同じく、結果には数えない。
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    // 起動できなかったときは `error` の後に `close` が来る（`spawnSync` の `error` と同じ形で返す）。
    child.on("error", (err) => (error = err));
    // 起動できなかったときの `close` は負の errno を終了コードとして渡すので、`spawnSync` と同じく null にする。
    child.on("close", (status, signal) =>
      resolve({
        pid: child.pid,
        status: error ? null : status,
        signal,
        stdout,
        stderr,
        ...(error ? { error } : {}),
      }),
    );
  });
}
