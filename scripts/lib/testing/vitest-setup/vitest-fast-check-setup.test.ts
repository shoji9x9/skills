// setupFiles が fast-check の seed を固定する条件の回帰テスト。
//
// | 軸 | 値 |
// | --- | --- |
// | MUTATION_PROOF_CHILD | 無い / 空 / "1" |
// | 呼び出し方 | 関数を呼ぶ / 子のプロセスでモジュールを読み込んだ後の fast-check の設定 |
//
// 読み込んだ後の設定は、子のプロセスで確かめる。このテスト自身のプロセスには MUTATION_PROOF_CHILD が無いので、
// 自分のプロセスの設定を読むだけでは、固定する側の分岐（fc.configureGlobal）を通らない。
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import config from "../../../../vitest.config.ts";
import { CHILD_TIMEOUT_MS } from "../child-timeout.ts";
import { MUTATION_PROOF_SEED, fastCheckSeed } from "./vitest-fast-check-setup.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

/** 子の node で setup を読み込み、その後の fast-check の seed を返す（無ければ "undefined"）。 */
function seedAfterImport(child: string | undefined): string {
  const setupUrl = pathToFileURL(join(import.meta.dirname, "vitest-fast-check-setup.ts")).href;
  // 子は fast-check を setup と同じ場所から読むよう、リポジトリのルートを cwd にする。
  const script = [
    `await import(${JSON.stringify(setupUrl)});`,
    `const { default: fc } = await import("fast-check");`,
    `process.stdout.write(String(fc.readConfigureGlobal().seed));`,
  ].join("\n");
  const env = { ...process.env };
  delete env.MUTATION_PROOF_CHILD;
  if (child !== undefined) env.MUTATION_PROOF_CHILD = child;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

test("ミューテーションテストの子の実行でだけ seed を固定する", () => {
  expect(fastCheckSeed({})).toBeUndefined();
  expect(fastCheckSeed({ MUTATION_PROOF_CHILD: "" })).toBeUndefined();
  expect(fastCheckSeed({ MUTATION_PROOF_CHILD: "1" })).toBe(MUTATION_PROOF_SEED);
});

test("setupFiles に入っている", () => {
  expect(config.test?.setupFiles).toContain(
    "scripts/lib/testing/vitest-setup/vitest-fast-check-setup.ts",
  );
});

test("MUTATION_PROOF_CHILD のある子のプロセスでは、読み込んだだけで fast-check の seed が固定される", () => {
  expect(seedAfterImport("1")).toBe(String(MUTATION_PROOF_SEED));
});

test("MUTATION_PROOF_CHILD の無い子のプロセスでは、読み込んでも seed を固定しない", () => {
  expect(seedAfterImport(undefined)).toBe("undefined");
  expect(seedAfterImport("")).toBe("undefined");
});
