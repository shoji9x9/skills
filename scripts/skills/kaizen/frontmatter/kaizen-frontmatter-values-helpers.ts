// kaizen-frontmatter-values.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { kaizenEnv } from "../kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const scriptsDir = join(repoRoot, "skills/kaizen/scripts");
export const lib = join(scriptsDir, "kaizen-hook-common.sh");
export const NOTE_NAME = "2025-01-01-note.md";

export const workdirs: string[] = [];

export function project(content: string) {
  const dir = makeTempDir("kaizen-fm-");
  workdirs.push(dir);
  mkdirSync(join(dir, ".kaizen"));
  writeFileSync(join(dir, ".kaizen", NOTE_NAME), content);
  const init = spawnSync("git", ["init", "-q", "."], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(init.status, init.stderr).toBe(0);
  return dir;
}

/** 共通の関数を呼び、出力の行を返す（最後の改行の後の空の要素は落とす）。 */
export function readValues(path: string, keys: string[]) {
  const res = spawnSync(
    "bash",
    ["-c", '. "$1"; shift; kaizen_frontmatter_values "$@"', "_", lib, path, ...keys],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS, env: { ...process.env } },
  );
  expect(res.status, res.stderr).toBe(0);
  return res.stdout.split("\n").slice(0, -1);
}

export function readNote(content: string, keys: string[]) {
  const dir = project(content);
  return readValues(join(dir, ".kaizen", NOTE_NAME), keys);
}

export type Key = "status" | "type" | "priority" | "date";
export const KEYS: Key[] = ["status", "type", "priority", "date"];
export const CANONICAL: Record<Key, string> = {
  status: "pending",
  type: "doc",
  priority: "high",
  date: "2026-10-21",
};

export function baseNote(key: Key, line: string) {
  const lines = KEYS.map((k) => (k === key ? line : `${k}: ${CANONICAL[k]}`));
  return `---\n${lines.join("\n")}\napplied-to: []\n---\n\n## 提案\n\n要約\n`;
}

export function statusCheck(dir: string) {
  return spawnSync("bash", [join(scriptsDir, "kaizen-status-check.sh")], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
}

export function ambiguousNote(statusLine: string) {
  return `---\ndate: 2025-01-01\ntype: doc\npriority: low\n${statusLine}\napplied-to: []\n---\n\n## 提案\n\nalpha と beta の学び\n`;
}

export function run(dir: string, script: string, args: string[] = []) {
  return spawnSync("bash", [join(scriptsDir, script), ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: kaizenEnv(dir, { CLAUDE_PROJECT_DIR: dir, LC_ALL: "C.UTF-8" }),
    encoding: "utf8",
    input: "",
  });
}
