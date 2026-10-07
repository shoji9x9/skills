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
//   （JavaScript・TypeScript・シェル・YAML。拡張子は `scripts/lib/code-comments.js` で定義する）。
//   コメントは、取り出した文章を Markdown にして見る。
// - 文字列（JavaScript・TypeScript の文字列リテラルと、`evals/<name>/evals.json` の prompt・expected_output・assertions）には、
//   使わない語の規則（`ai-words-ja/no-ai-words`）だけを当てる。取り出し方は `scripts/lib/code-strings.js` で定義する。
//   テスト名・メッセージ・eval の文字列を手本にすると旧称が広がるので見る（#567）。文章の書式の規則は当てない。
//   次のものは除く。
//   - エージェント用のコピーとリンク（判定は `scripts/lib/source-scope.js`）。rule（`.agents/rules/`）と
//     private skill（`skills/` に無い `.agents/skills/<name>/`）は実体なので見る。
//   - 過去の記録（`.kaizen/archive/`）とテスト結果（`tests/`）。有効な学び（`.kaizen/*.md`）は見る。
//   - シンボリックリンク（`.github/instructions/` など。リンク先を見れば足りる）。
// - 引数でファイルを渡したときは、そのうち対象に当たるものだけを見る（lefthook の staged_files）。
// - 書き換えがまだ済んでいないファイルは `scripts/gates/prose-lint-pending.json` に列挙し、指摘を数えない。
//   ただし列挙したファイルが指摘 0 件になったら、一覧から外すよう求めて失敗する（一覧が古いまま残らないように）。
//   列挙したファイルが無いときも失敗する。
// - 一覧が読めない・対象が 0 件（全体を見る実行時）は exit 2、指摘や古い一覧は exit 1。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLinter, loadTextlintrc } from "textlint";
import { commentMarkdown, hasComments } from "../lib/code-comments.js";
import { hasStrings, stringMarkdown } from "../lib/code-strings.js";
import { isAgentCopy } from "../lib/source-scope.js";

