import { describe, expect, test } from "vitest";
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
