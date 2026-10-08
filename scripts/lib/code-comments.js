// ソースコードと設定ファイルから、人が読むコメントの文章だけを取り出す（lint-prose が textlint に渡す）。
//
// 取り出した文章は Markdown として組み立てる。コメントは `- ` の箇条やバッククォートを Markdown と同じ意味で
// 使っているので、プレーンテキストとして渡すと、箇条が 1 文につながって文の長さを誤って数える。
// 元の行番号を保つため、コメントの無い行は空行にする（空行で段落が分かれる）。
//
// 言語ごとの取り出し方:
// - JavaScript・TypeScript: TypeScript のパーサでコメントの範囲を得る。文字列・正規表現・テンプレートの中の
//   `//` をコメントとして扱わない。
// - シェル: `shfmt --to-json` の構文木からコメントを得る。引用・heredoc・コマンド置換・case の中を
//   構文どおりに区別する。1 行目の `#!` は見ない。shfmt で解析できないファイルは、判定できないとして例外にする。
//   自前で引用や置換を追う読み方は、文法の形ごとに読み違えが見つかり続けたので使わない。
// - YAML: 行頭か空白の後に置いた `#` から行末までをコメントにする。引用符の中は見ない。
//   ブロックスカラー（`run: |` など）の中の `#` もコメントとして扱う。シェルのコメントを見るためである。
//
// コメントだけの行 `textlint-disable` と `textlint-enable` は、Markdown の `<!-- textlint-disable -->` に置き換える。
// 字義どおりに使う語を、その範囲だけチェックから外すためである。
import { execFileSync } from "node:child_process";
import ts from "typescript";

/** 拡張子ごとの取り出し方。ここに無い拡張子は対象にしない。 */
const EXTRACTORS = {
  ".js": jsComments,
  ".mjs": jsComments,
  ".cjs": jsComments,
  ".ts": jsComments,
  ".sh": shellComments,
  ".yml": yamlComments,
  ".yaml": yamlComments,
};

export const COMMENT_EXTENSIONS = Object.keys(EXTRACTORS);

/** パスの拡張子（ドットを含む）。無ければ空文字。 */
function extOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export function hasComments(path) {
  return Object.hasOwn(EXTRACTORS, extOf(path));
}

/** 日本語の文字（ひらがな・カタカナ・漢字）を含むか。 */
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * コメントの文章を Markdown にする。
 *
 * 続けて書いたコメントの行を 1 つの段落にし、段落の間に空行を置く。
 * 行の後ろに書いたコメントは、それだけで 1 つの段落にする（隣の行のコメントと 1 文につながらないように）。
 * JSDoc のタグの行（`@param` など）も、新しい段落として始める。タグの説明は `。` で終えないことが多く、
 * 前後の行と 1 文につながって文の長さを誤って数えるためである。
 * 記号で始まるか終わる区切りの行（`--- 設定の解決 ---`・`=====` など）は、見出しとして 1 つの段落にする。
 * 日本語の文字を含まない段落は入れない。規約は日本語の文章を対象にしていて、英語のコメントや
 * ディレクティブ（`shellcheck disable=...` など）に日本語の規則を当てると誤検知になる。
 *
 * @returns {{ markdown: string, lines: number[], columns: number[], starts: number[] }}
 *   Markdown の i 行目（0 始まり）について、lines[i] は元のファイルの行（0 始まり）。
 *   Markdown の桁 c（1 始まり）は、元のファイルの桁 columns[i] + c に当たる。
 *   starts[i] は文章が元の行で始まる桁（1 始まり）。囲んだ JSDoc のタグの中の指摘は、この桁より前を指さない
 */
