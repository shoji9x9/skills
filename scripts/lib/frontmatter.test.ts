import { expect, test } from "vitest";
import { sameSkillFrontmatter as sameFrontmatter } from "./frontmatter.ts";

// SKILL.md の frontmatter の比べ方（原本と、`gh skill install` が書き直したインストール済みのコピー）。

test.each([
  ["キーの順だけが違う", "name: x\ndescription: d\n", "description: d\nname: x\n"],
  [
    "コピーにだけ metadata.local-path がある",
    "name: x\n",
    "name: x\nmetadata:\n  local-path: skills/x\n",
  ],
  [
    "local-path 以外の metadata は残る",
    "name: x\nmetadata:\n  a: 1\n",
    "name: x\nmetadata:\n  a: 1\n  local-path: skills/x\n",
  ],
  ["空とコメントだけ", "", "# comment\n"],
  ["同じ集合（!!set）", "tags: !!set {a, b}\n", "tags: !!set {b, a}\n"],
  ["同じ日付", "d: 2026-10-15\n", "d: 2026-10-15\n"],
])("同じとみなす: %s", (_label, a, b) => {
  expect(sameFrontmatter(a, b)).toBe(true);
});

test.each([
  ["値が違う", "name: x\n", "name: y\n"],
  [
    "local-path 以外の metadata が違う",
    "name: x\nmetadata:\n  a: 1\n",
    "name: x\nmetadata:\n  a: 2\n",
  ],
  ["集合（!!set）の中身が違う", "tags: !!set {a}\n", "tags: !!set {b}\n"],
  ["日付が違う", "d: 2026-10-15\n", "d: 2026-10-16\n"],
  ["日付と、同じ ISO 8601 の文字列", "d: 2026-10-15\n", 'd: "2026-10-15T00:00:00.000Z"\n'],
  [
    "metadata が集合（!!set）で、もう片方に metadata が無い",
    "name: x\nmetadata: !!set {a}\n",
    "name: x\n",
  ],
  ["スカラーの false と空", "false\n", ""],
])("違うとみなす: %s", (_label, a, b) => {
  expect(sameFrontmatter(a, b)).toBe(false);
});

test("YAML として読めなければ例外にする", () => {
  expect(() => sameFrontmatter("a: [1,\n", "a: 1\n")).toThrow();
});
