#!/usr/bin/env node
// 人が読む文章（Markdown と、コードや設定ファイルのコメント）を textlint でチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: AI が書いた文章には、人が読むと違和感のある語（`正本`・`倒す` など）や書式
// （`- **見出し**:` の箇条書きなど）が繰り返し現れる。規約を文書に書くだけでは同じ書き方が戻るため、
// 機械的に判定できるものはコミット時に止める。何を止めるかの原本は `.textlintrc.json` と
// `.textlint/words.json`（言い換え先を各エントリの message に書く）。
//
// 判定規則:
// - 対象は git が管理する（または ignore されていない未追跡の）`*.md` と、コメントを持つファイル
//   （JavaScript・TypeScript・シェル・YAML。拡張子は `scripts/lib/text/code-comments.ts` で定義する）。
//   コメントは、取り出した文章を Markdown にして見る。
// - 文字列（JavaScript・TypeScript の文字列リテラルと、`evals/<name>/evals.json` の prompt・expected_output・assertions）には、
//   使わない語の規則だけを当てる。規則は `ai-words-ja/no-ai-words` と、`——` を探す `local/no-dash-emphasis` である。
//   取り出し方は `scripts/lib/text/code-strings.ts` で定義する。
//   テスト名・メッセージ・eval の文字列を手本にすると旧称が広がるので見る（#567）。文章の書式の規則は当てない。
//   次のものは除く。
//   - エージェント用のコピーとリンク（判定は `scripts/lib/source-scope.ts`）。rule（`.agents/rules/`）と
//     private skill（`skills/` に無い `.agents/skills/<name>/`）は実体なので見る。
//   - 過去の記録（`.kaizen/archive/`）とテスト結果（`tests/`）。有効な学び（`.kaizen/*.md`）は見る。
//   - シンボリックリンク（`.github/instructions/` など。リンク先を見れば足りる）。
// - 引数でファイルを渡したときは、そのうち対象に当たるものだけを見る（lefthook の staged_files）。
// - 設定や辞書を読めない・対象が 0 件（全体を見る実行時）は exit 2、指摘は exit 1。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLinter, loadTextlintrc } from "textlint";
import {
  commentMarkdown,
  hasComments,
  isMissingToolError,
  type CommentMarkdown,
} from "../../lib/text/code-comments.ts";
import { hasStrings, stringMarkdown } from "../../lib/text/code-strings.ts";
import { isAgentCopy, isVendored } from "../../lib/source-scope.ts";
import { errorMessage } from "../../lib/errors.ts";
import { WORD_RULE_IDS, withDashRule, wordRules } from "../../lib/text/textlint-word-rule.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";

/** コメントを取り出せなかったファイルの指摘に付ける ruleId。 */
const PARSE_RULE = "code-comments";
/** 文字列に当てる規則（使わない語の一覧）。 */
const EXCLUDED_PREFIXES = [".kaizen/archive/", "tests/", "node_modules/"];
/** 英語で書く文書の置き場所。規則は日本語の文章向けなので当てない（docs/writing-style.md「対象」）。 */
const ENGLISH_DOC_PREFIXES = ["docs/slides/storylines/en/", "docs/slides/prompts/"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** 指摘のうち、このスクリプトが読むフィールド。 */
type LintMessage = { line: number; column: number; message: string; ruleId: string };
type Linter = ReturnType<typeof createLinter>;

/** リポジトリ相対パスが対象か。 */
function isTarget(root: string, rel: string): boolean {
  if (!rel.endsWith(".md") && !hasComments(rel) && !hasStrings(rel)) return false;
  if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (ENGLISH_DOC_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isAgentCopy(root, rel)) return false;
  // 外部のパッケージから作った生成物（上流のコードとライセンスの文書）は、このリポジトリの文章の規約の対象ではない
  if (isVendored(rel)) return false;
  const abs = join(root, rel);
  if (!existsSync(abs)) return false;
  return !lstatSync(abs).isSymbolicLink();
}

/** 全体を見るときの対象（git が管理する、または ignore されていない未追跡のファイルのうち、isTarget に当たるもの）。 */
export function listTargets(root: string): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  );
  return [...new Set(out.split("\0").filter(Boolean))].filter((rel) => isTarget(root, rel)).sort();
}

/**
 * 取り出した文章（コメントか文字列）を Markdown にして textlint に渡し、指摘の位置を元のファイルの行と桁に戻す。
 * 拡張子 `.md` を足したパスを渡すのは、textlint が拡張子で Markdown として読むかを決めるためである。
 * 文字列には使わない語の規則だけを当て、指摘に「（文字列）」を付ける。
 */
