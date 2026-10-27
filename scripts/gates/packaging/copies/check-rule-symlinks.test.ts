// rule を各エージェントに読ませる symlink（.agents/rules → .claude/rules / .github/instructions）のチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                   | 値                                                              |
// | -------------------- | --------------------------------------------------------------- |
// | 原本ディレクトリ       | 存在（N 件） / 存在（0 件） / 不在                                         |
// | symlink のディレクトリ | 存在 / 不在                                                                |
// | symlink のエントリ     | 正しい symlink / 欠落 / 実ファイル / 誤った指し先 / リンク先の無い symlink |
// | 逆向き（symlink→原本） | 対応あり / 孤児 / 命名規則外                                               |
// | symlink を置く先       | .claude/rules / .github/instructions（両方が独立に評価される）             |
//
// 誤検知しないことの確認（通さねばならない入力）＝ 正しく symlink を張った rule 群が violations 0 件になること。
// 実リポジトリ自身も、誤検知しないことの確認として 1 件置く。合成した fixture だけだと、
// 実際の symlink の形とチェックが期待する形がずれていても、成功のまま通る。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANON_DIR,
  DOC_INSTRUCTIONS,
  REVIEW_READ_LIMIT,
  WIRINGS,
  checkRuleSymlinks,
} from "./check-rule-symlinks.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "scripts/gates/packaging/copies/check-rule-symlinks.ts");

/**
 * 正しく symlink を張った rule を持つ一時リポジトリを作る。
 * DOC_INSTRUCTIONS の文書とそのリンクは、`wire` に関わらず正しく置く（rule のリンクの検査を独立に測るため）。
 */
function makeRepo(names = ["alpha", "beta"], { wire = true } = {}) {
  const root = makeTempDir("rule-symlinks-");
  mkdirSync(join(root, CANON_DIR), { recursive: true });
  for (const { dir } of WIRINGS) mkdirSync(join(root, dir), { recursive: true });
  for (const doc of DOC_INSTRUCTIONS) {
    mkdirSync(join(root, dirname(doc.canon)), { recursive: true });
    writeFileSync(join(root, doc.canon), docText(doc.name, doc.reviewedUntil));
    for (const { dir, suffix, docs } of WIRINGS) {
      if (docs) symlinkSync(`../../${doc.canon}`, join(root, dir, `${doc.name}${suffix}`));
    }
  }
  for (const name of names) {
    writeFileSync(
      join(root, CANON_DIR, `${name}.md`),
      `---\npaths:\n  - "x/**"\n---\n\n# ${name}\n`,
    );
    if (!wire) continue;
    for (const { dir, suffix } of WIRINGS) {
      symlinkSync(relTarget(dir, name), join(root, dir, `${name}${suffix}`));
    }
  }
  return root;
}

/** Copilot のレビューに読まれる形の文書（applyTo を持ち、reviewedUntil の見出しが先頭の近くにある）。 */
function docText(name: string, reviewedUntil: string, { applyTo = true, filler = 0 } = {}) {
  const fm = applyTo ? `---\napplyTo: "**/*.md"\n---\n\n` : "";
  return `${fm}# ${name}\n\n${"あ".repeat(filler)}\n\n${reviewedUntil}\n\n後半。\n`;
}

// symlink のディレクトリ（2 階層）から見た、原本への相対パス。
const relTarget = (dir: string, name: string) => `../../${CANON_DIR}/${name}.md`;

const cleanup = (root: string) => rmSync(root, { recursive: true, force: true });

test("誤検知しないことの確認: 正しくリンクを張った rule は違反 0 件・走査件数が原本の件数と一致", () => {
  const root = makeRepo(["alpha", "beta", "gamma"]);
  const { rules, violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([]);
  expect(rules).toHaveLength(3);
  cleanup(root);
});

test("誤検知しないことの確認: 実リポジトリのリンクが違反 0 件", () => {
  const { rules, violations } = checkRuleSymlinks(repoRoot);
  expect(violations).toEqual([]);
  expect(rules.length).toBeGreaterThan(0);
});

test("欠落: エージェント用の symlink を作っていない rule を両エージェントぶん検出する", () => {
  const root = makeRepo(["alpha"], { wire: false });
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(2);
  expect(violations.some((v) => v.startsWith(".claude/rules/alpha.md: 欠落"))).toBe(true);
  expect(
    violations.some((v) => v.startsWith(".github/instructions/alpha.instructions.md: 欠落")),
  ).toBe(true);
  cleanup(root);
});

test("実ファイル: symlink ではなく実体のコピーを置いたら検出する", () => {
  const root = makeRepo(["alpha"], { wire: false });
  writeFileSync(join(root, ".claude/rules/alpha.md"), "# コピー\n");
  symlinkSync(
    relTarget(".github/instructions", "alpha"),
    join(root, ".github/instructions/alpha.instructions.md"),
  );
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^\.claude\/rules\/alpha\.md: symlink ではない/);
  cleanup(root);
});

