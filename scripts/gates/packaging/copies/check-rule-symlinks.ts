#!/usr/bin/env node
// rule を各エージェントに読ませる symlink（3 点）を、決定論的にチェックする（lefthook pre-commit + CI）。
//
// 原本は `.agents/rules/<name>.md`。Claude Code は `.claude/rules/<name>.md`、
// GitHub Copilot は `.github/instructions/<name>.instructions.md` の symlink を通して、同じ実体を読む。
// symlink を作り忘れると、「ドキュメント上は適用されるのに、2 エージェントでは適用されない」状態になる。
// これは成功した作業と見分けが付かない（実例: eval-run-scope.md。レビューで指摘されるまで気付かなかった）。
//
// 期待する集合は、観測ではなく宣言から作る。`.agents/rules/*.md` の実在が原本で、symlink の側はその反映である。
// 逆向き（原本の無い孤児の symlink）も、同じ表から検出する。
// 対象 0 件は成功として扱わず、fail にする（走査できていないことと、違反が無いことを区別する）。
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fencedLines } from "../../../lib/doc-scan.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { splitFrontmatter } from "../../../lib/text/frontmatter.ts";
import { loadYamlAs } from "../../../lib/text/yaml-as.ts";

export const CANON_DIR = ".agents/rules";

// symlink を置く先の宣言。`suffix` は原本のベース名（拡張子なし）に付く。
// `docs` が true の置き先には、rule に加えて DOC_INSTRUCTIONS の文書へのリンクも置く。
export const WIRINGS = [
  { dir: ".claude/rules", suffix: ".md", agent: "Claude Code", docs: false },
  { dir: ".github/instructions", suffix: ".instructions.md", agent: "GitHub Copilot", docs: true },
];

// rule ではない文書を、Copilot のレビューにだけ instructions として読ませる宣言。
// 作業によらず常に要る規約は rule にせず、AGENTS.md から `@` で取り込む（Claude Code）。
// Copilot は `@` の取り込みもリンク先も読まないので、`.github/instructions/` にその文書への symlink を置く。
// 宣言に無い名前は、これまでどおり孤児として検出する。
//
// symlink だけでは Copilot は読まない。文書の frontmatter の applyTo が PR の変更ファイルに当たるときだけ読むので、
// applyTo を持つことも確かめる。applyTo の範囲は文書ごとに決める。
// writing-style の規則と、このリポジトリでの対象（writing-style-scope）は人が読む文章すべてに当てるので、applyTo はすべてのファイルにする。
// lint-prose の対象をすべて含むことは、writing-style-apply-to.test.ts が確かめる。
// `**` と `*` がドットで始まる名前に当たらない glob の実装もあるので、`**/.*/**` と `**/.*` の形も並べる。
// Copilot のコードレビューは instructions の先頭 4,000 文字しか読まない
// （https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review）。
// そのため、レビューで確かめる節を文書の前に置き、その後に続く最初の見出し（reviewedUntil）が 4,000 文字の内側にあることを確かめる。
export type DocInstruction = { name: string; canon: string; reason: string; reviewedUntil: string };
export const DOC_INSTRUCTIONS: DocInstruction[] = [
  {
    name: "writing-style",
    canon: "skills/writing-style/references/rules.md",
    reason: "文章の規約は人への応答にも当てるので常に要り、rule にしない",
    reviewedUntil: "## 書き換えで変えないもの",
  },
  {
    name: "writing-style-scope",
    canon: "docs/writing-style.md",
    reason:
      "規則を当てる対象と対象外はこのリポジトリだけの拡張なので、配布する規則の文書とは別に読ませる",
    reviewedUntil: "## 規則と読み直しの手順",
  },
];

/** Copilot のコードレビューが instructions から読む文字数の上限。 */
export const REVIEW_READ_LIMIT = 4000;

