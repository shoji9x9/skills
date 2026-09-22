import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lint,
  tokenize,
  restEndpointSegment,
  gitFiles,
  walkFiles,
  listFiles,
} from "./lint-pagination.js";

// markdown の bash コードブロックで囲む小さなヘルパ。
const md = (body) => "# t\n\n```bash\n" + body + "\n```\n";
const count = (path, content) => lint(path, content).length;

test("tokenize: クォート内の空白を 1 トークンに保つ", () => {
  expect(tokenize('gh api -H "Accept: application/vnd.github+json" repos/o/r/issues')).toEqual([
    "gh",
    "api",
    "-H",
    '"Accept: application/vnd.github+json"',
    "repos/o/r/issues",
  ]);
});

test("restEndpointSegment: 末尾セグメントを取り出す", () => {
  expect(restEndpointSegment("gh api repos/o/r/pulls/6/comments")).toBe("comments");
  expect(restEndpointSegment("gh api --paginate repos/o/r/issues")).toBe("issues");
  expect(restEndpointSegment("gh api repos/o/r/pulls/6")).toBe("6");
  expect(restEndpointSegment("gh api graphql -f query='{}'")).toBe(null);
});

test("restEndpointSegment: スラッシュを含むフラグ値をエンドポイントと誤認しない", () => {
  expect(
    restEndpointSegment('gh api -H "Accept: application/vnd.github+json" repos/o/r/comments'),
  ).toBe("comments");
});

test("GraphQL: first: に pageInfo も --paginate も無ければ指摘", () => {
  expect(
    count(
      "t.md",
      md("gh api graphql -f query='{ a { reviewThreads(first: 50) { nodes { id } } } }'"),
    ),
  ).toBe(1);
});

test("GraphQL: pageInfo があれば許可", () => {
  expect(
    count(
      "t.md",
      md(
        "gh api graphql -f query='{ reviewThreads(first: 50) { pageInfo { hasNextPage } nodes { id } } }'",
      ),
    ),
  ).toBe(0);
});

test("GraphQL: --paginate があれば許可", () => {
  expect(
    count(
      "t.md",
      md("gh api graphql --paginate -f query='{ reviewThreads(first: 50) { nodes { id } } }'"),
    ),
  ).toBe(0);
});

test("GraphQL: --paginate が query の後ろにあっても許可（順序非依存）", () => {
  expect(
    count(
      "t.md",
      md("gh api graphql -f query='{ reviewThreads(first: 50) { nodes { id } } }' --paginate"),
    ),
  ).toBe(0);
});

test("GraphQL: 同ブロックの別コマンドの --paginate に惑わされない", () => {
  const body = [
    "gh api graphql -f query='{ reviewThreads(first: 50) { nodes { id } } }'",
    "gh api --paginate repos/o/r/issues",
  ].join("\n");
  expect(count("t.md", md(body))).toBe(1); // graphql の 1 件のみ
});

test("GraphQL: # pagination-ok で抑制", () => {
  expect(
    count(
      "t.md",
      md(
        "gh api graphql -f query='{ reviewThreads(first: 50) { nodes { id } } }'  # pagination-ok",
      ),
    ),
  ).toBe(0);
});

test("REST: コレクション取得に --paginate が無ければ指摘", () => {
  expect(count("t.md", md("gh api repos/o/r/pulls/6/comments"))).toBe(1);
});

test("REST: --paginate があれば許可", () => {
  expect(count("t.md", md("gh api --paginate repos/o/r/pulls/6/comments"))).toBe(0);
});

test("REST: 単一リソース GET は対象外", () => {
  expect(count("t.md", md("gh api repos/o/r/pulls/6"))).toBe(0);
});

test("REST: 変更系（POST 等）は対象外", () => {
  expect(
    count(
      "t.md",
      md("gh api --method POST repos/o/r/pulls/6/requested_reviewers -f reviewers[]=Copilot"),
    ),
  ).toBe(0);
});

test("REST: per_page を使うのに --paginate が無ければ指摘", () => {
  expect(count("t.sh", '#!/usr/bin/env bash\ngh api "repos/$O/$R/issues?per_page=100"')).toBe(1);
});