async function lintExtracted(
  linter: Linter,
  { root, rel }: { root: string; rel: string },
  kind: "comments" | "strings",
): Promise<LintMessage[]> {
  const abs = join(root, rel);
  const toMarkdown = kind === "strings" ? stringMarkdown : commentMarkdown;
  let parsed: CommentMarkdown;
  try {
    parsed = toMarkdown(rel, readFileSync(abs, "utf8"));
  } catch (error) {
    // ツールが無いのはファイルの問題ではないので、実行そのものを止める（exit 2）。
    if (isMissingToolError(error)) throw error;
    // コメントや文字列を取り出せないファイルは、指摘として報告する（0 件として通さない）。
    return [{ line: 1, column: 1, message: errorMessage(error), ruleId: PARSE_RULE }];
  }
  const { markdown, lines, columns, starts } = parsed;
  if (!markdown) return [];
  const result = await linter.lintText(markdown, `${abs}.md`);
  const messages =
    kind === "strings"
      ? result.messages.filter((m) => WORD_RULE_IDS.includes(m.ruleId))
      : result.messages;
  return messages.map((m) => {
    const { line, column } = m.loc.start;
    return {
      ...m,
      line: lines[line - 1] + 1,
      column: Math.max(starts[line - 1], columns[line - 1] + column),
      // sentence-length は Markdown の行番号を本文に書くので、元のファイルの行と食い違う。番号を外す。
      message: kind === "strings" ? `（文字列）${m.message}` : m.message.replace(/^Line \d+ /, ""),
    };
  });
}

/** `.md` 以外のファイルのコメントと文字列を lint し、指摘を行と桁の順に並べて返す。 */
async function lintSource(linter: Linter, at: { root: string; rel: string }) {
  const { rel } = at;
  const comments = hasComments(rel) ? await lintExtracted(linter, at, "comments") : [];
  const strings = hasStrings(rel) ? await lintExtracted(linter, at, "strings") : [];
  return [...comments, ...strings].sort((a, b) => a.line - b.line || a.column - b.column);
}

/** ファイルごとの指摘を、報告する行にする。結果が無いファイルは「指摘 0 件」として扱わずに例外にする。 */
function formatViolations(targets: string[], byPath: Map<string, LintMessage[]>) {
  const violations: string[] = [];
  for (const rel of targets) {
    const messages = byPath.get(rel);
    if (!messages) throw new Error(`${rel} の textlint の結果が無い`);
    for (const m of messages)
      violations.push(`${rel}:${m.line}:${m.column} ${m.message} (${m.ruleId})`);
  }
  return violations;
}

/**
 * @param {{ root: string, files?: string[], configRoot?: string }} options
 *   files を省くと全体を見る。configRoot は `.textlintrc.json` と node_modules の場所（テストでは実リポジトリ）。
 */
export async function lintProse({
  root,
  files,
  configRoot = REPO_ROOT,
}: {
  root: string;
  files?: string[];
  configRoot?: string;
}): Promise<{ checked: number; violations: string[] }> {
  const whole = files === undefined;
  const targets = whole
    ? listTargets(root)
    : files
        .map((f) => relative(root, resolve(root, f)).split(sep).join("/"))
        .filter((rel) => isTarget(root, rel));
  if (whole && targets.length === 0) throw new Error("対象のファイルが 0 件");

  const descriptor = await loadTextlintrc({
    configFilePath: join(configRoot, ".textlintrc.json"),
    node_modulesDir: join(configRoot, "node_modules"),
  });
  // 規則の ID がずれると、文字列の指摘を WORD_RULE_IDS で絞った結果が 0 件になり、エラーにならずに通る。先に在ることを確かめる。
  wordRules(descriptor);
  // 辞書では検出しきれない `——` を、文字列で探す規則も当てる（理由は textlint-word-rule.ts）。
  const linter = createLinter({ descriptor: withDashRule(descriptor, configRoot), cwd: root });
  const docs = targets.filter((t) => t.endsWith(".md"));
  const results = docs.length ? await linter.lintFiles(docs.map((t) => join(root, t))) : [];
  const byPath = new Map<string, LintMessage[]>(
    results.map((r) => [relative(root, r.filePath).split(sep).join("/"), r.messages]),
  );
  for (const rel of targets.filter((t) => !t.endsWith(".md"))) {
    byPath.set(rel, await lintSource(linter, { root, rel }));
  }
  return { checked: targets.length, violations: formatViolations(targets, byPath) };
}

export async function main(argv: string[]): Promise<number> {
  const files = argv.filter((a) => a !== "--");
  let result: Awaited<ReturnType<typeof lintProse>>;
  try {
    result = await lintProse({ root: process.cwd(), files: files.length ? files : undefined });
  } catch (error) {
    console.error(`lint-prose: 実行できない: ${errorMessage(error)}`);
    return 2;
  }
  const { checked, violations } = result;
  for (const v of violations) console.error(v);
  if (violations.length) {
    console.error(
      `lint-prose: ${checked} 件を見て、指摘 ${violations.length} 件。` +
        "語の言い換え先は .textlint/words.json の message を見る。文章の書き方は skills/writing-style/references/rules.md に、このリポジトリでの対象と対象外は docs/writing-style.md に従う。",
    );
    return 1;
  }
  console.log(`lint-prose: OK（${checked} 件）`);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(await main(process.argv.slice(2)));
