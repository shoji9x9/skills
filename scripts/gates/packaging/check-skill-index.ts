#!/usr/bin/env node
// スキルの実体と、AGENTS.md・README.md のスキル一覧が対応しているか検査する（lefthook pre-commit + CI）。
//
// なぜ要るか: スキルを足す・消す・改名するたびに、AGENTS.md「参照スキルガイド」（エージェントが
// どのスキルを使うかを知る起点）と README.md のスキル表（利用者がインストールする起点）の両方を
// 手で直す必要がある。片方の直し忘れはどちらの検査にも現れず、実在しないスキルへの案内や、
// 使われないまま見えないスキルが残る。
//
// 期待する集合は、次の宣言（実体の在り処）から作る。
// - 配布スキル = `skills/<name>/`（SKILL.md を持つこと。持たないディレクトリは違反）。
// - private skill = `.agents/skills/<name>/.private-skill` を持ち、`skills/` に無いもの（配布しない）。
//   SKILL.md も持つこと。印だけで SKILL.md の無いディレクトリは違反にし、private skill として数えない
//   （数えると AGENTS.md の掲載が「実在するスキル」への案内として通ってしまう）。
// - AGENTS.md「## 参照スキルガイド」節の箇条 `- \`<name>\`:` の集合 = 配布スキル ∪ private skill。
// - README.md「## 利用可能なスキル」節の表の行 `| [<name>](./skills/<name>/) |` の集合 = 配布スキル
//   （private skill は `gh skill install` できないので載せない）。
// どちらの向き（未掲載・実在しないスキルの掲載）も落とす。節が無い・節の中の箇条や表の行が
// 決めた形で読めない・同じ名前の重複・表の表示名とリンク先の不一致は、判定不能として落とす
// （読めない行を警告なしに飛ばすと、そのスキルは「未掲載」とも「掲載済み」とも判定されない）。
//
// 配布スキル 0 件は、成功として扱わない。
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../../lib/errors.ts";

const AGENTS_SECTION = "## 参照スキルガイド";
const README_SECTION = "## 利用可能なスキル";

const BULLET_RE = /^- `([^`]+)`:/;
const ROW_RE = /^\|\s*\[([^\]]+)\]\(\.\/skills\/([^/)]+)\/\)\s*\|/;
const SEPARATOR_RE = /^\|[\s:|-]+\|$/;

/** `heading` から次の同階層以上の見出しまでの行（見出しの次の行から）。無ければ null。 */
type Line = { n: number; text: string };

function sectionLines(text: string, heading: string) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === heading);
  if (start === -1) return null;
  const out: Line[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2} /.test(lines[i])) break;
    out.push({ n: i + 1, text: lines[i] });
  }
  return out;
}

function listDirs(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 名前を集めながら重複を違反にする。 */
function collect(entries: { name: string; n: number }[], where: string, violations: string[]) {
  const names = new Set<string>();
  for (const { name, n } of entries) {
    if (names.has(name)) violations.push(`${where}:${n}: ${name} が重複して掲載されている`);
    names.add(name);
  }
  return names;
}

function parseAgents(root: string, violations: string[]) {
  const path = join(root, "AGENTS.md");
  if (!existsSync(path)) {
    violations.push("AGENTS.md が無い");
    return null;
  }
  const lines = sectionLines(readFileSync(path, "utf8"), AGENTS_SECTION);
  if (!lines) {
    violations.push(`AGENTS.md: 「${AGENTS_SECTION}」節が無い`);
    return null;
  }
  const entries: { name: string; n: number }[] = [];
  for (const { n, text } of lines) {
    if (!text.startsWith("- ")) continue; // 導入文・箇条の継続行（字下げ）
    const m = BULLET_RE.exec(text);
    if (m) entries.push({ name: m[1], n });
    else violations.push(`AGENTS.md:${n}: 箇条が \`- \`<name>\`:\` の形で読めない`);
  }
  return collect(entries, "AGENTS.md", violations);
}

function parseReadme(root: string, violations: string[]) {
  const path = join(root, "README.md");
  if (!existsSync(path)) {
    violations.push("README.md が無い");
    return null;
  }
  const lines = sectionLines(readFileSync(path, "utf8"), README_SECTION);
  if (!lines) {
    violations.push(`README.md: 「${README_SECTION}」節が無い`);
    return null;
  }
  const rows = lines.filter(({ text }) => text.startsWith("|"));
  const entries: { name: string; n: number }[] = [];
  // 1 行目は見出し行（| スキル | 説明 |）。区切り行も飛ばす。
  for (const { n, text } of rows.slice(1)) {
    if (SEPARATOR_RE.test(text.trim())) continue;
    const m = ROW_RE.exec(text);
    if (!m) {
      violations.push(`README.md:${n}: 表の行が \`| [<name>](./skills/<name>/) |\` の形で読めない`);
    } else if (m[1] !== m[2]) {
      violations.push(`README.md:${n}: 表示名 ${m[1]} とリンク先 ./skills/${m[2]}/ が一致しない`);
    } else {
      entries.push({ name: m[1], n });
    }
  }
  return collect(entries, "README.md", violations);
}