test("誤った指し先: 別の rule を指す symlink を検出する", () => {
  const root = makeRepo(["alpha", "beta"]);
  rmSync(join(root, ".claude/rules/alpha.md"));
  symlinkSync(relTarget(".claude/rules", "beta"), join(root, ".claude/rules/alpha.md"));
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^\.claude\/rules\/alpha\.md: 指し先が違う/);
  cleanup(root);
});

test("指し先の無い symlink: 指し先の原本が消えていたら検出する（欠落として現れる）", () => {
  const root = makeRepo(["alpha"]);
  // 原本を消すと、symlink は「対応する原本が無い孤児」になる（期待する集合は、宣言＝原本から作るため）。
  rmSync(join(root, CANON_DIR, "alpha.md"));
  const { rules, violations } = checkRuleSymlinks(root);
  expect(rules).toEqual([]);
  expect(violations.some((v) => v.includes("孤児"))).toBe(true);
  cleanup(root);
});

test("孤児: 原本の無いエージェント用の symlink を検出する", () => {
  const root = makeRepo(["alpha"]);
  symlinkSync(relTarget(".claude/rules", "ghost"), join(root, ".claude/rules/ghost.md"));
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([
    `.claude/rules/ghost.md: 対応する原本 ${CANON_DIR}/ghost.md が無い（孤児）`,
  ]);
  cleanup(root);
});

test("命名規則外: suffix に合わない名前を検出する", () => {
  const root = makeRepo(["alpha"]);
  writeFileSync(join(root, ".github/instructions/README.txt"), "x\n");
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([
    ".github/instructions/README.txt: 命名規則（<name>.instructions.md）に合わない",
  ]);
  cleanup(root);
});

test("リンクのディレクトリが不在なら、走査を飛ばさず違反として報告する", () => {
  const root = makeRepo(["alpha"]);
  rmSync(join(root, ".claude/rules"), { recursive: true });
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/リンクのディレクトリが無い（Claude Code/);
  cleanup(root);
});

test("原本のディレクトリが不在なら違反として報告し、走査件数は 0 件", () => {
  const root = makeTempDir("rule-symlinks-");
  const { rules, violations } = checkRuleSymlinks(root);
  expect(rules).toEqual([]);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/原本のディレクトリが無い/);
  cleanup(root);
});

test("CLI: 対象 0 件は成功として扱わず exit 1", () => {
  const root = makeTempDir("rule-symlinks-");
  mkdirSync(join(root, CANON_DIR), { recursive: true });
  for (const { dir } of WIRINGS) mkdirSync(join(root, dir), { recursive: true });
  const r = spawnSync(process.execPath, [script, root], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/走査した rule が 0 件/);
  cleanup(root);
});

test("CLI: 違反があれば exit 1、無ければ exit 0 で走査件数を出す", () => {
  const ok = makeRepo(["alpha", "beta"]);
  const good = spawnSync(process.execPath, [script, ok], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(good.status).toBe(0);
  expect(good.stdout).toMatch(/rule-symlinks: OK（2 件）/);
  expect(good.stdout).toContain(join(ok, CANON_DIR, "alpha.md"));
  cleanup(ok);

  const bad = makeRepo(["alpha"], { wire: false });
  const r = spawnSync(process.execPath, [script, bad], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/2 件のリンクの不備/);
  cleanup(bad);
});

// --- rule ではない文書を instructions として読ませる宣言（DOC_INSTRUCTIONS） ---

const DOC = { name: "style", canon: "docs/style.md", reason: "テスト用", reviewedUntil: "## 後半" };

function makeDocRepo({
  link = true,
  file = true,
  text = docText("style", DOC.reviewedUntil),
} = {}) {
  const root = makeRepo(["alpha"]);
  mkdirSync(join(root, "docs"), { recursive: true });
  if (file) writeFileSync(join(root, DOC.canon), text);
  if (link) {
    symlinkSync("../../docs/style.md", join(root, ".github/instructions/style.instructions.md"));
  }
  return root;
}

test("誤検知しないことの確認: 宣言した文書への instructions の symlink は孤児にしない", () => {
  const root = makeDocRepo();
  expect(checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]).violations).toEqual([]);
  cleanup(root);
});

test("孤児: 宣言していない文書への instructions の symlink は検出する", () => {
  const root = makeDocRepo();
  expect(checkRuleSymlinks(root, DOC_INSTRUCTIONS).violations).toEqual([
    `.github/instructions/style.instructions.md: 対応する原本 ${CANON_DIR}/style.md が無い（孤児）`,
  ]);
  cleanup(root);
});

