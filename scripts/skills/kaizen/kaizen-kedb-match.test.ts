import { afterEach, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";

// 一時ディレクトリの fixture リポジトリの学びのパス。check-kaizen-refs が、このリポジトリの学びへの参照と読まないよう、組み立てて書く。
const noteRef = (name: string) => `.kaizen/${name}`;

// kaizen-kedb-match.sh は、新しい学びを記録する前に既存の学びと照合する（references/extract.md「KEDB 照合」）。
// 取り決めは次のとおりである。
//   - top-level（.kaizen/*.md）は本文を照合し、archive は INDEX.md の行だけを照合する（本文は読まない）
//   - 照合は固定文字列で大文字と小文字を区別せず、渡した語をすべて含む記録を返す
//   - 終了コードは 0 が一致あり、1 が検査したうえで一致なし、2 が引数の不足か走査の失敗
//   - 出力は一致したファイルと status
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-kedb-match.sh");

const workdirs: string[] = [];
afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project({ kaizen = true } = {}) {
  const dir = makeTempDir("kaizen-kedb-");
  workdirs.push(dir);
  if (kaizen) mkdirSync(join(dir, ".kaizen", "archive"), { recursive: true });
  return dir;
}

function note(dir: string, name: string, body: string, status: string | null = "pending") {
  const fm = ["---", "date: 2026-09-01", "type: rule", ...(status ? [`status: ${status}`] : [])];
  writeFileSync(join(dir, ".kaizen", name), `${[...fm, "---", "", body, ""].join("\n")}`);
}

function match(dir: string, ...keywords: string[]) {
  const res = spawnSync("bash", [script, ...keywords], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...coverageEnv() },
    timeout: 30_000,
  });
  const hits = res.stdout.split("\n").filter(Boolean);
  return { ...res, hits };
}

test.each([
  ["語が 1 つしか無い", ["hook"], "usage:"],
  ["空の語がある", ["hook", ""], "keywords must not be empty"],
])("%s なら exit 2 で止める（照合しないまま「一致なし」と答えない）", (_name, args, message) => {
  const dir = project();
  note(dir, "2026-09-01-a.md", "hook の事象");
  const res = match(dir, ...args);
  expect(res.status).toBe(2);
  expect(res.stderr).toContain(message);
  expect(res.hits).toStrictEqual([]);
});

test(".kaizen が無ければ、一致なしとして exit 1 を返す", () => {
  const res = match(project({ kaizen: false }), "hook", "commit");
  expect(res.status).toBe(1);
  expect(res.hits).toStrictEqual([]);
});

test("top-level のノートは、渡した語をすべて含むものだけを status つきで返す", () => {
  const dir = project();
  note(dir, "2026-09-01-both.md", "PreToolUse の Hook が git commit を止めた");
  note(dir, "2026-09-01-one.md", "PreToolUse の Hook だけの話", "applied");
  const res = match(dir, "hook", "commit");
  expect(res.status, res.stderr).toBe(0);
  expect(res.hits).toStrictEqual([`${noteRef("2026-09-01-both.md")}\tstatus=pending`]);

  // 誤検知しないことの確認: どのノートにも全部の語がそろわなければ exit 1。
  const none = match(dir, "hook", "rebase");
  expect(none.status).toBe(1);
  expect(none.hits).toStrictEqual([]);
});

test("照合は固定文字列で、大文字と小文字を区別しない", () => {
  const dir = project();
  note(dir, "2026-09-01-regex.md", "設定 a.b を書き換えた");
  note(dir, "2026-09-01-other.md", "設定 axb を書き換えた");
  // `.` を正規表現として扱うと axb にも一致する。
  const res = match(dir, "A.B", "設定");
  expect(res.status, res.stderr).toBe(0);
  expect(res.hits).toStrictEqual([`${noteRef("2026-09-01-regex.md")}\tstatus=pending`]);
});

test("status は frontmatter から読み、無ければ unknown と出す（本文の status: は読まない）", () => {
  const dir = project();
  note(dir, "2026-09-01-forgotten.md", "hook commit の事象", "forgotten");
  note(dir, "2026-09-01-nostatus.md", "hook commit の事象\nstatus: applied", null);
  const res = match(dir, "hook", "commit");
  expect(res.status, res.stderr).toBe(0);
  // 忘却済みのノートも照合の対象に入る（忘却は注入から外すだけ）。
  expect(res.hits).toStrictEqual([
    `${noteRef("2026-09-01-forgotten.md")}\tstatus=forgotten`,
    `${noteRef("2026-09-01-nostatus.md")}\tstatus=unknown`,
  ]);
});

test("archive は INDEX.md の行だけを照合し、本文は照合しない", () => {
  const dir = project();
  writeFileSync(
    join(dir, ".kaizen", "archive", "2026-06-02-body-only.md"),
    "---\nstatus: applied\n---\n\nhook commit は本文にだけある\n",
  );
  writeFileSync(
    join(dir, ".kaizen", "archive", "INDEX.md"),
    [
      "# アーカイブ済みの学び（サマリー索引）",
      "",
      "- `2026-06-02-body-only.md` — date: 2026-06-02 status: applied — 別の話題",
      "- `2026-06-03-indexed.md` — date: 2026-06-03 type: doc status: applied — Hook が commit を止めた",
      "- `2026-06-04-nostatus.md` — date: 2026-06-04 — Hook と commit の古い索引",
      // 索引の形でない行（箇条でない説明文）は、語を含んでいても返さない。
      "hook と commit の説明だけの行",
      "",
    ].join("\n"),
  );
  const res = match(dir, "hook", "commit");
  expect(res.status, res.stderr).toBe(0);
  expect(res.hits).toStrictEqual([
    `${noteRef("archive/2026-06-03-indexed.md")}\tstatus=applied`,
    `${noteRef("archive/2026-06-04-nostatus.md")}\tstatus=unknown`,
  ]);
});

test.skipIf(process.getuid?.() === 0)(
  "読めないノートがあれば exit 2 で止める（一致なしとして扱わない）",
  () => {
    const dir = project();
    note(dir, "2026-09-01-locked.md", "hook commit の事象");
    chmodSync(join(dir, ".kaizen", "2026-09-01-locked.md"), 0o000);
    try {
      const res = match(dir, "hook", "commit");
      expect(res.status).toBe(2);
      expect(res.stderr).toContain(`failed to search ${noteRef("2026-09-01-locked.md")}`);
    } finally {
      chmodSync(join(dir, ".kaizen", "2026-09-01-locked.md"), 0o644);
    }
  },
);