/** 実在するスキル。distributed は skills/ の配布スキル、priv は .private-skill を持つ private skill。 */
type SkillSets = { distributed: string[]; priv: string[] };

/** skills/ と .agents/skills/ からスキルを列挙する。SKILL.md の無いディレクトリは違反にする。 */
function listSkills(root: string, violations: string[]): SkillSets {
  const distributed = listDirs(join(root, "skills"));
  for (const name of distributed) {
    if (!existsSync(join(root, "skills", name, "SKILL.md"))) {
      violations.push(`skills/${name}/: SKILL.md が無い（スキルの実体として読めない）`);
    }
  }
  const marked = listDirs(join(root, ".agents/skills")).filter(
    (name) =>
      !distributed.includes(name) &&
      existsSync(join(root, ".agents/skills", name, ".private-skill")),
  );
  const priv: string[] = [];
  for (const name of marked) {
    if (existsSync(join(root, ".agents/skills", name, "SKILL.md"))) priv.push(name);
    else
      violations.push(
        `.agents/skills/${name}/: .private-skill はあるが SKILL.md が無い（スキルの実体として読めない）`,
      );
  }
  return { distributed, priv };
}

/** AGENTS.md の索引が、配布スキルと private skill をちょうど載せているかを確かめる。 */
function checkAgentsIndex(root: string, { distributed, priv }: SkillSets, violations: string[]) {
  const agents = parseAgents(root, violations);
  if (agents) {
    for (const name of [...distributed, ...priv]) {
      if (!agents.has(name)) {
        violations.push(`AGENTS.md「${AGENTS_SECTION}」: ${name} が未掲載`);
      }
    }
    for (const name of agents) {
      if (!distributed.includes(name) && !priv.includes(name)) {
        violations.push(
          `AGENTS.md「${AGENTS_SECTION}」: ${name} は実在しないスキル（skills/ にも private skill にも無い）`,
        );
      }
    }
  }
}

/** README.md の索引が、配布スキルだけをちょうど載せているかを確かめる。 */
function checkReadmeIndex(root: string, { distributed, priv }: SkillSets, violations: string[]) {
  const readme = parseReadme(root, violations);
  if (readme) {
    for (const name of distributed) {
      if (!readme.has(name)) violations.push(`README.md「${README_SECTION}」: ${name} が未掲載`);
    }
    for (const name of readme) {
      if (distributed.includes(name)) continue;
      violations.push(
        priv.includes(name)
          ? `README.md「${README_SECTION}」: ${name} は private skill（配布しないので載せない）`
          : `README.md「${README_SECTION}」: ${name} は実在しないスキル（skills/ に無い）`,
      );
    }
  }
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ distributed: string[], private: string[], violations: string[] }}
 */
export function checkSkillIndex(root: string) {
  const violations: string[] = [];
  const skills = listSkills(root, violations);
  checkAgentsIndex(root, skills, violations);
  checkReadmeIndex(root, skills, violations);
  return { distributed: skills.distributed, private: skills.priv, violations };
}

export function main(argv: string[]) {
  const root = argv.filter((a) => a !== "--")[0] ?? process.cwd();
  const { distributed, private: priv, violations } = checkSkillIndex(root);
  if (distributed.length === 0) {
    console.error(
      `skill-index: 配布スキルが 0 件（${resolve(root, "skills")}）。0 件は「違反なし」ではない。`,
    );
    return 1;
  }
  const scope = `配布 ${distributed.length} 件・private ${priv.length} 件`;
  if (violations.length) {
    console.error(`skill-index: ${scope}を突き合わせ、${violations.length} 件の不一致:`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `Fix: スキルを足す・消す・改名したら AGENTS.md「${AGENTS_SECTION}」と README.md「${README_SECTION}」を同じ変更で直す` +
        "（private skill は AGENTS.md にだけ載せる）。",
    );
    return 1;
  }
  console.log(`skill-index: OK（${scope}）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動でサイレント no-op になる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`skill-index: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
