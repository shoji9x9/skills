import { afterEach, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-archive.sh");
const workdirs = [];

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-archive-"));
  workdirs.push(dir);
  mkdirSync(join(dir, ".kaizen"));
  const init = spawnSync("git", ["init", "-q", "."], { cwd: dir, encoding: "utf8" });
  expect(init.status, init.stderr).toBe(0);
  return dir;
}

function writeNote(dir, name, summary, body = "") {
  const path = join(dir, ".kaizen", name);
  writeFileSync(
    path,
    `---\ndate: 2026-09-01\ntype: rule\npriority: medium\nstatus: applied\n---\n\n# note\n\n## 事象\n\n${summary}\n${body}`,
  );
  return path;
}

function archive(dir, ...files) {
  return spawnSync("bash", [script, ...files], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "" },
    encoding: "utf8",
  });
}

test("../ で始まる Markdown 相対リンクを移動先の階層に合わせる", () => {
  const dir = createRepo();
  const note = writeNote(
    dir,
    "2026-09-01-links.md",
    "relative links",
    "\n[x](../docs/x.md) and ![image](../../assets/x.png) and [web](https://example.com)\n",
  );
  spawnSync("git", ["add", ".kaizen"], { cwd: dir });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const archived = readFileSync(join(dir, ".kaizen/archive/2026-09-01-links.md"), "utf8");
  expect(archived).toContain("[x](../../docs/x.md)");
  expect(archived).toContain("![image](../../../assets/x.png)");
  expect(archived).toContain("[web](https://example.com)");
  const staged = spawnSync("git", ["show", ":.kaizen/archive/2026-09-01-links.md"], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(staged.status, staged.stderr).toBe(0);
  expect(staged.stdout).toContain("[x](../../docs/x.md)");
  expect(staged.stdout).toContain("![image](../../../assets/x.png)");
  const unstaged = spawnSync("git", ["diff", "--", ".kaizen/archive/2026-09-01-links.md"], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(unstaged.status, unstaged.stderr).toBe(0);
  expect(unstaged.stdout).toBe("");
});

test.each([
  { length: 79, ellipsis: false },
  { length: 80, ellipsis: false },
  { length: 81, ellipsis: true },
])("$length 文字のサマリーを境界どおり索引化する", ({ length, ellipsis }) => {
  const dir = createRepo();
  const summary = "あ".repeat(length);
  const note = writeNote(dir, `2026-09-01-summary-${length}.md`, summary);

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  const indexedSummary = index.split("— ").at(-1).trimEnd();
  expect(indexedSummary.endsWith("…")).toBe(ellipsis);
  expect([...indexedSummary]).toHaveLength(Math.min(length, 80));
});