/** 宣言した文書が、Copilot のレビューに読まれる形（applyTo を持ち、レビューで確かめる節が上限の内側）かを確かめる。 */
function checkDocShape(root: string, doc: DocInstruction): string[] {
  // 文書が無いことは呼び出し側が報告するので、ここでは読めなければ何も足さない。
  if (!existsSync(join(root, doc.canon))) return [];
  const text = readFileSync(join(root, doc.canon), "utf8");
  const out: string[] = [];
  const split = splitFrontmatter(text);
  let fm: { applyTo?: unknown } | null = null;
  try {
    fm = split ? loadYamlAs<{ applyTo?: unknown }>(split.fm) : null;
  } catch (error) {
    // 他の不備と一緒に報告できるように、読めない frontmatter も違反として返す。
    out.push(`${doc.canon}: frontmatter の YAML を読めない: ${errorMessage(error)}`);
    return out;
  }
  if (typeof fm?.applyTo !== "string" || fm.applyTo.trim() === "") {
    out.push(
      `${doc.canon}: frontmatter に applyTo が無い（Copilot のレビューが PR のファイルに当てない）`,
    );
  }
  // 行末（\n か \r\n）を残したまま行に分け、比べるときだけ \r を外す。CRLF の文書でも、見出しを見つけて文字数を正しく数える。
  // コードブロックの中の同じ行は見出しではないので、フェンスの中の行は比べない。
  const lines = text.split(/(?<=\n)/);
  const fenced = fencedLines(lines.map((line) => line.replace(/\r?\n$/, "")));
  const at = lines.findIndex(
    (line, i) => !fenced[i] && line.replace(/\r?\n$/, "") === doc.reviewedUntil,
  );
  if (at < 0) {
    out.push(
      `${doc.canon}: 見出し「${doc.reviewedUntil}」が無い（Copilot が読む範囲を確かめられない）`,
    );
  } else {
    // 文字数は、Copilot の数え方に近い符号位置の数で数える。行末の \r も 1 文字に数える。
    const before = Array.from(lines.slice(0, at).join("")).length;
    if (before > REVIEW_READ_LIMIT) {
      out.push(
        `${doc.canon}: 「${doc.reviewedUntil}」より前が ${before} 文字ある。` +
          `Copilot のレビューは先頭の ${REVIEW_READ_LIMIT} 文字しか読まない`,
      );
    }
  }
  return out;
}

const canonBase = (file: string) => file.replace(/\.md$/, "");

// symlink の名前 → 原本のベース名。対応しない名前は null（孤児判定に使う）。
const baseFromWiring = (name: string, suffix: string) =>
  name.endsWith(suffix) ? name.slice(0, -suffix.length) : null;

/** リンクを置く 1 か所（WIRINGS の 1 要素）。 */
type Wiring = (typeof WIRINGS)[number];

/** 1 本のリンクを検査するときに使う値。base はリンクの名前、canonPath は原本の絶対パス。 */
type LinkSpec = { wiring: Wiring; wiringDir: string; base: string; canonPath: string };

/**
 * 原本 → symlink の向きで 1 本を確かめる（欠落・実ファイル・誤った指し先・リンク先の無い symlink）。
 * @returns 違反の文。問題が無ければ undefined
 */
function linkViolation({ wiring, wiringDir, base, canonPath }: LinkSpec): string | undefined {
  const { dir, suffix, agent } = wiring;
  const linkPath = join(wiringDir, `${base}${suffix}`);
  const expected = relative(wiringDir, canonPath);
  if (!lstatSafe(linkPath)) {
    return `${dir}/${base}${suffix}: 欠落（${agent} で自動適用されない）。期待する指し先: ${expected}`;
  }
  if (!lstatSync(linkPath).isSymbolicLink()) {
    return `${dir}/${base}${suffix}: symlink ではない（実体のコピーは原本と drift する）`;
  }
  const actual = readlinkSync(linkPath);
  if (actual !== expected) {
    return `${dir}/${base}${suffix}: 指し先が違う（実際: ${actual} / 期待: ${expected}）`;
  }
  if (!existsSync(linkPath)) return `${dir}/${base}${suffix}: symlink の指し先が存在しない`;
  if (realpathSync(linkPath) !== realpathSync(canonPath)) {
    return `${dir}/${base}${suffix}: 解決先が原本と一致しない`;
  }
  return undefined;
}

/** symlink → 原本の向きで、命名規則に合わないリンクと孤児のリンクを挙げる。 */
function orphanViolations(wiring: Wiring, wiringDir: string, targets: Map<string, string>) {
  const { dir, suffix } = wiring;
  const out: string[] = [];
  for (const name of readdirSync(wiringDir)) {
    const base = baseFromWiring(name, suffix);
    if (base === null) {
      out.push(`${dir}/${name}: 命名規則（<name>${suffix}）に合わない`);
      continue;
    }
    if (!targets.has(base)) {
      out.push(`${dir}/${name}: 対応する原本 ${CANON_DIR}/${base}.md が無い（孤児）`);
    }
  }
  return out;
}

