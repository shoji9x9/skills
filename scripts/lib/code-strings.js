// ソースコードと eval の定義から、人が読む文字列（テスト名・利用者に表示するメッセージ・eval の prompt と assertion）を取り出す。
// lint-prose が、使わない語の一覧（`.textlint/words.json`）だけをこの文字列に当てる。
//
// なぜ要るか: コメントと Markdown だけを見ると、テスト名・メッセージ・eval の文字列に旧称が残る。
// 新しいテストや eval を書くときに既存のものを手本にすると、旧称がそのまま広がる（#567）。
// 文字列は文章の書式（文の長さ・感嘆符など）を守る対象ではないので、語の規則だけを当てる。
//
// 取り出し方:
// - JavaScript・TypeScript: TypeScript のパーサで文字列リテラルとテンプレートリテラルの各部分を得る。
//   値（エスケープを解いた文字列）を見る。テンプレートの式の部分は見ない。
// - `evals/<name>/evals.json`: 各 eval の `prompt`・`expected_output`・`assertions` の文字列を得る。
//
// 取り出した文字列は、1 つずつ別の段落にした Markdown にする（前後の文字列と 1 語につながらないように）。
// 文字列の中の Markdown の書式は、コメントと同じ意味で扱う。バッククォートで囲んだ語は字義どおりの言及として見ない。
// ただし、文字列が Markdown のブロックの構文として読まれ、中の語が見えなくなる形は、CommonMark のブロックの種類から挙げて無効にする。
// - HTML のブロックとコメント: `<` を空白にする。
// - コードフェンス: 3 つ以上続くバッククォート・チルダを空白にする。
// - 字下げのコードブロック: 行頭の空白を外す。
// - 入れ物（リストの項目・引用）: 行頭のリストの記号（`-`・`*`・`+`・`1.`・`1)`）と `>` を、空白と一緒に外す。
//   入れ物の中には、字下げやリンク参照の定義など、すべてのブロックを書けるためである。記号は語ではないので、外しても検出は変わらない。
// - リンク参照の定義: 行頭の `[ラベル]:` の `[` を空白にする。
// - front matter: Markdown の先頭を空行にする（先頭の `---` を front matter として読ませない）。
// 見出し・表・区切り線・強調は、中の文字を語として読むので、そのままにする。
//
// コメントだけの行 `textlint-disable` と `textlint-enable`（`scripts/lib/code-comments.js` と同じ）は、
// その間の文字列をチェックから外す。わざと旧称を入れたテストの入力に使う。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { commentDirectives } from "./code-comments.js";

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts"];
const EVALS = /^evals\/[^/]+\/evals\.json$/;
const EVAL_STRING_KEYS = new Set(["prompt", "expected_output"]);

/** 日本語の文字（ひらがな・カタカナ・漢字）を含むか。 */
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const WORDS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".textlint",
  "words.json",
);

/**
 * 使わない語の一覧（`.textlint/words.json`）の `term` のうち、日本語を含まない語（`fail-closed` など）。
 * `term` は「・」で複数の語を並べることがあるので、分けてから選ぶ。
 */
export function englishTerms(words = JSON.parse(readFileSync(WORDS_PATH, "utf8"))) {
  return (words.entries ?? [])
    .flatMap((e) => (typeof e?.term === "string" ? e.term.split("・") : []))
    .map((t) => t.trim())
    .filter((t) => t && !JAPANESE.test(t) && /[A-Za-z]/.test(t));
}

/** 英語の語のどれかを含むかの正規表現。`-` は空白も許す（一覧は `fail closed` も検出する）。語が無ければ何にも一致しない。 */
export function englishTermPattern(terms) {
  if (terms.length === 0) return /(?!)/;
  const parts = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[- ]"));
  return new RegExp(`\\b(?:${parts.join("|")})\\b`, "i");
}

/** 日本語を含まない文字列でも、この語を含めば見る（語の一覧から作るので、一覧に英語の語を足せば追随する）。 */
const ENGLISH_TERMS = englishTermPattern(englishTerms());

