#!/usr/bin/env node
// 使わない語の一覧（`.textlint/word-list.md`）を `.textlint/words.json` から生成する（lefthook pre-commit）。
//
// なぜ要るか: textlint はファイルしか見ないので、エージェントが人へ返す応答には単語帳が届かない。
// AGENTS.md から一覧を `@` で取り込み（Claude Code はセッション開始時に読み込む）、応答にも同じ語を使わせる。
// words.json は形態素の条件を含めて大きいので、取り込むのは `term` と `instead` だけを表にした生成物にする。
// pre-commit は、words.json か一覧が staged のときに `--index` を付けて一覧を生成し直し、stage する。
// `--index` を付けると、作業ツリーではなく index の words.json（`git show :.textlint/words.json`）から生成する。
// words.json の一部だけを stage した commit で、stage していない語を一覧に入れないためである。
//
// 生成の規則:
// - `term` を持たないエントリ（同じ語の別の形を拾うためのエントリ）は一覧に出さない。
// - `term` と `instead` の片方だけを持つエントリ・`term` の重複・「|」を含むエントリ・一覧が 0 行は、
//   一覧を作れないので書き換えずに exit 2。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { WORDS_PATH } from "../lib/text/textlint-word-rule.ts";

export const LIST_PATH = ".textlint/word-list.md";

/** 生成の元にする words.json を、作業ツリーか index から読む。 */
type Source = { fromIndex?: boolean };

/** words.json の本文。fromIndex なら index の内容を読む。無ければ例外にする。 */
function readWords(root: string, { fromIndex = false }: Source) {
  if (!fromIndex) {
    const path = join(root, WORDS_PATH);
    if (!existsSync(path)) throw new Error(`${WORDS_PATH} が無い`);
    return readFileSync(path, "utf8");
  }
  try {
    return execFileSync("git", ["show", `:${WORDS_PATH}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`index の ${WORDS_PATH} を読めない: ${errorMessage(error)}`, { cause: error });
  }
}

/** words.json から一覧のファイルの全文を作る。形の誤りは例外にする。 */
export function renderWordList(root: string, source: Source = {}) {
  const data: unknown = JSON.parse(readWords(root, source));
  const entries = isRecord(data) ? data.entries : undefined;
  if (!isArray(entries)) throw new Error("entries が配列でない");
  const rows: string[] = [];
  const seen = new Set();
  entries.forEach((e, i) => {
    if (!isRecord(e)) throw new Error(`entries[${i}] が object でない`);
    const hasTerm = typeof e.term === "string" && e.term.trim() !== "";
    const hasInstead = typeof e.instead === "string" && e.instead.trim() !== "";
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
    `<!-- ${WORDS_PATH} から scripts/tools/generate-word-list.ts で生成する（pre-commit が実行する）。手で直さない。 -->`,
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

/** 一覧を生成して書く。内容が同じなら書かない。書いたかを返す。 */
export function writeWordList(root: string, source: Source = {}) {
  const expected = renderWordList(root, source);
  const path = join(root, LIST_PATH);
  if (existsSync(path) && readFileSync(path, "utf8") === expected) return false;
  writeFileSync(path, expected);
  return true;
}

export function main(argv: string[]) {
  const args = argv.filter((a) => a !== "--");
  const fromIndex = args.includes("--index");
  const unknown = args.filter((a) => a.startsWith("-") && a !== "--index");
  if (unknown.length > 0) {
    console.error(`word-list: 知らないオプション: ${unknown.join(" ")}`);
    return 2;
  }
  const root = args.find((a) => a !== "--index") ?? process.cwd();
  let written;
  try {
    written = writeWordList(root, { fromIndex });
  } catch (error) {
    console.error(`word-list: 一覧を作れない: ${errorMessage(error)}`);
    return 2;
  }
  console.log(written ? `word-list: ${LIST_PATH} を生成し直した` : "word-list: 変更なし");
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`word-list: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
