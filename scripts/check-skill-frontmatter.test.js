import { test, expect } from "vitest";
import { checkFrontmatter, extractFrontmatter } from "./check-skill-frontmatter.js";

// frontmatter を持つ最小の SKILL.md を組み立てるヘルパ。
const skill = (fm, body = "\n# Title\n") => `---\n${fm}\n---\n${body}`;
const ok = (path, content) => checkFrontmatter(path, content).length === 0;

test("extractFrontmatter: 先頭 --- ブロックを取り出す", () => {
  expect(extractFrontmatter("---\nname: a\n---\n本文\n")).toBe("name: a");
  expect(extractFrontmatter("先頭に本文\n---\nname: a\n---\n")).toBe(null);
  expect(extractFrontmatter("frontmatter 無し\n")).toBe(null);
});

test("BOM 付きでも BOM 無しと同じ結果になる", () => {
  const withBom = "﻿---\nname: a\ndescription: b\n---\n本文\n";
  const withoutBom = "---\nname: a\ndescription: b\n---\n本文\n";
  expect(extractFrontmatter(withBom)).toBe(extractFrontmatter(withoutBom));
  expect(extractFrontmatter(withBom)).toBe("name: a\ndescription: b");
  expect(checkFrontmatter("SKILL.md", withBom)).toEqual(checkFrontmatter("SKILL.md", withoutBom));
});

test("妥当な frontmatter は違反ゼロ", () => {
  expect(ok("SKILL.md", skill('name: my-skill\ndescription: "何かをするスキル。"'))).toBe(true);
});

test("クォート無しでも通常の description は通る", () => {
  expect(ok("SKILL.md", skill("name: my-skill\ndescription: 何かをするスキル"))).toBe(true);
});

test("未クオート description の「: 」で YAML が壊れたら検出", () => {
  // 「A: 論理データ設計」のような ASCII コロン＋スペースがマッピング区切りと解釈される。
  const v = checkFrontmatter("SKILL.md", skill("name: my-skill\ndescription: A: 論理データ設計"));
  expect(v.length).toBe(1);
  expect(v[0]).toMatch(/YAML としてパースできない/);
});

test("クォートすれば「: 」を含む description も通る", () => {
  expect(ok("SKILL.md", skill('name: my-skill\ndescription: "A: 論理データ設計"'))).toBe(true);
});

test("description が 1024 バイト超過で検出", () => {
  // ASCII 1 文字 = 1 バイト。1025 文字で 1025 バイト。
  const desc = "x".repeat(1025);
  const v = checkFrontmatter("SKILL.md", skill(`name: my-skill\ndescription: ${desc}`));
  expect(v.length).toBe(1);
  expect(v[0]).toMatch(/1025.*超過/);
});

test("description がちょうど 1024 バイトは許可", () => {
  const desc = "x".repeat(1024);
  expect(ok("SKILL.md", skill(`name: my-skill\ndescription: ${desc}`))).toBe(true);
});

test("日本語はバイト長で判定する（1 文字 3 バイト）", () => {
  // 「あ」= 3 バイト。342 文字 = 1026 バイトで超過。
  const desc = "あ".repeat(342);
  const v = checkFrontmatter("SKILL.md", skill(`name: my-skill\ndescription: ${desc}`));
  expect(v.length).toBe(1);
  expect(v[0]).toMatch(/1026.*超過/);
});

test("description が無ければ検出", () => {
  const v = checkFrontmatter("SKILL.md", skill("name: my-skill"));
  expect(v).toContain("description が無い");
});

test("name が無ければ検出", () => {
  const v = checkFrontmatter("SKILL.md", skill('description: "何かをするスキル"'));
  expect(v).toContain("name が無い");
});

test("name の大文字・アンダースコアは形式違反", () => {
  const v = checkFrontmatter("SKILL.md", skill('name: My_Skill\ndescription: "x"'));
  expect(v.some((m) => m.includes("小文字英数字とハイフン"))).toBe(true);
});

test("name が 64 文字超過で検出", () => {
  const name = "a".repeat(65);
  const v = checkFrontmatter("SKILL.md", skill(`name: ${name}\ndescription: "x"`));
  expect(v.some((m) => m.includes("64 文字を超過"))).toBe(true);
});

test("name ちょうど 64 文字は許可", () => {
  const name = "a".repeat(64);
  expect(ok("SKILL.md", skill(`name: ${name}\ndescription: "x"`))).toBe(true);
});

test("frontmatter が無ければ検出", () => {
  const v = checkFrontmatter("SKILL.md", "# Title\n本文のみ\n");
  expect(v.length).toBe(1);
  expect(v[0]).toMatch(/frontmatter.*見つからない/);
});

test("frontmatter がマッピングでなければ検出", () => {
  const v = checkFrontmatter("SKILL.md", skill("- a\n- b"));
  expect(v).toContain("frontmatter が YAML マッピングになっていない");
});