export function hasStrings(path) {
  return EVALS.test(path) || JS_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * 文字列を Markdown にする。戻り値の形は `commentMarkdown` と同じ。
 * @returns {{ markdown: string, lines: number[], columns: number[], starts: number[] }}
 */
export function stringMarkdown(path, source) {
  if (!hasStrings(path)) throw new Error(`${path}: 文字列を取り出せないファイル`);
  const isEvals = EVALS.test(path);
  const sf = isEvals
    ? ts.parseJsonText(path, source)
    : ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
      );
  if (isEvals && sf.parseDiagnostics.length > 0) {
    throw new Error(`${path}: JSON として読めない（${sf.parseDiagnostics.length} 件の構文エラー）`);
  }
  const items = isEvals ? evalStrings(sf) : jsStrings(sf);
  // ディレクティブの行は、文字列と位置の順に並べて Markdown のコメントにする。
  const directives = isEvals ? [] : commentDirectives(path, source);
  const entries = [
    ...items.map((node) => ({ pos: node.getStart(sf), node })),
    ...directives.map((d) => ({ pos: sf.getPositionOfLineAndCharacter(d.line, 0), d })),
  ].sort((a, b) => a.pos - b.pos);

  const md = [];
  const lines = [];
  const columns = [];
  const starts = [];
  const emit = (text, line, column) => {
    md.push(text);
    lines.push(line);
    columns.push(column);
    starts.push(column + 1);
  };
  for (const entry of entries) {
    if (entry.d) {
      emit("", entry.d.line, 0);
      emit(`<!-- textlint-${entry.d.directive} -->`, entry.d.line, 0);
      continue;
    }
    const { node } = entry;
    const text = node.text;
    if (!JAPANESE.test(text) && !ENGLISH_TERMS.test(text)) continue;
    // 値の先頭は、引用符（テンプレートの部分なら `` ` `` か `}`）の次の桁にある。
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf) + 1);
    // 値の改行がソースの改行か（テンプレートリテラル）、エスケープ（`\n`）かで、行の対応が変わる。
    // 1 つのテンプレートに両方が含まれることもあるので、改行ごとにどちらかを読み分ける。
    const origins = partOrigins(source.slice(node.getStart(sf), node.getEnd()), start);
    // 文字列の前には必ず空行を置く。前の文字列と段落を分け、Markdown の先頭も空行になる
    // （先頭の `---` が front matter として読まれない）。
    emit("", start.line, 0);
    text.split("\n").forEach((part, i) => {
      // 行頭の空白と、入れ物（リストの項目・引用）の記号を外す。記号の後ろには空白か行末が要る（`-正本` や `1.5` は外さない）。
      const lead = part.match(/^(?:\s|>|[-*+](?=\s|$)|\d{1,9}[.)](?=\s|$))*/)[0].length;
      // textlint は単独の `\r` も改行として読むので、空白にする（行の対応がずれないように）。
      const body = part
        .slice(lead)
        .replace(/\r/g, " ")
        .replace(/</g, " ")
        .replace(/`{3,}|~{3,}/g, (m) => " ".repeat(m.length))
        .replace(/^\[(?=[^\]]*\]:)/, " ");
      // `\u000a` などで値の改行の数がソースと合わなければ、最後に分かった位置で近似する。
      const origin = origins[i] ?? origins.at(-1);
      emit(body, origin.line, origin.column + lead);
    });
  }
  return { markdown: md.join("\n"), lines, columns, starts };
}

/**
 * 値を `\n` で分けた各部分が、ソースのどの行と桁で始まるか。raw は引用符を含むソースの範囲。
 * ソースの改行の後の部分は次の行の先頭から始まる。エスケープ（`\n`）の後の部分は同じ行に残り、
 * 桁は文字列の始まりの桁で近似する。行の継続（`\` と改行）は値に改行を作らない。
 */
function partOrigins(raw, start) {
  const origins = [{ line: start.line, column: start.character }];
  let line = start.line;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === "\\") {
      const next = raw[i + 1];
      if (next === "n") origins.push({ line, column: start.character });
      else if (next === "\n") line++;
      else if (next === "\r" && raw[i + 2] === "\n") {
        line++;
        i++;
      }
      i++;
    } else if (raw[i] === "\n") {
      line++;
      origins.push({ line, column: 0 });
    }
  }
  return origins;
}

/** JavaScript・TypeScript の文字列リテラルとテンプレートの各部分。import と export の指定子は除く。 */
function jsStrings(sf) {
  const out = [];
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
        if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent))
          out.push(node);
        break;
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        out.push(node);
        break;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** `evals[].prompt`・`evals[].expected_output`・`evals[].assertions[]` の文字列。 */
function evalStrings(sf) {
  const out = [];
  const root = sf.statements[0]?.expression;
  const evals = objectProperty(root, "evals");
  if (!evals || !ts.isArrayLiteralExpression(evals)) return out;
  for (const item of evals.elements) {
    if (!ts.isObjectLiteralExpression(item)) continue;
    for (const prop of item.properties) {
      const key = prop.name && ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
      if (EVAL_STRING_KEYS.has(key) && ts.isStringLiteral(prop.initializer))
        out.push(prop.initializer);
      if (key === "assertions" && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const a of prop.initializer.elements) if (ts.isStringLiteral(a)) out.push(a);
      }
    }
  }
  return out;
}

function objectProperty(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const prop of node.properties) {
    if (prop.name && ts.isStringLiteral(prop.name) && prop.name.text === name)
      return prop.initializer;
  }
  return undefined;
}
