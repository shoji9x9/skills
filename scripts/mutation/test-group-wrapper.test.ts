import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnAsync } from "../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";
import { makeSharedTempDir } from "../lib/testing/test-tmpdir.ts";

const wrapper = join(dirname(fileURLToPath(import.meta.url)), "test-group-wrapper.ts");
const tempDir = makeSharedTempDir("mutation-wrapper-");

type Env = Record<string, string | undefined>;

async function runWrapper(args: string[], overrides: Env = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MUTATION_PROOF_WRAPPER_RUN_ID: "probe",
    MUTATION_PROOF_PROGRESS_FILE: join(tempDir, "progress"),
    MUTATION_PROOF_WRAPPER_IDLE_MS: "1500",
    MUTATION_PROOF_WRAPPER_GRACE_MS: "1000",
    // このファイルを測る外側の包む側が渡す値を引き継がない（猶予が変わる）
    MUTATION_PROOF_OUTER_GRACE_MS: undefined,
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  const result = await spawnAsync(process.execPath, [wrapper, ...args], {
    env,
    timeout: CHILD_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return result;
}

/** `ms` の間、`check` が真になるのを待つ。真になれば true。 */
async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

describe.concurrent("テストのプロセスを包む側", () => {
  test.each([
    {
      name: "進み具合のファイルが指定されていない",
      env: { MUTATION_PROOF_PROGRESS_FILE: undefined },
      args: [process.execPath],
      message: "MUTATION_PROOF_PROGRESS_FILE が無い",
    },
    {
      name: "進まない時間の上限が指定されていない",
      env: { MUTATION_PROOF_WRAPPER_IDLE_MS: undefined },
      args: [process.execPath],
      message: 'MUTATION_PROOF_WRAPPER_IDLE_MS が正の整数でない: ""',
    },
    {
      name: "進まない時間の上限が安全な整数を超える",
      env: { MUTATION_PROOF_WRAPPER_IDLE_MS: "9007199254740992" },
      args: [process.execPath],
      message: 'MUTATION_PROOF_WRAPPER_IDLE_MS が正の整数でない: "9007199254740992"',
    },
    {
      name: "SIGTERM の猶予が正の整数でない",
      env: { MUTATION_PROOF_WRAPPER_GRACE_MS: "0" },
      args: [process.execPath],
      message: 'MUTATION_PROOF_WRAPPER_GRACE_MS が正の整数でない: "0"',
    },
    {
      name: "起動するコマンドが指定されていない",
      env: {},
      args: [],
      message: "起動するコマンドが無い",
    },
  ])("$name ときは理由を知らせて exit 2", async ({ env, args, message }) => {
    const result = await runWrapper(args, env);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(
      `mutation-proof-wrapper[probe]: ${JSON.stringify({ event: "config-error", message })}`,
    );
  });

  test("コマンドを起動できないときは理由を知らせて exit 127", async () => {
    const command = join(tempDir, "missing-command");
    const result = await runWrapper([command]);
    expect(result.status, result.stderr).toBe(127);
    expect(result.stderr).toContain('mutation-proof-wrapper[probe]: {"event":"spawn-error"');
    expect(result.stderr).toContain(`spawn ${command} ENOENT`);
  });

  test.each(["Infinity", "9007199254740992", "-1", "abc"])(
    "進み具合の行の上限が正の安全な整数でない（%s）ときは、上限を延ばさずに時間切れにする",
    async (timeout) => {
      const progress = join(mkdtempSync(join(tempDir, "infinity-")), "progress"); // tmpdir-ok: makeSharedTempDir の下・afterAll で消す
      const script = `require("node:fs").appendFileSync(process.env.MUTATION_PROOF_PROGRESS_FILE, "ready\\t${timeout}\\tid\\tslow\\n"); setInterval(() => {}, 1000);`;
      const result = await runWrapper([process.execPath, "-e", script], {
        MUTATION_PROOF_PROGRESS_FILE: progress,
      });
      expect(result.status, result.stderr).toBe(124);
      expect(result.stderr).toContain('"event":"timeout","limitMs":1500');
    },
  );

  test("外側の包む側の猶予があれば、その半分を超えない猶予で止め、子にもその値を渡す", async () => {
    const dir = mkdtempSync(join(tempDir, "outer-")); // tmpdir-ok: makeSharedTempDir の下・afterAll で消す
    const seen = join(dir, "seen");
    // SIGTERM を無視し、受け取った猶予を書いてから待ち続ける子
    const script = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(seen)}, process.env.MUTATION_PROOF_OUTER_GRACE_MS ?? ""); setInterval(() => {}, 1000);`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MUTATION_PROOF_WRAPPER_RUN_ID: "probe",
      MUTATION_PROOF_PROGRESS_FILE: join(dir, "progress"),
      MUTATION_PROOF_WRAPPER_IDLE_MS: "60000",
      MUTATION_PROOF_WRAPPER_GRACE_MS: "10000",
      MUTATION_PROOF_OUTER_GRACE_MS: "2000",
    };
    const child = spawn(process.execPath, [wrapper, process.execPath, "-e", script], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: CHILD_TIMEOUT_MS,
    });
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    try {
      expect(await waitFor(() => existsSync(seen), 10_000), "子が起動しない").toBe(true);
      expect(readFileSync(seen, "utf8")).toBe("1000");
      const start = Date.now();
      child.kill("SIGTERM");
      expect(await exited).toBe(143);
      // 自分の猶予（10 秒）ではなく、外側の半分（1 秒）で SIGKILL に進む
      expect(Date.now() - start).toBeLessThan(5000);
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("外側の猶予が正の整数でないときは理由を知らせて exit 2", async () => {
    const result = await runWrapper([process.execPath], { MUTATION_PROOF_OUTER_GRACE_MS: "x" });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('MUTATION_PROOF_OUTER_GRACE_MS が正の整数でない: \\"x\\"');
  });

  test("コマンドが signal で終わったときは 128 に signal 番号を足して返す", async () => {
    const result = await runWrapper([
      process.execPath,
      "-e",
      'process.kill(process.pid, "SIGTERM")',
    ]);
    expect(result.status, result.stderr).toBe(143);
    expect(result.stderr).toBe("");
  });
});
