// kaizen-kedb-match.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

// 一時ディレクトリの fixture リポジトリの学びのパス。check-kaizen-refs が、このリポジトリの学びへの参照と読まないよう、組み立てて書く。
export const noteRef = (name: string) => `.kaizen/${name}`;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-kedb-match.sh");

export const workdirs: string[] = [];

export function project({ kaizen = true } = {}) {
  const dir = makeTempDir("kaizen-kedb-");
  workdirs.push(dir);
  if (kaizen) mkdirSync(join(dir, ".kaizen", "archive"), { recursive: true });
  return dir;
}

export function note(
  dir: string,
  name: string,
  { body, status = "pending" }: { body: string; status?: string | null },
) {
  const fm = ["---", "date: 2026-09-01", "type: rule", ...(status ? [`status: ${status}`] : [])];
  writeFileSync(join(dir, ".kaizen", name), `${[...fm, "---", "", body, ""].join("\n")}`);
}

export function match(dir: string, ...keywords: string[]) {
  const res = spawnSync("bash", [script, ...keywords], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    timeout: CHILD_TIMEOUT_MS,
  });
  const hits = res.stdout.split("\n").filter(Boolean);
  return { ...res, hits };
}