/** 1 か所のリンクの置き先について、原本との対応を両方向で確かめる。 */
function wiringViolations(
  root: string,
  wiring: Wiring,
  {
    bases,
    docInstructions,
    canonDir,
  }: { bases: string[]; docInstructions: DocInstruction[]; canonDir: string },
): string[] {
  const { dir, agent, docs } = wiring;
  const wiringDir = join(root, dir);
  if (!existsSync(wiringDir)) {
    return [`${resolve(wiringDir)}: リンクのディレクトリが無い（${agent} は rule を読めない）`];
  }

  // この置き先に置くリンク: 名前 → 原本の絶対パス
  const targets = new Map(bases.map((b) => [b, join(canonDir, `${b}.md`)]));
  if (docs) for (const doc of docInstructions) targets.set(doc.name, join(root, doc.canon));

  const out: string[] = [];
  for (const [base, canonPath] of targets) {
    const violation = linkViolation({ wiring, wiringDir, base, canonPath });
    if (violation !== undefined) out.push(violation);
  }
  out.push(...orphanViolations(wiring, wiringDir, targets));
  return out;
}

/** instructions として読ませる文書の宣言を、名前の重なり・実在・形について確かめる。 */
function docDeclarationViolations(
  root: string,
  bases: string[],
  docInstructions: DocInstruction[],
): string[] {
  const out: string[] = [];
  for (const doc of docInstructions) {
    if (bases.includes(doc.name)) {
      out.push(`${doc.canon}: rule の ${CANON_DIR}/${doc.name}.md と名前が重なる`);
    }
    if (!existsSync(join(root, doc.canon))) {
      out.push(`${doc.canon}: instructions として宣言した文書が無い`);
    }
    out.push(...checkDocShape(root, doc));
  }
  return out;
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @param docInstructions rule ではない文書を instructions として読ませる宣言（テストでは差し替える）
 * @returns {{ rules: string[], violations: string[] }} rules は走査した原本の絶対パス
 */
export function checkRuleSymlinks(
  root: string,
  docInstructions: DocInstruction[] = DOC_INSTRUCTIONS,
) {
  const canonDir = join(root, CANON_DIR);

  if (!existsSync(canonDir)) {
    return { rules: [], violations: [`${resolve(canonDir)}: 原本のディレクトリが無い`] };
  }

  const bases = readdirSync(canonDir)
    .filter((f) => f.endsWith(".md"))
    .map(canonBase)
    .sort();
  const rules = bases.map((b) => resolve(join(canonDir, `${b}.md`)));

  const violations = docDeclarationViolations(root, bases, docInstructions);
  for (const wiring of WIRINGS) {
    violations.push(...wiringViolations(root, wiring, { bases, docInstructions, canonDir }));
  }

  return { rules, violations };
}

function lstatSafe(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// CLI エントリ判定は、両辺を実パスに揃える（片側だけを解決すると、symlink を通した起動で何もせずに終わる）。
// 正規化に失敗したら「起動されていない」として扱わず、理由を出して非 0 で落とす。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`rule-symlinks: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) {
  const root = process.argv[2] ?? process.cwd();
  const { rules, violations } = checkRuleSymlinks(root);

  if (rules.length === 0) {
    console.error(`rule-symlinks: 走査した rule が 0 件（${resolve(join(root, CANON_DIR))}）。`);
    console.error("Fix: 対象を取り違えていないか確認する。0 件は「違反なし」ではない。");
    process.exit(1);
  }

  if (violations.length) {
    console.error(
      `rule-symlinks: ${rules.length} 件の rule を走査し、${violations.length} 件のリンクの不備:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `Fix: 各 rule について ln -s ../../${CANON_DIR}/<name>.md .claude/rules/<name>.md と` +
        ` ln -s ../../${CANON_DIR}/<name>.md .github/instructions/<name>.instructions.md を作る。` +
        ` DOC_INSTRUCTIONS の文書は ln -s ../../<canon> .github/instructions/<name>.instructions.md を作る。` +
        ` 文書の applyTo と文字数の不備は、frontmatter に applyTo を書くか、reviewedUntil の見出しより前を ${REVIEW_READ_LIMIT} 文字以内に縮めて直す。`,
    );
    process.exit(1);
  }

  console.log(`rule-symlinks: OK（${rules.length} 件）`);
  for (const r of rules) console.log(`  ${r}`);
}
