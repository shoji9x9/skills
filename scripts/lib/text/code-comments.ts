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
import { errorMessage } from "../errors.ts";
import { parseJsonAs } from "../parse-as.ts";
import { isArray } from "../is-array.ts";

/**
 * コメントの 1 つの部分（1 行分の文章）。line は 0 始まりの行、column は文章の前の桁。
 * original は置き換える前の文章、start は文章が元の行で始まる桁（1 始まり）、tag は JSDoc のタグの行か。
 */
type Piece = {
  line: number;
  column: number;
  text: string;
  trailing: boolean;
  original?: string;
  start?: number;
  tag?: boolean;
};

type Extractor = (source: string, path: string) => Piece[];

/** 置き換えた文章と、閉じていない型の括弧の深さ。 */
type Replaced = { text: string; column: number; start?: number; tag?: boolean; depth: number };

/** commentMarkdown の戻り値。 */
export type CommentMarkdown = {
  markdown: string;
  lines: number[];
  columns: number[];
  starts: number[];
};

/** 拡張子ごとの取り出し方。ここに無い拡張子は対象にしない。 */
const EXTRACTORS: Record<string, Extractor> = {
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
function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export function hasComments(path: string): boolean {
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
 * 戻り値の Markdown の i 行目（0 始まり）について、lines[i] は元のファイルの行（0 始まり）。
 * Markdown の桁 c（1 始まり）は、元のファイルの桁 columns[i] + c に当たる。
 * starts[i] は文章が元の行で始まる桁（1 始まり）。囲んだ JSDoc のタグの中の指摘は、この桁より前を指さない。
 */
export function commentMarkdown(path: string, source: string): CommentMarkdown {
  const extract = EXTRACTORS[extOf(path)];
  if (!extract) throw new Error(`${path}: コメントを取り出せない拡張子`);
  const blocks = paragraphBlocks(extract(source, path));
  const md: string[] = [];
  const lines: number[] = [];
  const columns: number[] = [];
  const starts: number[] = [];
  // start を持たない部分（段落の間の空行・ディレクティブ・`//` や `#` のコメント・JSDoc のタグの無い行など）は、
  // 文章が桁 column の直後から始まるとして扱う。
  const emit = ({ text, line, column, start = column + 1 }: Omit<Piece, "trailing">) => {
    md.push(text);
    lines.push(line);
    columns.push(column);
    starts.push(start);
  };
  for (const block of blocks) {
    const directive = directiveOf(block[0]);
    // 置き換える前の文章で見る（JSDoc の型を置き換えた `` `型` `` を日本語として数えない）。
    if (!directive && !block.some((p) => JAPANESE.test(p.original ?? p.text))) continue;
    const line = block[0].line;
    if (md.length) emit({ text: "", line, column: 0 });
    if (directive) emit({ text: `<!-- textlint-${directive} -->`, line, column: 0 });
    else for (const p of block) emit(p);
  }
  return { markdown: md.join("\n"), lines, columns, starts };
}

/** 続く行のコメントを段落にまとめる。 */
function paragraphBlocks(pieces: readonly Piece[]): Piece[][] {
  const blocks: Piece[][] = [];
  for (const piece of pieces) {
    const last = blocks.at(-1);
    const previous = last?.at(-1);
    if (last && previous && joinsParagraph(previous, piece)) last.push(piece);
    else blocks.push([piece]);
  }
  return blocks;
}

/** 区切りの行（`--- 設定の解決 ---`・`=====` など）か。 */
function isSeparator(piece: Piece): boolean {
  return /^[-=─━#*]{3,}|[-=─━#*]{3,}$/.test(piece.text.trim());
}

/** piece を、直前の行の previous と同じ段落につなぐか。 */
function joinsParagraph(previous: Piece, piece: Piece): boolean {
  if (previous.trailing || piece.trailing || piece.tag) return false;
  if (directiveOf(previous) || directiveOf(piece)) return false;
  if (isSeparator(previous) || isSeparator(piece)) return false;
  return piece.line === previous.line + 1;
}

/**
 * コメントだけの行 `textlint-disable` と `textlint-enable` の位置（`scripts/lib/text/code-strings.ts` が文字列の除外に使う）。
 * line は 0 始まり。
 */
export function commentDirectives(
  path: string,
  source: string,
): { line: number; directive: "disable" | "enable" }[] {
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
function directiveOf(piece: Piece): "disable" | "enable" | undefined {
  if (piece.trailing) return undefined;
  const word = piece.text.trim().match(/^textlint-(disable|enable)$/)?.[1];
  return isDirective(word) ? word : undefined;
}

/** 正規表現の括弧が取り出した語が、disable か enable か。 */
function isDirective(word: string | undefined): word is "disable" | "enable" {
  return word === "disable" || word === "enable";
}

/** 1 行の中の位置（0 始まり）を、行と桁に直す表。 */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

/**
 * JavaScript・TypeScript のコメントの範囲を、位置の順に返す。TypeScript のパーサで読むので、文字列・正規表現・
 * テンプレートの中の `//` や `/*` をコメントとして扱わない。
 * JSDoc の子のノードの位置はコメントの中にあるので、そこから読んだ範囲（本文の `//` など）は
 * 前の範囲の中に入る。同じ文章を別のコメントとして二重に返さないよう、外側の範囲だけを返す。
 */
export function jsCommentRanges(source: string, path: string): ts.CommentRange[] {
  const kind = path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const ranges = new Map<number, ts.CommentRange>();
  const add = (list: ts.CommentRange[] | undefined) => {
    for (const r of list ?? []) ranges.set(r.pos, r);
  };
  const visit = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(source, node.getFullStart()));
    add(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  const outer: ts.CommentRange[] = [];
  let coveredUntil = -1;
  for (const r of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
    if (r.pos < coveredUntil) continue;
    coveredUntil = r.end;
    outer.push(r);
  }
  return outer;
}

/** 位置（0 始まり）を含む行の番号（0 始まり）。starts は lineStarts の表で、二分探索で探す。 */
function lineIndexOf(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** JavaScript・TypeScript のコメントを、1 行分ずつの部分にする。 */
function jsComments(source: string, path: string): Piece[] {
  const starts = lineStarts(source);
  const pieces: Piece[] = [];
  for (const r of jsCommentRanges(source, path)) {
    const comment = { source, path, starts, range: r };
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) pieces.push(lineCommentPiece(comment));
    else pieces.push(...blockCommentPieces(comment));
  }
  return pieces;
}

/** 1 つのコメントの範囲と、それを読むのに使うファイルの中身・パス・行の開始位置の表。 */
type JsComment = {
  source: string;
  path: string;
  starts: readonly number[];
  range: ts.CommentRange;
};

/** `//` の 1 行のコメントを、`//` と直後の空白 1 つを外した部分にする。 */
function lineCommentPiece({ source, path, starts, range: r }: JsComment): Piece {
  const raw = source.slice(r.pos, r.end);
  const first = lineIndexOf(starts, r.pos);
  const m = raw.match(/^\/\/ ?/);
  if (!m) throw new Error(`${path}: 1 行のコメントが // で始まらない（${first + 1} 行目）`);
  return {
    line: first,
    column: r.pos - starts[first] + m[0].length,
    text: raw.slice(m[0].length),
    trailing: afterCode(source, starts[first], r.pos),
  };
}

// ブロックコメントを、行ごとの部分にする。開始の `/*`・`/**`、終わりの `*/`、各行の先頭の ` * ` を外す。
// `/**/` の `/**` を開始として読まない（残った `/` が本文になる）。
function blockCommentPieces({ source, path, starts, range: r }: JsComment): Piece[] {
  const raw = source.slice(r.pos, r.end);
  const first = lineIndexOf(starts, r.pos);
  const opened = raw.match(/^\/\*(?:\*(?!\/))?/);
  if (!opened) throw new Error(`${path}: ブロックコメントが /* で始まらない（${first + 1} 行目）`);
  const open = opened[0];
  const body = " ".repeat(open.length) + raw.slice(open.length).replace(/\*\/$/, "");
  const pieces: Piece[] = [];
  let typeDepth = 0;
  body.split("\n").forEach((part, i) => {
    const lead = i === 0 ? part.match(/^\s*/) : part.match(/^\s*(?:\*(?!\*) ?)?/);
    // どちらの正規表現も空の文字列に一致できるので、必ず一致する。
    if (!lead)
      throw new Error(`${path}: 行頭の空白の正規表現が一致しない（${first + i + 1} 行目）`);
    const text = part.slice(lead[0].length).trimEnd();
    if (!text) return;
    const column = i === 0 ? r.pos - starts[first] + lead[0].length : lead[0].length;
    const trailing = i === 0 && afterCode(source, starts[first], r.pos);
    // JSDoc のタグは `/**` のコメントにだけ書く。`//` や `/*` の行頭の `@` は文章として読む。
    // `/**` なら置き換えた結果（Replaced）にする。代入した後は Replaced として読む（depth がある）。
    let piece: Replaced | { text: string; column: number; start?: undefined; tag?: undefined } = {
      text,
      column,
    };
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
  return pieces;
}

/** コメントの前に、同じ行にコードがあるか。 */
function afterCode(source: string, lineStart: number, pos: number): boolean {
  return source.slice(lineStart, pos).trim() !== "";
}

/**
 * JSDoc のタグと型（`@param {{ root: string }}` など）を、タグの名前だけのインラインコード（`` `@param` ``）に置き換える。
 * 型の `?` や `|` を文章として数えないためである。型を残すと、インラインコードの中の文字も文の長さに数えられる。
 * 型の括弧が同じ行で閉じなければ、行の終わりまでを型として置き換え、閉じていない括弧の数を depth で返す。
 * 次の行からは、括弧が閉じるまでを typeContinuationAsCode が置き換える。
 * 置き換えで文章の位置がずれるので、桁を同じ分だけずらして返す（指摘の桁が元のファイルの桁に戻る）。
 * start は文章が元の行で始まる桁（1 始まり）、tag はタグの行かどうか。
 */
function jsdocTypeAsCode(text: string, column: number): Replaced {
  const tag = text.match(/^@\w+/);
  if (!tag) return { text, column, depth: 0 };
  const open = text.slice(tag[0].length).match(/^\s*\{/);
  const { end, depth } = open
    ? closingBrace(text, tag[0].length + open[0].length - 1, 0)
    : { end: tag[0].length, depth: 0 };
  return { ...replaceWithCode({ text, end, column, label: tag[0] }), tag: true, depth };
}

/** 前の行から続く型の行を、括弧が閉じるところまで `` `型` `` に置き換える。 */
function typeContinuationAsCode(text: string, column: number, depth: number): Replaced {
  const closed = closingBrace(text, 0, depth);
  return {
    ...replaceWithCode({ text, end: closed.end, column, label: "型" }),
    depth: closed.depth,
  };
}

/** from から読み、括弧の深さが 0 に戻った直後の位置を返す。行の中で戻らなければ、行の長さと残りの深さを返す。 */
function closingBrace(text: string, from: number, depth: number): { end: number; depth: number } {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { end: i + 1, depth: 0 };
  }
  return { end: text.length, depth };
}

/** 先頭から end までを、label だけのインラインコードに置き換える。 */
function replaceWithCode({
  text,
  end,
  column,
  label,
}: {
  text: string;
  end: number;
  column: number;
  label: string;
}): { text: string; column: number; start: number } {
  const replaced = `\`${label}\`${text.slice(end)}`;
  return { text: replaced, column: column - (replaced.length - text.length), start: column + 1 };
}

/** YAML の `#` がコメントの始まりか（行頭か、空白の直後）。 */
function startsComment(line: string, i: number): boolean {
  return i === 0 || /\s/.test(line[i - 1]);
}

/**
 * PATH とカレントディレクトリの組ごとに、shfmt を起動できるかを 1 回だけ確かめた結果（エラーの文、または null）。
 * mise の shim がバージョンを解決できるかは、カレントディレクトリ（mise.toml があるか）でも変わる。
 */
const shfmtProblems = new Map<string, string | null>();

/** execFileSync が投げたエラーの、子の stderr（空なら message）。 */
function execErrorDetail(error: unknown): string {
  const stderr = error instanceof Error && "stderr" in error ? error.stderr : undefined;
  const text = Buffer.isBuffer(stderr)
    ? stderr.toString()
    : typeof stderr === "string"
      ? stderr
      : "";
  return text || errorMessage(error);
}

/** 実行環境にツールが無いことを表す取り出しの失敗（shellComments が missingTool を付けて投げる）。 */
export type MissingToolError = Error & { missingTool: true };

/** 取り出しの失敗が、ツールが無いことによるものか。 */
export function isMissingToolError(error: unknown): error is MissingToolError {
  return error instanceof Error && "missingTool" in error && error.missingTool === true;
}

/**
 * shfmt を起動できるかを `shfmt --version` で確かめる。起動できない理由は、PATH に無い（ENOENT）ことに加えて、
 * mise の shim がバージョンを解決できない（設定の無いディレクトリ、未インストールのバージョン）ことがある。shim は後者で exit 1 になり、
 * 解析の失敗と同じ形になるので、解析の前にツールの有無だけを分けて確かめる。
 */
function shfmtProblem(): string | null | undefined {
  const key = `${process.env.PATH ?? ""}\0${process.cwd()}`;
  if (!shfmtProblems.has(key)) {
    let problem: string | null = null;
    try {
      execFileSync("shfmt", ["--version"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    } catch (error) {
      const detail = execErrorDetail(error).trim().split("\n")[0];
      problem = `shfmt を起動できない（${detail}）。mise の shim が PATH にあり、mise.toml のバージョンが入っているかを確かめる`;
    }
    shfmtProblems.set(key, problem);
  }
  return shfmtProblems.get(key);
}

/** shfmt のコメントの位置（Offset はバイト単位で 0 始まり、Line は 1 始まり）。 */
type ShHash = { Offset: number; Line: number };
/** `Hash` を持つノード（コメント）。空のコメントは `Text` を省く。 */
type ShComment = { Hash: ShHash; Text: string };
/**
 * `shfmt --to-json` の値。`Hash` を持つのはコメントのノードだけなので、`Hash` の有無で 2 つの形に分ける
 * （`if (node.Hash)` で、コメントのノードの形に絞り込めるように）。
 */
type ShObject =
  | { Hash: ShHash; Text?: string; [key: string]: ShValue | undefined }
  | { Hash?: undefined; [key: string]: ShValue | undefined };
type ShValue = ShObject | ShValue[] | string | number | boolean | null;

/** `shfmt --to-json` でシェルを解析した構文木（JSON の文字列）。解析できなければ Error を投げる。 */
function shfmtToJson(source: string, path: string): string {
  try {
    // --filename は方言（bash・posix など）の判定に使う。拡張子とシバンから決まる。
    return execFileSync("shfmt", ["--to-json", "--filename", path], {
      input: source,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = execErrorDetail(error).trim().split("\n")[0];
    throw new Error(
      `シェルを解析できないので、コメントを判定できない（shfmt --to-json: ${detail}）`,
    );
  }
}

/** シェルのコメントを、shfmt の構文木から 1 行分ずつの部分にする。1 行目の `#!` は外す。 */
function shellComments(source: string, path: string): Piece[] {
  const problem = shfmtProblem();
  // 起動できないのはファイルではなく実行環境の問題なので、ファイルごとの解析の失敗と分ける。
  // 呼び出し元が実行そのものを止められるように missingTool を付ける。
  if (problem) throw Object.assign(new Error(problem), { missingTool: true });
  const json = shfmtToJson(source, path);
  // コメントのノードは `Comments` のほか、ファイルやブロックの末尾の `Last` にも入る。
  // 置き場所のキーを並べると取りこぼすので、`Hash`（`#` の位置。コメントのノードだけが持つ）を持つノードをすべて集める。
  // 空のコメント（`#` だけの行）は `Text` が省かれるので、`Text` の有無では判定しない。
  const comments = new Map<number, ShComment>();
  const walk = (node: ShValue | undefined): void => {
    if (isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (node.Hash) comments.set(node.Hash.Offset, { ...node, Text: node.Text ?? "" });
      Object.values(node).forEach(walk);
    }
  };
  walk(parseJsonAs<ShValue>(json));

  // shfmt の位置はバイト単位なので、文字の位置に直す（行に日本語があると桁がずれる）。
  const bytes = Buffer.from(source, "utf8");
  const starts = lineStarts(source);
  const pieces: Piece[] = [];
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

function yamlComments(source: string): Piece[] {
  return source.split("\n").flatMap((line, n) => {
    const piece = yamlLineComment(line, n);
    return piece ? [piece] : [];
  });
}

/** YAML の 1 行（n 行目、0 始まり）のコメント。引用の中の `#` はコメントにしない。 */
function yamlLineComment(line: string, n: number): Piece | undefined {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== "") {
      ({ i, quote } = yamlQuoteStep(line, i, quote));
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
      return { line: n, column: i + 1 + pad, text: rest.slice(pad).trimEnd(), trailing };
    }
  }
  return undefined;
}

/** 引用（quote）の中で i 文字目を読む。読み終えた位置と、続く引用（閉じたら空文字）を返す。 */
function yamlQuoteStep(line: string, i: number, quote: string): { i: number; quote: string } {
  const c = line[i];
  if (quote === "'") {
    // 一重引用符の中の `''` は `'` のエスケープで、引用の終わりではない。
    if (c === "'" && line[i + 1] === "'") return { i: i + 1, quote };
    return { i, quote: c === "'" ? "" : quote };
  }
  if (c === "\\") return { i: i + 1, quote };
  return { i, quote: c === '"' ? "" : quote };
}
