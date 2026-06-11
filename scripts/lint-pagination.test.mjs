import { test, expect } from "vitest";
import { lint, tokenize, restEndpointSegment } from "./lint-pagination.mjs";

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
