#!/usr/bin/env node
// 使わない語の一覧（`.textlint/word-list.md`）が `.textlint/words.json` と一致しているかチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: textlint はファイルしか見ないので、エージェントが人へ返す応答には単語帳が届かない。
// AGENTS.md から一覧を `@` で取り込み（Claude Code はセッション開始時に読み込む）、応答にも同じ語を使わせる。
// words.json は形態素の条件を含めて大きいので、取り込むのは `term` と `instead` だけを表にした生成物にする。
// 一覧を手で書くと単語帳と食い違うため、ここで一致を確かめる。
//
// 判定規則:
// - `.textlint/word-list.md` の全文を、words.json から生成した内容と比べる。
//   `term` を持たないエントリ（同じ語の別の形を拾うためのエントリ）は一覧に出さない。
// - `term` と `instead` の片方だけを持つエントリ・`term` の重複・「|」を含むエントリ・一覧が 0 行は exit 2、
//   一覧のファイルが無い・内容の食い違いは exit 1。`--fix` を付けると生成した内容で書き換える。
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const WORDS_PATH = ".textlint/words.json";
export const LIST_PATH = ".textlint/word-list.md";

/** words.json から一覧のファイルの全文を作る。形の誤りは例外にする。 */
export function renderWordList(root) {
  const path = join(root, WORDS_PATH);
  if (!existsSync(path)) throw new Error(`${WORDS_PATH} が無い`);
  const entries = JSON.parse(readFileSync(path, "utf8"))?.entries;
  if (!Array.isArray(entries)) throw new Error("entries が配列でない");
  const rows = [];
  const seen = new Set();
  entries.forEach((e, i) => {
    const hasTerm = typeof e?.term === "string" && e.term.trim() !== "";
    const hasInstead = typeof e?.instead === "string" && e.instead.trim() !== "";
    if (hasTerm !== hasInstead)
      throw new Error(`entries[${i}] は term と instead を両方持つか、両方持たない`);
    if (!hasTerm) return;
    if (seen.has(e.term)) throw new Error(`term「${e.term}」が重複している`);
    if (`${e.term}${e.instead}`.includes("|"))
      throw new Error(`entries[${i}] に「|」がある（表が崩れる）`);
    seen.add(e.term);
    rows.push(`| ${e.term} | ${e.instead} |`);
  });
  if (rows.length === 0) throw new Error("一覧に出すエントリが 0 件");
  return [
    "# 使わない語",
    "",
    `<!-- ${WORDS_PATH} から scripts/gates/check-word-list.js --fix で生成する。手で直さない。 -->`,
    "",
    "人が読む文章と人への応答では、次の語を使わず言い換えて書く。",
    "",
    "<!-- textlint-disable -->",
    "",
    "| 使わない語 | 言い換え |",
    "| --- | --- |",
    ...rows,
    "",
    "<!-- textlint-enable -->",
    "",
  ].join("\n");
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @param {{ fix?: boolean }} options
 * @returns {{ ok: boolean, fixed: boolean }}
 */
export function checkWordList(root, { fix = false } = {}) {
  const expected = renderWordList(root);
  const path = join(root, LIST_PATH);
  if (existsSync(path) && readFileSync(path, "utf8") === expected)
    return { ok: true, fixed: false };
  if (!fix) return { ok: false, fixed: false };
  writeFileSync(path, expected);
  return { ok: true, fixed: true };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const fix = args.includes("--fix");
  const root = args.find((a) => a !== "--fix") ?? process.cwd();
  let result;
  try {
    result = checkWordList(root, { fix });
  } catch (error) {
    console.error(`word-list: 一覧を作れない: ${error.message}`);
    return 2;
  }
  if (!result.ok) {
    console.error(
      `word-list: ${LIST_PATH} が無いか、${WORDS_PATH} と一致しない。` +
        "Fix: node scripts/gates/check-word-list.js --fix で生成し直す（一覧を手で直さない）。",
    );
    return 1;
  }
  console.log(result.fixed ? `word-list: ${LIST_PATH} を生成し直した` : "word-list: OK");
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`word-list: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
