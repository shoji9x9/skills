import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "./lint-pagination.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

// markdown の bash コードブロックで囲む小さなヘルパ。
const md = (body: string) => "# t\n\n```bash\n" + body + "\n```\n";
const count = (path: string, content: string) => lint(path, content).length;

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

test("REST: クォートの中に空白とスラッシュを含むフラグ値があっても、後ろのコレクション取得を指摘する", () => {
  expect(
    count("t.md", md('gh api -H "Accept: application/vnd.github+json" repos/o/r/comments')),
  ).toBe(1);
});

test.each([
  ["--paginate 付きのコレクション取得", "gh api --paginate repos/o/r/issues"],
  ["first: を持たない GraphQL", "gh api graphql -f query='{}'"],
])("%sは指摘しない", (_label, body) => {
  expect(count("t.md", md(body))).toBe(0);
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
// 除外の内と外に**同じ違反**を置いて、区別できることまで確かめる。

const script = join(dirname(fileURLToPath(import.meta.url)), "lint-pagination.ts");
const OFFENDING =
  "# t\n\n```bash\ngh api graphql -f query='{ a { b(first: 50) { nodes { id } } } }'\n```\n";

function makeRepo({ git = true } = {}) {
  const dir = makeTempDir("pagination-lint-");
  if (git) {
    const init = spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"], {
      timeout: CHILD_TIMEOUT_MS,
      encoding: "utf8",
    });
    expect(init.status, init.stderr).toBe(0);
  }
  return dir;
}

function write(dir: string, rel: string, body: string) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

function runCli(cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    encoding: "utf8",
  });
}

test("除外の内と外に同じ違反を置くと、無視されていない側だけが指摘される（区別できることの確認）", () => {
  const dir = makeRepo();
  write(dir, ".gitignore", "tests/*/iteration-*/eval-*/\n");
  // 除外の外（tracked でなくても .gitignore に当たらないので走査対象）＝検出されるべき側
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
  // 検出されるべき側が出ていることを確かめたうえで、除外側が出ていないことを主張する。
  expect(out.stderr).not.toContain("response.md");
  expect(out.stderr).toContain("1 件の指摘");
});

test("除外を外すと、同じファイルが指摘される（除外が機能していたことの裏取り）", () => {
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

  const out = runCli(dir);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("guide.md");
});

test("走査対象 0 件は成功として扱わない", () => {
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

test.each([
  ["git の列挙", true],
  ["git の無いディレクトリの走査", false],
])(
  "%sは node_modules とエージェント用のコピー・リンクを外し、rule と private skill の実体は見る",
  (_, git) => {
    const dir = makeRepo({ git });
    for (const rel of [
      "skills/x/SKILL.md",
      ".agents/skills/x/SKILL.md",
      ".claude/skills/x.md",
      "node_modules/pkg/readme.md",
      ".agents/rules/r.md",
      ".agents/skills/priv/SKILL.md",
    ])
      write(dir, rel, OFFENDING);

    const out = runCli(dir);
    expect(out.status).toBe(1);
    const flagged = [...out.stderr.matchAll(/^(\S+):\d+: /gm)].map((m) => m[1]).sort();
    expect(flagged).toEqual([
      ".agents/rules/r.md",
      ".agents/skills/priv/SKILL.md",
      "skills/x/SKILL.md",
    ]);
  },
);

test("git の無いディレクトリでは .sh と .md だけを読み、除外ディレクトリへ降りない", () => {
  const dir = makeRepo({ git: false });
  const command = "gh api graphql -f query='{ a { b(first: 50) { nodes { id } } } }'\n";
  write(dir, "a.md", OFFENDING);
  write(dir, "b.sh", command);
  write(dir, "c.txt", command);
  write(dir, "node_modules/d.md", OFFENDING);

  const out = runCli(dir);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("a.md:");
  expect(out.stderr).toContain("b.sh:");
  expect(out.stderr).not.toContain("c.txt");
  expect(out.stderr).not.toContain("d.md");
  expect(out.stderr).toContain("2 ファイル走査");
});

test("対象は挙がったのに 1 件も読めなければ成功として扱わない", () => {
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
    { timeout: CHILD_TIMEOUT_MS, cwd: dir, encoding: "utf8" },
  );
  expect(out.status).toBe(2);
  expect(out.stderr).toMatch(/1 件も読めなかった/);
});

test("除外判定は dir 相対で行う（リポジトリの外側のディレクトリ名に巻き込まれない）", () => {
  // 親ディレクトリ名に除外語（node_modules）が入った場所へリポジトリを置く。
  const parent = makeTempDir("pagination-outer-");
  const nested = join(parent, "node_modules", "pkg");
  mkdirSync(nested, { recursive: true });
  const init = spawnSync("git", ["-C", nested, "init", "-q", "-b", "main"], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(init.status, init.stderr).toBe(0);
  write(nested, "docs/guide.md", OFFENDING);

  const out = runCli(nested);
  expect(out.status).toBe(1);
  expect(out.stderr).toContain("docs/guide.md:");
});

test("1 件でも読めなければ合格として扱わない", () => {
  const dir = makeRepo();
  write(dir, "ok.md", "# t\n");
  // 読めない対象は、引数で渡す方法で作る（列挙は実在するファイルしか返さないため）。
  const res = spawnSync(process.execPath, [script, join(dir, "ok.md"), join(dir, "missing.md")], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(/読めず走査していない/);
  expect(res.stdout).not.toMatch(/OK/);
});

test("全件読めれば従来どおり OK（読めない件数 0 を落とさない）", () => {
  const dir = makeRepo();
  write(dir, "ok.md", "# t\n");
  const res = spawnSync(process.execPath, [script, join(dir, "ok.md")], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(res.status).toBe(0);
  expect(res.stdout).toMatch(/OK（1 ファイル走査）/);
});

test("読めないファイルがあっても、読めたぶんの指摘は exit 1 で出す", () => {
  const dir = makeRepo();
  write(dir, "bad.md", OFFENDING);
  const res = spawnSync(process.execPath, [script, join(dir, "bad.md"), join(dir, "missing.md")], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/bad\.md/);
  expect(res.stderr).toMatch(/1 ファイルは読めず未走査/);
});
