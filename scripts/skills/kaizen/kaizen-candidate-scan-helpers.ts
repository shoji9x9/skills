// kaizen-candidate-scan.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { pathWithout } from "./kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-candidate-scan.sh");
export const fixturesDir = join(repoRoot, "evals/kaizen/fixtures/candidate-scan");

export const workdirs: string[] = [];

export function workdir() {
  const dir = makeTempDir("kaizen-candidate-scan-");
  workdirs.push(dir);
  return dir;
}

export function scan(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: CHILD_TIMEOUT_MS,
  });
}

/** 名前を挙げたコマンドだけを差し替えた PATH を返す。null を渡したコマンドは PATH から外す。 */
export function pathWith(dir: string, overrides: Record<string, string | null>) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(overrides)) {
    if (body === null) continue;
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const removed = Object.entries(overrides)
    .filter(([, body]) => body === null)
    .map(([name]) => name);
  if (removed.length === 0) return `${bin}${delimiter}${process.env.PATH}`;
  // 外すコマンドがあるときは、外すものを除いた PATH（kaizen-config-env.ts の pathWithout）の前に置く。
  return `${bin}${delimiter}${pathWithout(dir, removed, process.env.PATH ?? "")}`;
}

export const realCommand = (name: string) =>
  spawnSync("bash", ["-c", `command -v ${name}`], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  }).stdout.trim();

export const claudeUser = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
export const claudeAssistant = (content: unknown[]) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content } });
export const claudeEdit = (path: string) =>
  claudeAssistant([{ type: "tool_use", name: "Edit", input: { file_path: path } }]);

export function transcript(dir: string, lines: string[]) {
  const path = join(dir, "t.jsonl");
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}
