// `scripts/lib/spawn-async.ts` が、テストの書き換えで置き換える `spawnSync` と同じ形を返すことの回帰テスト（Issue #590）。
import { describe, expect, test } from "vitest";
import { spawnAsync } from "./spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "./testing/child-timeout.ts";

describe.concurrent("spawnAsync", () => {
  test("終了コード・stdout・stderr を文字列で返す", async () => {
    const r = await spawnAsync(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
      { timeout: CHILD_TIMEOUT_MS },
    );
    expect(r).toMatchObject({ status: 3, signal: null, stdout: "out", stderr: "err" });
    expect(r.error).toBeUndefined();
  });

  test("input を stdin に渡し、渡さなければ stdin はすぐ閉じる", async () => {
    const echo = ["-e", "process.stdin.pipe(process.stdout)"];
    expect(
      (await spawnAsync(process.execPath, echo, { timeout: CHILD_TIMEOUT_MS, input: "abc" }))
        .stdout,
    ).toBe("abc");
    // 閉じていなければ、子は入力を待ち続けてテストのタイムアウトで落ちる。
    expect((await spawnAsync(process.execPath, echo, { timeout: CHILD_TIMEOUT_MS })).stdout).toBe(
      "",
    );
  });

  test("cwd と env を子に渡す", async () => {
    const r = await spawnAsync(
      process.execPath,
      ["-e", "process.stdout.write(process.cwd() + '|' + process.env.SPAWN_ASYNC_PROBE)"],
      { timeout: CHILD_TIMEOUT_MS, cwd: "/", env: { ...process.env, SPAWN_ASYNC_PROBE: "x" } },
    );
    expect(r.stdout).toBe("/|x");
  });

  test("起動できなければ reject せず、error を持つ結果を返す（spawnSync と同じ）", async () => {
    const r = await spawnAsync("/nonexistent/spawn-async-probe", [], { timeout: CHILD_TIMEOUT_MS });
    expect(r.error).toBeInstanceOf(Error);
    expect(r.status).toBeNull();
  });

  // プロセス全体の uncaughtException を受けるので、並んだ他のテストの例外を数えないよう、このテストだけ並べない。
  test(
    "stdin を読まずに終わる子へ大きな input を渡しても失敗にしない（EPIPE を数えない）",
    { concurrent: false },
    async () => {
      // 握りつぶさないと、EPIPE は例外として投げられ、vitest は「Unhandled Errors」を出すだけでテストを通す（vitest 4 で実測）。
      // テストごとの結果を読むミューテーションテストにも見えないので、ここで受けて数える。
      const uncaught: Error[] = [];
      const onUncaught = (err: Error) => uncaught.push(err);
      process.on("uncaughtException", onUncaught);
      try {
        const r = await spawnAsync(process.execPath, ["-e", "process.exit(0)"], {
          timeout: CHILD_TIMEOUT_MS,
          input: "x".repeat(4 * 1024 * 1024),
        });
        expect(r.status).toBe(0);
        expect(r.error).toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        process.off("uncaughtException", onUncaught);
      }
      expect(uncaught).toEqual([]);
    },
  );

  test("timeout を過ぎたら、孫プロセスが stdout を持っていても止めて ETIMEDOUT を返す（spawnSync と同じ）", async () => {
    const started = Date.now();
    const r = await spawnAsync("bash", ["-c", "sleep 5; echo done"], { timeout: 300 });
    // 孫の sleep が stdout を持ったままでも、5 秒を待たずに返る。
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r).toMatchObject({ status: null, signal: "SIGTERM", stdout: "" });
    expect(r.error).toMatchObject({ code: "ETIMEDOUT" });
  });

  test("子が先に終わっても、孫プロセスが stdout を持ったまま timeout を過ぎたら ETIMEDOUT を返す（spawnSync と同じ）", async () => {
    const started = Date.now();
    const r = await spawnAsync("bash", ["-c", "sleep 5 & echo done"], { timeout: 300 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.error).toMatchObject({ code: "ETIMEDOUT" });
  });

  test("timeout で止めるときは、stdout を持つ孫プロセスも止める", async () => {
    // 孫の pid を stderr に書く。stderr は timeout のときに閉じるが、それより前に書いた分は残る。
    const r = await spawnAsync("bash", ["-c", "sleep 30 & echo $! >&2; echo done"], {
      timeout: 300,
    });
    expect(r.error).toMatchObject({ code: "ETIMEDOUT" });
    const pid = Number(r.stderr.trim());
    expect(pid).toBeGreaterThan(0);
    // SIGTERM が届いてから終わるまで少し待つ。
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("別のプロセスグループの孫が stdout を持っていても、timeout で返す", async () => {
    const started = Date.now();
    // setsid で起動した孫は、子のプロセスグループに送った SIGTERM では止まらない。
    const r = await spawnAsync("bash", ["-c", "setsid sleep 5 & echo done"], { timeout: 300 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.error).toMatchObject({ code: "ETIMEDOUT" });
  });

  test("timeout より前に終わった子は、error を付けずに返す", async () => {
    const r = await spawnAsync("bash", ["-c", "sleep 0.2; echo done"], {
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(r).toMatchObject({ status: 0, signal: null, stdout: "done\n" });
    expect(r.error).toBeUndefined();
  });
});