test("REST: per_page + --paginate は許可", () => {
  expect(count("t.sh", 'gh api --paginate "repos/o/r/issues?per_page=100"')).toBe(0);
});

test("REST: # pagination-ok で抑制", () => {
  expect(count("t.md", md("gh api repos/o/r/pulls/6/comments  # pagination-ok"))).toBe(0);
});

test("REST: 行継続をまたいでも判定する", () => {
  expect(count("t.sh", "gh api \\\n  repos/o/r/pulls/6/comments")).toBe(1);
});

test("markdown: bash 以外のブロックは無視", () => {
  expect(count("t.md", '```json\n{ "x": "gh api repos/o/r/comments" }\n```\n')).toBe(0);
});

test("複数指摘: GraphQL と REST を両方検出", () => {
  const body = [
    "gh api graphql -f query='{ reviewThreads(first: 50) { nodes { id } } }'",
    "gh api repos/o/r/pulls/6/comments",
  ].join("\n");
  expect(count("t.md", md(body))).toBe(2);
});

// --- 走査対象の列挙（.gitignore を尊重するか） -------------------------------
//
// 素朴なディレクトリ走査は `.gitignore` 済みの生成物まで読むため、CI（tracked のみの
// クリーンな checkout）では出ない指摘が手元でだけ出る。実際に
// tests/*/iteration-*/eval-*/ の eval 実行成果物で 2 件の偽の赤が出た。
// 除外を入れた検査は「本当に無い」と「検査が動いていない」が同じ出力になるので、
// 除外の内と外に**同じ違反**を置いて弁別できることまで確かめる。

const script = join(dirname(fileURLToPath(import.meta.url)), "lint-pagination.js");
const OFFENDING =
  "# t\n\n```bash\ngh api graphql -f query='{ a { b(first: 50) { nodes { id } } } }'\n```\n";

