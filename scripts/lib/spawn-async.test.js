// `scripts/lib/spawn-async.js` が、テストの書き換えで置き換える `spawnSync` と同じ形を返すことの回帰テスト（Issue #590）。
import { describe, expect, test } from "vitest";
import { spawnAsync } from "./spawn-async.js";

describe.concurrent("spawnAsync", () => {
  test("終了コード・stdout・stderr を文字列で返す", async () => {
    const r = await spawnAsync(process.execPath, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    ]);
    expect(r).toMatchObject({ status: 3, signal: null, stdout: "out", stderr: "err" });
    expect(r.error).toBeUndefined();
  });

  test("input を stdin に渡し、渡さなければ stdin はすぐ閉じる", async () => {
    const echo = ["-e", "process.stdin.pipe(process.stdout)"];
    expect((await spawnAsync(process.execPath, echo, { input: "abc" })).stdout).toBe("abc");
    // 閉じていなければ、子は入力を待ち続けてテストのタイムアウトで落ちる。
    expect((await spawnAsync(process.execPath, echo)).stdout).toBe("");
  });

  test("cwd と env を子に渡す", async () => {
    const r = await spawnAsync(
      process.execPath,
      ["-e", "process.stdout.write(process.cwd() + '|' + process.env.SPAWN_ASYNC_PROBE)"],
      { cwd: "/", env: { ...process.env, SPAWN_ASYNC_PROBE: "x" } },
    );
    expect(r.stdout).toBe("/|x");
  });

  test("起動できなければ reject せず、error を持つ結果を返す（spawnSync と同じ）", async () => {
    const r = await spawnAsync("/nonexistent/spawn-async-probe", []);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.status).toBeNull();
  });

  // プロセス全体の uncaughtException を受けるので、並んだ他のテストの例外を数えないよう、このテストだけ並べない。
  test.sequential("stdin を読まずに終わる子へ大きな input を渡しても失敗にしない（EPIPE を数えない）", async () => {
    // 握りつぶさないと、EPIPE は例外として投げられ、vitest は「Unhandled Errors」を出すだけでテストを通す（実測）。
    // テストごとの結果を読むミューテーションテストにも見えないので、ここで受けて数える。
    const uncaught = [];
    const onUncaught = (/** @type {Error} */ err) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      const r = await spawnAsync(process.execPath, ["-e", "process.exit(0)"], {
        input: "x".repeat(4 * 1024 * 1024),
      });
      expect(r.status).toBe(0);
      expect(r.error).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    expect(uncaught).toEqual([]);
  });
});
