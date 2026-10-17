import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFrontmatter } from "./check-skill-frontmatter.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-skill-frontmatter.ts");

// frontmatter を持つ最小の SKILL.md を組み立てるヘルパ。
const skill = (fm: string, body = "\n# Title\n") => `---\n${fm}\n---\n${body}`;
const ok = (path: string, content: string) => checkFrontmatter(path, content).length === 0;

test("先頭に本文がある --- ブロックは frontmatter として読まない", () => {
  const v = checkFrontmatter("SKILL.md", "先頭に本文\n---\nname: a\ndescription: b\n---\n");
  expect(v).toHaveLength(1);
  expect(v[0]).toMatch(/frontmatter.*見つからない/);
});

test("BOM 付きでも BOM 無しと同じ結果になる", () => {
  const withBom = "﻿---\nname: a\ndescription: b\n---\n本文\n";
  const withoutBom = "---\nname: a\ndescription: b\n---\n本文\n";
  expect(checkFrontmatter("SKILL.md", withBom)).toEqual([]);
  expect(checkFrontmatter("SKILL.md", withBom)).toEqual(checkFrontmatter("SKILL.md", withoutBom));
  // 違反がある入力でも、BOM の有無で結果が変わらない。
  const badBom = "﻿---\nname: A\n---\n";
  expect(checkFrontmatter("SKILL.md", badBom)).toEqual(
    checkFrontmatter("SKILL.md", badBom.slice(1)),
  );
  expect(checkFrontmatter("SKILL.md", badBom)).toHaveLength(2);
});

test("妥当な frontmatter は違反ゼロ", () => {
  expect(ok("SKILL.md", skill('name: my-skill\ndescription: "何かをするスキル。"'))).toBe(true);
});

test("クォート無しでも通常の description は通る", () => {
  expect(ok("SKILL.md", skill("name: my-skill\ndescription: 何かをするスキル"))).toBe(true);
});

test("未クオート description の「: 」で YAML が読めなくなったら検出", () => {
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

// `!!set` は Set に（js-yaml 5 から）、タイムスタンプは Date に（js-yaml 4 から）なる。object でもマッピングではないので、同じ報告にする。
test.each([
  ["集合（!!set）", "!!set {name, description}"],
  ["日付", "2026-10-15"],
])("frontmatter が%sなら、マッピングになっていないと報告する", (_label, fm) => {
  const v = checkFrontmatter("SKILL.md", skill(fm));
  expect(v).toEqual(["frontmatter が YAML マッピングになっていない"]);
});

// js-yaml 5 の load は空の入力で例外を投げるが、構文の誤りではないので「パースできない」とは報告しない。
test.each([
  ["空", ""],
  ["コメントだけ", "# comment"],
])(
  "frontmatter が%sなら、パースできないではなくマッピングになっていないと報告する",
  (_label, fm) => {
    const v = checkFrontmatter("SKILL.md", skill(fm));
    expect(v).toEqual(["frontmatter が YAML マッピングになっていない"]);
  },
);

test.each([
  ["description が文字列でない", "name: my-skill\ndescription: 1", "description が文字列でない"],
  ["name が文字列でない", 'name: 1\ndescription: "x"', "name が文字列でない"],
])("%sなら検出する", (_label, fm, msg) => {
  expect(checkFrontmatter("SKILL.md", skill(fm))).toEqual([msg]);
});

// CLI の状態空間: 引数（なし / SKILL.md / SKILL.md 以外）× 走査の対象（skills/ / 印のある private skill / 印の無いコピー）× 結果（違反あり / なし）。
const GOOD = skill('name: good\ndescription: "x"');
const BAD = skill('name: Bad\ndescription: "x"');

function makeRepo(files: Record<string, string>) {
  const root = makeTempDir("skill-frontmatter-");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const run = (cwd: string, args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });

test("引数なしは skills/*/SKILL.md と印のある private skill を見て、印の無いコピーは見ない", () => {
  const root = makeRepo({
    "skills/a/SKILL.md": BAD,
    "skills/README.md": "ディレクトリではないので見ない",
    "skills/no-skill/README.md": "SKILL.md が無い",
    ".agents/skills/priv/.private-skill": "",
    ".agents/skills/priv/SKILL.md": BAD,
    ".agents/skills/a/SKILL.md": BAD,
  });
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("skills/a/SKILL.md: name「Bad」");
  expect(r.stderr).toContain(".agents/skills/priv/SKILL.md: name「Bad」");
  expect(r.stderr).not.toContain(".agents/skills/a/SKILL.md");
});

test("引数なしで違反が無ければ OK を出して exit 0", () => {
  const root = makeRepo({
    "skills/a/SKILL.md": GOOD,
    ".agents/skills/priv/.private-skill": "",
    ".agents/skills/priv/SKILL.md": GOOD,
  });
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("skill-frontmatter: OK");
});

test("skills/ も .agents/skills/ も無いリポジトリは対象 0 件で exit 0", () => {
  const r = run(makeRepo({ "README.md": "x" }));
  expect(r.status).toBe(0);
});

test("引数ありは SKILL.md だけを見て、それ以外のファイルは違反があっても見ない", () => {
  const root = makeRepo({ "skills/a/SKILL.md": BAD, "docs/x.md": BAD, "skills/b/SKILL.md": GOOD });
  const bad = run(root, ["docs/x.md", "skills/a/SKILL.md"]);
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain("skills/a/SKILL.md");
  expect(bad.stderr).not.toContain("docs/x.md");
  const good = run(root, ["docs/x.md", "skills/b/SKILL.md"]);
  expect(good.status).toBe(0);
});