function makeRepo({ git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pagination-lint-"));
  if (git) {
    const init = spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf8" });
    expect(init.status, init.stderr).toBe(0);
  }
  return dir;
}

function write(dir, rel, body) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

test("除外の内と外に同じ違反を置くと、無視されていない側だけが指摘される（弁別）", () => {
  const dir = makeRepo();
  write(dir, ".gitignore", "tests/*/iteration-*/eval-*/\n");
  // 除外の外（tracked でなくても .gitignore に当たらないので走査対象）＝陽性コントロール
  write(dir, "docs/guide.md", OFFENDING);
  // 除外の中（eval 実行成果物と同じ場所）＝飛ぶべき側
  write(
    dir,
    "tests/issue-batch/iteration-5/eval-10/with_skill/run-1/outputs/response.md",
    OFFENDING,
  );

  const out = runCli(dir);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("docs/guide.md");
  // 陽性コントロールが出ていることを確かめたうえで、除外側が出ていないことを主張する。
  expect(out.stderr).not.toContain("response.md");
  expect(out.stderr).toContain("1 件の指摘");
});

test("除外を外すと、同じファイルが指摘される（除外が効いていたことの裏取り）", () => {
  const dir = makeRepo();
  write(dir, ".gitignore", "# 何も無視しない\n");
  write(
    dir,
    "tests/issue-batch/iteration-5/eval-10/with_skill/run-1/outputs/response.md",
    OFFENDING,
  );

  const out = runCli(dir);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("response.md");
});

test("無視されたファイルも、引数で明示的に渡せば走査する", () => {
  const dir = makeRepo();
  write(dir, ".gitignore", "ignored/\n");
  write(dir, "ignored/a.md", OFFENDING);
  write(dir, "keep.md", "# t\n");

  const out = runCli(dir, ["ignored/a.md"]);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("ignored/a.md");
});

test("git work tree でなければディレクトリ走査へ落ちる（走査を止めない）", () => {
  const dir = makeRepo({ git: false });
  write(dir, "docs/guide.md", OFFENDING);

  expect(gitFiles(dir)).toBeNull();
  const out = runCli(dir);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("guide.md");
});

test("走査対象 0 件は成功に倒さない", () => {
  const dir = makeRepo();
  const out = runCli(dir);
  expect(out.status).toBe(2);
  expect(out.stderr).toMatch(/走査対象が 0 件/);
});

test("指摘ゼロのときは走査したファイル数を出す（0 件の素通りと区別する）", () => {
  const dir = makeRepo();
  write(dir, "clean.md", "# t\n\n```bash\ngh api --paginate repos/o/r/issues\n```\n");
  const out = runCli(dir);
  expect(out.status).toBe(0);
  expect(out.stdout).toContain("1 ファイル走査");
});

test("gitFiles は node_modules / .agents / .claude を外す", () => {
  const dir = makeRepo();
  write(dir, ".agents/skills/x/SKILL.md", "# t\n");
  write(dir, ".claude/skills/x.md", "# t\n");
  write(dir, "node_modules/pkg/readme.md", "# t\n");
  write(dir, "kept.md", "# t\n");

  const files = gitFiles(dir);
  expect(files).not.toBeNull();
  expect(files.some((f) => f.endsWith("kept.md"))).toBe(true);
  expect(files.filter((f) => /\.agents|\.claude|node_modules/.test(f))).toEqual([]);
});

test("walkFiles は .sh と .md だけを拾い、除外ディレクトリへ降りない", () => {
  const dir = makeRepo({ git: false });
  write(dir, "a.md", "");
  write(dir, "b.sh", "");
  write(dir, "c.txt", "");
  write(dir, "node_modules/d.md", "");

  const files = walkFiles(dir).map((f) => f.slice(dir.length + 1));
  expect(files.sort()).toEqual(["a.md", "b.sh"]);
});

test("読めなかったファイルは件数として出す（黙って飛ばさない）", () => {
  const dir = makeRepo();
  write(dir, "a.md", OFFENDING);
  const out = spawnSync(
    process.execPath,
    [
      "-e",
      `const fs = await import("node:fs");` +
        `const m = await import(${JSON.stringify(script)});` +
        `process.exitCode = m.main(["a.md", "gone.md"], { readFileSync: (p, e) => {` +
        `  if (p === "gone.md") throw new Error("ENOENT");` +
        `  return fs.readFileSync(p, e);` +
        `} });`,
      "--input-type=module",
    ],
    { cwd: dir, encoding: "utf8" },
  );
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("1 ファイルは読めず未走査");
});

test("対象は挙がったのに 1 件も読めなければ成功に倒さない", () => {
  const dir = makeRepo();
  write(dir, "a.md", "# t\n");
  const out = spawnSync(
    process.execPath,
    [
      "-e",
      `const m = await import(${JSON.stringify(script)});` +
        `process.exitCode = m.main([], { readFileSync: () => { throw new Error("ENOENT"); } });`,
      "--input-type=module",
    ],
    { cwd: dir, encoding: "utf8" },
  );
  expect(out.status).toBe(2);
  expect(out.stderr).toMatch(/1 件も読めなかった/);
});

test("除外判定は dir 相対で行う（リポジトリの外側のディレクトリ名に巻き込まれない）", () => {
  // 親ディレクトリ名に除外語（node_modules）が入った場所へリポジトリを置く。
  const parent = mkdtempSync(join(tmpdir(), "pagination-outer-"));
  const nested = join(parent, "node_modules", "pkg");
  mkdirSync(nested, { recursive: true });
  const init = spawnSync("git", ["-C", nested, "init", "-q", "-b", "main"], { encoding: "utf8" });
  expect(init.status, init.stderr).toBe(0);
  write(nested, "docs/guide.md", OFFENDING);

  const files = gitFiles(nested);
  expect(files).not.toBeNull();
  expect(files.some((f) => f.endsWith("docs/guide.md"))).toBe(true);
});

test("listFiles は git があれば git の結果を使う", () => {
  const dir = makeRepo();
  write(dir, ".gitignore", "gen/\n");
  write(dir, "gen/x.md", "");
  write(dir, "y.md", "");

  const fromList = listFiles(dir);
  expect(fromList.some((f) => f.endsWith("y.md"))).toBe(true);
  expect(fromList.some((f) => f.endsWith("gen/x.md"))).toBe(false);
  // 対照: 素朴な走査なら無視ファイルも拾う（＝上の不在が「走査していない」ではないことの裏取り）。
  expect(walkFiles(dir).some((f) => f.endsWith("x.md"))).toBe(true);
});
