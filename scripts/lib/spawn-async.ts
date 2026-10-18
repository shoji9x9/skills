// 子プロセスを起動して終了を待つ、`spawnSync` の非同期版（Issue #590）。
//
// ミューテーションテストは変異 1 件ごとにテストファイルを丸ごと実行するので、子プロセスの終了を待つテストを
// `test.concurrent` で並べると、並べた分だけ 1 回の実行が縮み、変異の数だけ反映される。
// `spawnSync` はイベントループを止めるので、並べても 1 本ずつしか進まない。
//
// 書き換えを機械的に保つため、受け付けるオプションと返す形は、テストが使う `spawnSync` の部分に合わせる。
// - オプション: `cwd`・`env`・`input`（文字列。渡さなければ stdin はすぐ閉じる）。出力は常に utf8 の文字列で返す
// - `timeout` は必須にする。テストが起動する子プロセスにはタイムアウトを付ける（docs/testing.md「実行環境を固定する」、Issue #663）。
//   時間を過ぎたら SIGTERM を送り、`spawnSync` と同じく `error`（`code: "ETIMEDOUT"`）を付けて返す
// - 返す形: `pid`・`status`・`signal`・`stdout`・`stderr`・`error`（起動できなかったときだけ。`spawnSync` と同じく reject しない）
import { spawn } from "node:child_process";

export type SpawnAsyncOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
};

export type SpawnAsyncResult = {
  pid: number | undefined;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export function spawnAsync(
  command: string,
  args: readonly string[] = [],
  options: SpawnAsyncOptions,
): Promise<SpawnAsyncResult> {
  const { input, timeout, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let error: Error | undefined;
    // spawn の `timeout` は子に SIGTERM を送るだけで、孫プロセスが stdout・stderr を持っている間は `close` が来ない。
    // そこで自分で止め、stdout・stderr を読むのをやめて、`spawnSync` と同じ時間で返す。
    // 子が先に終わっても孫が stdout を持っていれば `close` は来ないので、タイマーは `close` まで止めない（`spawnSync` も同じく ETIMEDOUT を返す）。
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    // stdin を読まずに終わる子へ書くと EPIPE になる。`spawnSync` と同じく、結果には数えない。
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    // 起動できなかったときは `error` の後に `close` が来る（`spawnSync` の `error` と同じ形で返す）。
    child.on("error", (err) => (error = err));
    // 起動できなかったときの `close` は負の errno を終了コードとして渡すので、`spawnSync` と同じく null にする。
    // 起動できたかは `pid` で判定する。起動した後の `error`（kill の失敗など）で、子の終了コードを消さない。
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (timedOut)
        error = Object.assign(new Error(`spawnAsync ${command} ETIMEDOUT`), { code: "ETIMEDOUT" });
      resolve({
        pid: child.pid,
        status: child.pid === undefined ? null : status,
        signal,
        stdout,
        stderr,
        ...(error ? { error } : {}),
      });
    });
  });
}
