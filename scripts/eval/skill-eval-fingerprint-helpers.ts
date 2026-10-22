// skill-eval-fingerprint.test.ts のヘルパー（CLI の起動と、テストごとの一時ディレクトリ・スキルの作成）。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

// CLI が stdout に出す指紋の JSON のうち、テストが読む部分。
export type FingerprintOutput = {
  schema_version: number;
  algorithm: string;
  fingerprint: string;
  inputs: Record<string, unknown>;
};

export const here = dirname(fileURLToPath(import.meta.url));
export const FINGERPRINT_CLI = join(here, "skill-eval-fingerprint.ts");
export const REUSE_CLI = join(here, "reuse-skill-eval-baseline.ts");

export function runCli(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  });
}

// テストのファイルの afterEach が、ここに溜めたディレクトリを消す。
export const temporaryDirectories: string[] = [];

export function temporaryDirectory() {
  const directory = makeTempDir("skill-eval-fingerprint-");
  temporaryDirectories.push(directory);
  return directory;
}

export function writeSkill(root: string, name: string, body: string) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), body, "utf8");
}
