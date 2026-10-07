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
// ただし、`<` と 3 つ以上続くバッククォート・チルダは空白に置き換え、行頭の空白は外す。
// HTML のコメントやコードフェンス・字下げのコードブロックとして読まれると、後に続く文字列がまとめて見えなくなるためである。
//
// コメントだけの行 `textlint-disable` と `textlint-enable`（`scripts/lib/code-comments.js` と同じ）は、
// その間の文字列をチェックから外す。わざと旧称を入れたテストの入力に使う。
import ts from "typescript";
import { commentDirectives } from "./code-comments.js";

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts"];
const EVALS = /^evals\/[^/]+\/evals\.json$/;
const EVAL_STRING_KEYS = new Set(["prompt", "expected_output"]);

/** 日本語の文字（ひらがな・カタカナ・漢字）を含むか。 */
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
/** 使わない語の一覧にある英語の語（`fail-closed` など）。日本語を含まない文字列でも、これを含めば見る。 */
const ENGLISH_TERMS = /\bfail[- ](?:closed|open|safe)\b/i;

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
      if (md.length) emit("", entry.d.line, 0);
      emit(`<!-- textlint-${entry.d.directive} -->`, entry.d.line, 0);
      continue;
    }
    const { node } = entry;
    const text = node.text;
    if (!JAPANESE.test(text) && !ENGLISH_TERMS.test(text)) continue;
    // 値の先頭は、引用符（テンプレートの部分なら `` ` `` か `}`）の次の桁にある。
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf) + 1);
    // 値の改行がソースの改行か（テンプレートリテラル）、エスケープ（`\n`）かで、行の対応が変わる。
    const raw = source.slice(node.getStart(sf), node.getEnd());
    const literalLines = raw.includes("\n");
    if (md.length) emit("", start.line, 0);
    text.split("\n").forEach((part, i) => {
      const lead = part.match(/^\s*/)[0].length;
      const body = part
        .slice(lead)
        .replace(/</g, " ")
        .replace(/`{3,}|~{3,}/g, (m) => " ".repeat(m.length));
      const line = literalLines ? start.line + i : start.line;
      // 値の改行がエスケープなら、2 行目以降も文字列の始まりの桁で近似する。
      const column = (literalLines && i > 0 ? 0 : start.character) + lead;
      emit(body, line, column);
    });
  }
  return { markdown: md.join("\n"), lines, columns, starts };
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
