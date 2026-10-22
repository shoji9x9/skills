// kaizen-archive.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-archive.sh");
export const workdirs: string[] = [];

export function createRepo() {
  const dir = makeTempDir("kaizen-archive-");
  workdirs.push(dir);
  mkdirSync(join(dir, ".kaizen"));
  const init = spawnSync("git", ["init", "-q", "."], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(init.status, init.stderr).toBe(0);
  return dir;
}

export function writeNote(
  dir: string,
  name: string,
  { summary, body = "" }: { summary: string; body?: string },
) {
  const path = join(dir, ".kaizen", name);
  writeFileSync(
    path,
    `---\ndate: 2026-09-01\ntype: rule\npriority: medium\nstatus: applied\n---\n\n# note\n\n## 事象\n\n${summary}\n${body}`,
  );
  return path;
}

export function archive(dir: string, ...files: string[]) {
  return archiveIn(dir, { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, ...files);
}

// `locale` が無い／使えない環境（最小コンテナ）を作る。UTF-8 ロケールへ切り替えられない
// ので、スクリプトは「切らずに要約を省く」形で、機能を減らして動く。
export function withoutLocaleCommand(dir: string) {
  const shim = join(dir, "shim-bin");
  mkdirSync(shim, { recursive: true });
  const locale = join(shim, "locale");
  writeFileSync(locale, "#!/bin/sh\nexit 1\n");
  chmodSync(locale, 0o755);
  return { PATH: `${shim}:${process.env.PATH}` };
}

// `locale -a` が glibc 流の名前（en_US.utf8。ハイフン無し・小文字）だけを返す環境を作る。
// charmap は LC_CTYPE の値に応じて答えるので、候補を拾えたかどうかが出力に現れる。
export function withGlibcStyleLocales(dir: string) {
  const shim = join(dir, "shim-glibc");
  mkdirSync(shim, { recursive: true });
  const locale = join(shim, "locale");
  writeFileSync(
    locale,
    [
      "#!/bin/sh",
      'if [ "$1" = "-a" ]; then',
      '  printf "C\\nPOSIX\\nen_US.utf8\\n"',
      "  exit 0",
      "fi",
      'case "${LC_CTYPE:-}" in',
      '*utf8* | *UTF-8* | *utf-8*) echo "UTF-8" ;;',
      '*) echo "ANSI_X3.4-1968" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(locale, 0o755);
  return { PATH: `${shim}:${process.env.PATH}` };
}

export function archiveIn(dir: string, localeEnv: NodeJS.ProcessEnv, ...files: string[]) {
  return spawnSync("bash", [script, ...files], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", ...localeEnv },
    encoding: "utf8",
  });
}