export function commentMarkdown(path, source) {
  const extract = EXTRACTORS[extOf(path)];
  if (!extract) throw new Error(`${path}: コメントを取り出せない拡張子`);
  const isSeparator = (piece) => /^[-=─━#*]{3,}|[-=─━#*]{3,}$/.test(piece.text.trim());
  const blocks = [];
  let previous;
  for (const piece of extract(source, path)) {
    const joins =
      previous &&
      !previous.trailing &&
      !piece.trailing &&
      !directiveOf(previous) &&
      !directiveOf(piece) &&
      !piece.tag &&
      !isSeparator(previous) &&
      !isSeparator(piece) &&
      piece.line === previous.line + 1;
    if (joins) blocks.at(-1).push(piece);
    else blocks.push([piece]);
    previous = piece;
  }
  const md = [];
  const lines = [];
  const columns = [];
  const starts = [];
  const emit = (text, line, column, start = column + 1) => {
    md.push(text);
    lines.push(line);
    columns.push(column);
    starts.push(start);
  };
  for (const block of blocks) {
    const directive = directiveOf(block[0]);
    // 置き換える前の文章で見る（JSDoc の型を置き換えた `` `型` `` を日本語として数えない）。
    if (!directive && !block.some((p) => JAPANESE.test(p.original ?? p.text))) continue;
    if (md.length) emit("", block[0].line, 0);
    if (directive) emit(`<!-- textlint-${directive} -->`, block[0].line, 0);
    else for (const p of block) emit(p.text, p.line, p.column, p.start);
  }
  return { markdown: md.join("\n"), lines, columns, starts };
}

/**
 * コメントだけの行 `textlint-disable` と `textlint-enable` の位置（`scripts/lib/code-strings.js` が文字列の除外に使う）。
 * @returns {{ line: number, directive: "disable" | "enable" }[]} line は 0 始まり
 */
export function commentDirectives(path, source) {
  const extract = EXTRACTORS[extOf(path)];
  if (!extract) throw new Error(`${path}: コメントを取り出せない拡張子`);
  return extract(source, path).flatMap((piece) => {
    const directive = directiveOf(piece);
    return directive ? [{ line: piece.line, directive }] : [];
  });
}

/**
 * コメントの 1 つの部分がディレクティブ（コメントだけの行の `textlint-disable` か `textlint-enable`）なら、その種類を返す。
 * 行の後ろに書いたコメントは、ディレクティブとして読まない。
 */
function directiveOf(piece) {
  if (piece.trailing) return undefined;
  return piece.text.trim().match(/^textlint-(disable|enable)$/)?.[1];
}

/** 1 行の中の位置（0 始まり）を、行と桁に直す表。 */
function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function jsComments(source, path) {
  const kind = path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const ranges = new Map();
  const add = (list) => {
    for (const r of list ?? []) ranges.set(r.pos, r);
  };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(source, node.getFullStart()));
    add(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);

  const starts = lineStarts(source);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const pieces = [];
  // JSDoc の子のノードの位置はコメントの中にあるので、そこから読んだ範囲（本文の `//` など）は
  // 前の範囲の中に入る。同じ文章を別のコメントとして二重に取り出さないよう、外側の範囲だけを使う。
  let coveredUntil = -1;
  for (const r of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
    if (r.pos < coveredUntil) continue;
    coveredUntil = r.end;
    const raw = source.slice(r.pos, r.end);
    const first = lineOf(r.pos);
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) {
      const m = raw.match(/^\/\/ ?/);
      pieces.push({
        line: first,
        column: r.pos - starts[first] + m[0].length,
        text: raw.slice(m[0].length),
        trailing: afterCode(source, starts[first], r.pos),
      });
      continue;
    }
    // ブロックコメント: 開始の `/*`・`/**`、終わりの `*/`、各行の先頭の ` * ` を外す。
    // `/**/` の `/**` を開始として読まない（残った `/` が本文になる）。
    const open = raw.match(/^\/\*(?:\*(?!\/))?/)[0];
    const body = " ".repeat(open.length) + raw.slice(open.length).replace(/\*\/$/, "");
    let typeDepth = 0;
    body.split("\n").forEach((part, i) => {
      const lead = i === 0 ? part.match(/^\s*/) : part.match(/^\s*(?:\*(?!\*) ?)?/);
      const text = part.slice(lead[0].length).trimEnd();
      if (!text) return;
      const column = i === 0 ? r.pos - starts[first] + lead[0].length : lead[0].length;
      const trailing = i === 0 && afterCode(source, starts[first], r.pos);
      // JSDoc のタグは `/**` のコメントにだけ書く。`//` や `/*` の行頭の `@` は文章として読む。
      let piece = { text, column };
      if (open === "/**") {
        piece =
          typeDepth > 0
            ? typeContinuationAsCode(text, column, typeDepth)
            : jsdocTypeAsCode(text, column);
        typeDepth = piece.depth;
      }
      pieces.push({
        line: first + i,
        text: piece.text,
        original: text,
        column: piece.column,
        start: piece.start,
        tag: piece.tag,
        trailing,
      });
    });
  }
  return pieces;
}