test("欠落: 宣言した文書の instructions の symlink が無ければ検出する（Claude Code の側には求めない）", () => {
  const root = makeDocRepo({ link: false });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^\.github\/instructions\/style\.instructions\.md: 欠落/);
  expect(violations[0]).toContain("../../docs/style.md");
  cleanup(root);
});

test("宣言した文書が無ければ検出する", () => {
  const root = makeDocRepo({ file: false });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations).toContain("docs/style.md: instructions として宣言した文書が無い");
  cleanup(root);
});

test("宣言した文書の名前が rule と重なれば検出する", () => {
  const root = makeDocRepo();
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, { ...DOC, name: "alpha" }]);
  expect(violations).toContain(`docs/style.md: rule の ${CANON_DIR}/alpha.md と名前が重なる`);
  cleanup(root);
});

test("宣言した文書の frontmatter に applyTo が無ければ検出する", () => {
  const root = makeDocRepo({ text: docText("style", DOC.reviewedUntil, { applyTo: false }) });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations.some((v) => v.startsWith("docs/style.md: frontmatter に applyTo が無い"))).toBe(
    true,
  );
  cleanup(root);
});

test("宣言した文書の frontmatter の YAML が読めなければ、例外にせず違反として検出する", () => {
  const root = makeDocRepo({ text: `---\napplyTo: [\n---\n\n# style\n\n## 後半\n` });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations.filter((v) => v.includes("frontmatter の YAML を読めない"))).toHaveLength(1);
  cleanup(root);
});

test("CRLF で保存した文書でも、reviewedUntil の見出しを見つける", () => {
  const root = makeDocRepo({ text: docText("style", DOC.reviewedUntil).replaceAll("\n", "\r\n") });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations.filter((v) => v.startsWith("docs/style.md"))).toEqual([]);
  cleanup(root);
});

test("CRLF で保存した文書は、行末の \\r も文字数に数える", () => {
  // LF なら上限ちょうどになる本文を CRLF にすると、行の数だけ上限を超える。
  const head = docText("style", DOC.reviewedUntil, { filler: 0 }).split(DOC.reviewedUntil)[0];
  const filler = REVIEW_READ_LIMIT - Array.from(head).length;
  const text = docText("style", DOC.reviewedUntil, { filler }).replaceAll("\n", "\r\n");
  const root = makeDocRepo({ text });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations.filter((v) => v.includes("Copilot のレビューは先頭"))).toHaveLength(1);
  cleanup(root);
});

test("コードブロックの中の reviewedUntil と同じ行は、見出しとして扱わない", () => {
  const fm = `---\napplyTo: "**/*.md"\n---\n\n`;
  const text = `${fm}# style\n\n\`\`\`text\n${DOC.reviewedUntil}\n\`\`\`\n\n${"あ".repeat(REVIEW_READ_LIMIT)}\n\n${DOC.reviewedUntil}\n`;
  const root = makeDocRepo({ text });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations.filter((v) => v.includes("Copilot のレビューは先頭"))).toHaveLength(1);
  cleanup(root);
});

test("宣言した文書に reviewedUntil の見出しが無ければ検出する", () => {
  const root = makeDocRepo({ text: docText("style", "## 別の見出し") });
  const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
  expect(violations.some((v) => v.startsWith("docs/style.md: 見出し「## 後半」が無い"))).toBe(true);
  cleanup(root);
});

test.each([
  ["上限ちょうど", REVIEW_READ_LIMIT, []],
  ["上限を 1 文字超える", REVIEW_READ_LIMIT + 1, ["超える"]],
])(
  "reviewedUntil の見出しより前の文字数が%sなら、それに応じて報告する",
  (_name, total, expected) => {
    // 見出しより前の文字数が total になるように、本文の「あ」の数を決める（符号位置で数える）。
    const head = docText("style", DOC.reviewedUntil, { filler: 0 }).split(DOC.reviewedUntil)[0];
    const filler = total - Array.from(head).length;
    const root = makeDocRepo({ text: docText("style", DOC.reviewedUntil, { filler }) });
    // 文字数の指摘だけを見る（リンクの検査の変異で増える指摘と区別する）。
    const { violations } = checkRuleSymlinks(root, [...DOC_INSTRUCTIONS, DOC]);
    const length = violations.filter((v) => v.includes("Copilot のレビューは先頭"));
    if (expected.length === 0) expect(length).toEqual([]);
    else
      expect(length).toEqual([
        `docs/style.md: 「## 後半」より前が ${total} 文字ある。Copilot のレビューは先頭の ${REVIEW_READ_LIMIT} 文字しか読まない`,
      ]);
    cleanup(root);
  },
);
