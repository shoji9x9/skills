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
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
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

// Issue #303: 先頭段落が折り返されたノートで、索引の要約が文の途中で切れていた。
// 連結してから 80 文字で切り詰めるため、境界（見出し・空行・箇条書きの兄弟項目）で
// 止まることと、止まらずに継ぐことの両方を弁別する。
test("折り返した先頭段落を連結してから索引化する", () => {
  const dir = createRepo();
  const note = writeNote(
    dir,
    "2026-09-01-wrapped.md",
    "先頭段落が折り返されている",
    "ので続きも読む。\n",
  );

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 先頭段落が折り返されているので続きも読む。\n");
});

test("段落の境界（空行・後続見出し・箇条書き・水平線）を越えて連結しない", () => {
  const dir = createRepo();
  const blank = writeNote(
    dir,
    "2026-09-01-blank.md",
    "空行で閉じる段落。",
    "\n次の段落は含めない。\n",
  );
  // 見出しの前後に空行を挟むと空行側の境界だけで止まり、見出しの分岐に到達しない
  // （変異で実測）。見出しは先頭段落の直後に、次の本文は見出しの直後に置く。
  const heading = writeNote(
    dir,
    "2026-09-01-heading.md",
    "見出しで閉じる段落。",
    "## 根本原因\n別の節。\n",
  );
  const bullet = writeNote(dir, "2026-09-01-bullet.md", "- 先頭の項目", "- 兄弟の項目\n");
  // 段落の直後に始まるリストも継続行ではない（繋ぐと「。- A の項目- B の項目」になる）。
  const paraList = writeNote(
    dir,
    "2026-09-01-para-list.md",
    "対象は次の 2 つ。",
    "- A の項目\n- B の項目\n",
  );
  const rule = writeNote(dir, "2026-09-01-rule.md", "水平線で閉じる段落。", "---\n\n別の節。\n");

  const result = archive(dir, blank, heading, bullet, paraList, rule);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 空行で閉じる段落。\n");
  expect(index).toContain("— 見出しで閉じる段落。\n");
  expect(index).toContain("— - 先頭の項目\n");
  expect(index).toContain("— 対象は次の 2 つ。\n");
  expect(index).toContain("— 水平線で閉じる段落。\n");
});

test("連結の継ぎ目は両側が ASCII のときだけ空白を入れる", () => {
  const dir = createRepo();
  const ascii = writeNote(
    dir,
    "2026-09-01-ascii.md",
    "the lead paragraph is",
    "wrapped onto two lines.\n",
  );
  const cjk = writeNote(dir, "2026-09-01-cjk.md", "日本語の折り返しは", "空白を伴わない。\n");
  const mixed = writeNote(dir, "2026-09-01-mixed.md", "対象は`gh api`の", "pagination である。\n");

  const result = archive(dir, ascii, cjk, mixed);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— the lead paragraph is wrapped onto two lines.\n");
  expect(index).toContain("— 日本語の折り返しは空白を伴わない。\n");
  expect(index).toContain("— 対象は`gh api`のpagination である。\n");
});

test("連結後に 80 文字を超えたら … を付けて切り詰める", () => {
  const dir = createRepo();
  const note = writeNote(dir, "2026-09-01-long.md", "あ".repeat(60), `${"い".repeat(60)}\n`);

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  const indexedSummary = index.split("— ").at(-1).trimEnd();
  expect(indexedSummary).toBe(`${"あ".repeat(60)}${"い".repeat(19)}…`);
});

test("見出しが無いノートのフォールバックでも先頭段落を連結する", () => {
  const dir = createRepo();
  const path = join(dir, ".kaizen", "2026-09-01-no-heading.md");
  writeFileSync(
    path,
    "---\ndate: 2026-09-01\ntype: doc\npriority: low\nstatus: pending\n---\n\n# タイトル\n\n見出しが無くても\n段落として読む。\n",
  );

  const result = archive(dir, path);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 見出しが無くても段落として読む。\n");
});

// frontmatter の後に区切り線を置くノートで、要約が `---` そのものにならないこと。
test("フォールバックは frontmatter 後の水平線を要約にしない", () => {
  const dir = createRepo();
  const path = join(dir, ".kaizen", "2026-09-01-rule-fallback.md");
  writeFileSync(
    path,
    "---\ndate: 2026-09-01\ntype: doc\npriority: low\nstatus: pending\n---\n\n---\n\n本文はここから\n始まる。\n",
  );

  const result = archive(dir, path);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 本文はここから始まる。\n");
});