/** コメントの前に、同じ行にコードがあるか。 */
function afterCode(source, lineStart, pos) {
  return source.slice(lineStart, pos).trim() !== "";
}

/**
 * JSDoc のタグと型（`@param {{ root: string }}` など）を、タグの名前だけのインラインコード（`` `@param` ``）に置き換える。
 * 型の `?` や `|` を文章として数えないためである。型を残すと、インラインコードの中の文字も文の長さに数えられる。
 * 型の括弧が同じ行で閉じなければ、行の終わりまでを型として置き換え、閉じていない括弧の数を depth で返す。
 * 次の行からは、括弧が閉じるまでを typeContinuationAsCode が置き換える。
 * 置き換えで文章の位置がずれるので、桁を同じ分だけずらして返す（指摘の桁が元のファイルの桁に戻る）。
 * start は文章が元の行で始まる桁（1 始まり）、tag はタグの行かどうか。
 * @returns {{ text: string, column: number, start?: number, tag?: boolean, depth: number }}
 */
function jsdocTypeAsCode(text, column) {
  const tag = text.match(/^@\w+/);
  if (!tag) return { text, column, depth: 0 };
  const open = text.slice(tag[0].length).match(/^\s*\{/);
  const { end, depth } = open
    ? closingBrace(text, tag[0].length + open[0].length - 1, 0)
    : { end: tag[0].length, depth: 0 };
  return { ...replaceWithCode(text, end, column, tag[0]), tag: true, depth };
}

/** 前の行から続く型の行を、括弧が閉じるところまで `` `型` `` に置き換える。 */
function typeContinuationAsCode(text, column, depth) {
  const closed = closingBrace(text, 0, depth);
  return { ...replaceWithCode(text, closed.end, column, "型"), depth: closed.depth };
}

/** from から読み、括弧の深さが 0 に戻った直後の位置を返す。行の中で戻らなければ、行の長さと残りの深さを返す。 */
function closingBrace(text, from, depth) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { end: i + 1, depth: 0 };
  }
  return { end: text.length, depth };
}

/** 先頭から end までを、label だけのインラインコードに置き換える。 */
function replaceWithCode(text, end, column, label) {
  const replaced = `\`${label}\`${text.slice(end)}`;
  return { text: replaced, column: column - (replaced.length - text.length), start: column + 1 };
}

/** YAML の `#` がコメントの始まりか（行頭か、空白の直後）。 */
function startsComment(line, i) {
  return i === 0 || /\s/.test(line[i - 1]);
}

/**
 * PATH とカレントディレクトリの組ごとに、shfmt を起動できるかを 1 回だけ確かめた結果（エラーの文、または null）。
 * mise の shim が版を解決できるかは、カレントディレクトリ（mise.toml があるか）でも変わる。
 */
const shfmtProblems = new Map();

/**
 * shfmt を起動できるかを `shfmt --version` で確かめる。起動できない理由は、PATH に無い（ENOENT）ことに加えて、
 * mise の shim が版を解決できない（設定の無いディレクトリ、未インストールの版）ことがある。shim は後者で exit 1 になり、
 * 解析の失敗と同じ形になるので、解析の前にツールの有無だけを分けて確かめる。
 */
