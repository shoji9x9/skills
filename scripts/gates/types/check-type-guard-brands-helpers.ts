// check-type-guard-brands.test.ts のヘルパー（検査を文字列に当て、一時リポジトリで CLI を起動する）。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations } from "./check-type-guard-brands.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-type-guard-brands.ts");
/** scripts/ の .ts として検査する。 */
export const ts = (text: string) => findViolations(text, "scripts/a.ts");
/** 配布スキルの .mjs として検査する。 */
export const mjs = (text: string) => findViolations(text, "skills/demo/scripts/a.mjs");

/** 一時的な git リポジトリを作り、ファイルを追跡する。 */
export function makeRepo(files: Record<string, string>): string {
  const root = makeTempDir("type-guard-brands-");
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git("add", "--", ...Object.keys(files));
  return root;
}

export function runCli(cwd: string, args: string[] = []) {
  const r = spawnSync(process.execPath, [script, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