export const PENDING_PATH = "scripts/gates/prose-lint-pending.json";
/** コメントを取り出せなかったファイルの指摘に付ける ruleId。 */
const PARSE_RULE = "code-comments";
/** 文字列に当てる規則（使わない語の一覧）。 */
const WORD_RULE = "ai-words-ja/no-ai-words";
const EXCLUDED_PREFIXES = [".kaizen/archive/", "tests/", "node_modules/"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 一覧を読み、形の誤りは例外にする（読めない一覧を「保留 0 件」として扱わない）。 */
export function loadPending(root) {
  const path = join(root, PENDING_PATH);
  if (!existsSync(path)) throw new Error(`${PENDING_PATH} が無い`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (typeof data?.reason !== "string" || !data.reason.trim()) {
    throw new Error("reason が無い（なぜ保留しているかを書く）");
  }
  const files = data.files;
  if (!Array.isArray(files) || !files.every((f) => typeof f === "string" && f)) {
    throw new Error("files は空でない文字列の配列にする");
  }
  const set = new Set(files);
  if (set.size !== files.length) throw new Error("files に同じパスが重複している");
  return set;
}

/** リポジトリ相対パスが対象か。 */
export function isTarget(root, rel) {
  if (!rel.endsWith(".md") && !hasComments(rel) && !hasStrings(rel)) return false;
  if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isAgentCopy(root, rel)) return false;
  const abs = join(root, rel);
  if (!existsSync(abs)) return false;
  return !lstatSync(abs).isSymbolicLink();
}

/** 全体を見るときの対象（git が管理する、または ignore されていない未追跡のファイルのうち、isTarget に当たるもの）。 */
export function listTargets(root) {
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
async function lintExtracted(linter, root, rel, kind) {
  const abs = join(root, rel);
  const toMarkdown = kind === "strings" ? stringMarkdown : commentMarkdown;
  let parsed;
  try {
    parsed = toMarkdown(rel, readFileSync(abs, "utf8"));
  } catch (error) {
    // ツールが無いのはファイルの問題ではないので、実行そのものを止める（exit 2）。
    if (error.missingTool) throw error;
    // コメントや文字列を取り出せないファイルは、指摘として報告する（0 件として通さない）。
    return [{ line: 1, column: 1, message: error.message, ruleId: PARSE_RULE }];
  }
  const { markdown, lines, columns, starts } = parsed;
  if (!markdown) return [];
  const result = await linter.lintText(markdown, `${abs}.md`);
  const messages =
    kind === "strings" ? result.messages.filter((m) => m.ruleId === WORD_RULE) : result.messages;
  return messages.map((m) => ({
    ...m,
    line: lines[m.line - 1] + 1,
    column: Math.max(starts[m.line - 1], columns[m.line - 1] + m.column),
    // sentence-length は Markdown の行番号を本文に書くので、元のファイルの行と食い違う。番号を外す。
    message: kind === "strings" ? `（文字列）${m.message}` : m.message.replace(/^Line \d+ /, ""),
  }));
}

/**
 * @param {{ root: string, files?: string[], configRoot?: string }} options
 *   files を省くと全体を見る。configRoot は `.textlintrc.json` と node_modules の場所（テストでは実リポジトリ）。
 */
export async function lintProse({ root, files, configRoot = REPO_ROOT }) {
  const pending = loadPending(root);
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
  const linter = createLinter({ descriptor, cwd: root });
  const docs = targets.filter((t) => t.endsWith(".md"));
  const results = docs.length ? await linter.lintFiles(docs.map((t) => join(root, t))) : [];
  const byPath = new Map(
    results.map((r) => [relative(root, r.filePath).split(sep).join("/"), r.messages]),
  );
  for (const rel of targets.filter((t) => !t.endsWith(".md"))) {
    const comments = hasComments(rel) ? await lintExtracted(linter, root, rel, "comments") : [];
    const strings = hasStrings(rel) ? await lintExtracted(linter, root, rel, "strings") : [];
    byPath.set(
      rel,
      [...comments, ...strings].sort((a, b) => a.line - b.line || a.column - b.column),
    );
  }

  const violations = [];
  const stale = [];
  for (const rel of targets) {
    // 結果が無いファイルを「指摘 0 件」として扱わない（保留の判定が逆転する）。
    const messages = byPath.get(rel);
    if (!messages) throw new Error(`${rel} の textlint の結果が無い`);
    if (pending.has(rel)) {
      if (messages.length === 0)
        stale.push(`${rel}: 指摘が 0 件になった。${PENDING_PATH} から外す`);
      // コメントを取り出せないことは、書き換えの保留と関係が無いので、保留したファイルでも報告する。
      for (const m of messages.filter((m) => m.ruleId === PARSE_RULE))
        violations.push(`${rel}:${m.line}:${m.column} ${m.message} (${m.ruleId})`);
      continue;
    }
    for (const m of messages)
      violations.push(`${rel}:${m.line}:${m.column} ${m.message} (${m.ruleId})`);
  }
  if (whole) {
    for (const rel of pending) {
      if (!existsSync(join(root, rel)))
        stale.push(`${rel}: ファイルが無い。${PENDING_PATH} から外す`);
    }
  }
  return {
    checked: targets.length,
    pending: targets.filter((t) => pending.has(t)).length,
    violations,
    stale,
  };
}

export async function main(argv) {
  const files = argv.filter((a) => a !== "--");
  let result;
  try {
    result = await lintProse({ root: process.cwd(), files: files.length ? files : undefined });
  } catch (error) {
    // ツールが無いときは、保留の一覧の問題と読めないように、一覧のパスを添えない。
    const where = error.missingTool ? "" : `（${resolve(PENDING_PATH)}）`;
    console.error(`lint-prose: 実行できない${where}: ${error.message}`);
    return 2;
  }
  const { checked, pending, violations, stale } = result;
  for (const v of violations) console.error(v);
  for (const s of stale) console.error(s);
  if (violations.length || stale.length) {
    console.error(
      `lint-prose: ${checked} 件（うち保留 ${pending} 件）を見て、指摘 ${violations.length} 件・古い保留 ${stale.length} 件。` +
        "語の言い換え先は .textlint/words.json の message を見る。文章の書き方は docs/writing-style.md に従う。",
    );
    return 1;
  }
  console.log(`lint-prose: OK（${checked} 件、うち保留 ${pending} 件）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`lint-prose: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(await main(process.argv.slice(2)));