function shfmtProblem() {
  const key = `${process.env.PATH ?? ""}\0${process.cwd()}`;
  if (!shfmtProblems.has(key)) {
    let problem = null;
    try {
      execFileSync("shfmt", ["--version"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    } catch (error) {
      const detail = String(error.stderr || error.message)
        .trim()
        .split("\n")[0];
      problem = `shfmt を起動できない（${detail}）。mise の shim が PATH にあり、mise.toml の版が入っているかを確かめる`;
    }
    shfmtProblems.set(key, problem);
  }
  return shfmtProblems.get(key);
}

function shellComments(source, path) {
  const problem = shfmtProblem();
  // 起動できないのはファイルではなく実行環境の問題なので、ファイルごとの解析の失敗と分ける。
  // 呼び出し元が実行そのものを止められるように missingTool を付ける。
  if (problem) throw Object.assign(new Error(problem), { missingTool: true });
  let json;
  try {
    // --filename は方言（bash・posix など）の判定に使う。拡張子とシバンから決まる。
    json = execFileSync("shfmt", ["--to-json", "--filename", path], {
      input: source,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error.stderr || error.message)
      .trim()
      .split("\n")[0];
    throw new Error(
      `シェルを解析できないので、コメントを判定できない（shfmt --to-json: ${detail}）`,
    );
  }
  // コメントのノードは `Comments` のほか、ファイルやブロックの末尾の `Last` にも入る。
  // 置き場所のキーを並べると取りこぼすので、`Hash`（`#` の位置。コメントのノードだけが持つ）を持つノードをすべて集める。
  // 空のコメント（`#` だけの行）は `Text` が省かれるので、`Text` の有無では判定しない。
  const comments = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (node.Hash) comments.set(node.Hash.Offset, { ...node, Text: node.Text ?? "" });
      Object.values(node).forEach(walk);
    }
  };
  walk(JSON.parse(json));

  // shfmt の位置はバイト単位なので、文字の位置に直す（行に日本語があると桁がずれる）。
  const bytes = Buffer.from(source, "utf8");
  const starts = lineStarts(source);
  const pieces = [];
  for (const c of [...comments.values()].sort((a, b) => a.Hash.Offset - b.Hash.Offset)) {
    if (c.Hash.Offset === 0 && c.Text.startsWith("!")) continue;
    const index = bytes.subarray(0, c.Hash.Offset).toString("utf8").length;
    const line = c.Hash.Line - 1;
    const pad = c.Text.startsWith(" ") ? 1 : 0;
    pieces.push({
      line,
      column: index - starts[line] + 1 + pad,
      text: c.Text.slice(pad).trimEnd(),
      trailing: source.slice(starts[line], index).trim() !== "",
    });
  }
  return pieces;
}

function yamlComments(source) {
  const pieces = [];
  source.split("\n").forEach((line, n) => {
    let quote = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote === "'") {
        // 一重引用符の中の `''` は `'` のエスケープで、引用の終わりではない。
        if (c === "'" && line[i + 1] === "'") i++;
        else if (c === "'") quote = "";
        continue;
      }
      if (quote === '"') {
        if (c === "\\") i++;
        else if (c === '"') quote = "";
        continue;
      }
      // 引用はスカラーの先頭（行頭・空白・フローの `[` `{` `,` の後）でだけ始まる。`it's` の `'` は引用にしない。
      if ((c === "'" || c === '"') && (i === 0 || /[\s[{,]/.test(line[i - 1]))) {
        quote = c;
        continue;
      }
      if (c === "#" && startsComment(line, i)) {
        const rest = line.slice(i + 1);
        const pad = rest.startsWith(" ") ? 1 : 0;
        const trailing = line.slice(0, i).trim() !== "";
        pieces.push({ line: n, column: i + 1 + pad, text: rest.slice(pad).trimEnd(), trailing });
        break;
      }
    }
  });
  return pieces;
}
