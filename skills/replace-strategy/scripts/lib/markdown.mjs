// Markdown の表を読む helper。このスキルの台帳の表を読むスクリプトが共通に使う。
// GitHub が描画に使う規則とスクリプトが読む表を一致させるため、同梱した GFM（GitHub Flavored Markdown）のパーサ
// （../vendor/mdast-gfm.mjs。micromark と GFM の拡張）で読み、表・HTML・コードの範囲を木から取る。

import { parseGfm } from "../vendor/mdast-gfm.mjs";
import { unclosedFenceMessage } from "./fence.mjs";

/** @typedef {import("../vendor/mdast-gfm.mjs").Node} MdNode */

/**
 * フェンスの開く行と閉じる行を、code の節の data.fences に数える handler。
 * パーサが閉じる行と認めた行だけを数えるので、閉じたかを閉じる行の規則（字下げ・記号の数・情報文字列）を書き直さずに判定できる。
 * 閉じる行に入ったときは、作りかけの節の一番上が中身の断片になるので、最も近い code の節を数える。
 * @type {import("../vendor/mdast-gfm.mjs").Extension}
 */
const COUNT_FENCES = {
  enter: {
    codeFencedFence() {
      const code = this.stack.findLast((node) => node.type === "code");
      if (code === undefined) return;
      const fences = Number(code.data?.fences ?? 0);
      code.data = { ...code.data, fences: fences + 1 };
    },
  },
};

/**
 * 空白を 1 つに畳み、前後を除く（Markdown の表はフォーマッタが桁を詰め直すため素の比較では揺れる）。
 * @param {string} value
 * @returns {string}
 */
function collapse(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/**
 * `| a | b |` を `|` で分ける（`|` を含まなければ null）。表に属さない行のセル数を数えるのに使う。
 * `\|` は列の区切りにしない。行頭・行末の `|` は無くてもよい（GFM）。
 * @param {string | undefined} line
 * @returns {string[] | null}
 */
function splitRow(line) {
  if (line === undefined) return null;
  let trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.replaceAll("\\|", "|"));
}

/**
 * 木を深さ優先でたどり、各節で fn を呼ぶ。
 * @param {MdNode} node
 * @param {(node: MdNode) => void} fn
 */
function visit(node, fn) {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

/**
 * 節の範囲（文書の先頭からの offset）。パーサは常に位置を付けるので、無ければ判定できないとして止める。
 * @param {MdNode} node
 * @returns {{ start: number, end: number, startLine: number, endLine: number }}
 */
function rangeOf(node) {
  const position = node.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (position === undefined || start === undefined || end === undefined) {
    throw new Error(
      `Markdown の ${node.type} の位置が取れない（同梱したパーサの出力が想定と違う）`,
    );
  }
  return {
    start,
    end,
    startLine: position.start.line,
    endLine: position.end.line,
  };
}

/**
 * index の文字がバックスラッシュでエスケープされているか（直前に続く `\` が奇数個か）を返す。
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
function escapedAt(text, index) {
  let count = 0;
  for (let k = index - 1; k >= 0 && text[k] === "\\"; k -= 1) count += 1;
  return count % 2 === 1;
}

/**
 * chars の [start, end) の改行以外の文字を空白にする（行と offset の対応は変えない）。
 * @param {string[]} chars
 * @param {number} start
 * @param {number} end
 */
function blankRange(chars, start, end) {
  for (let k = start; k < end; k += 1) if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
}

/**
 * セルの値。セルの範囲の元の文字列から、HTML（コメントを含む）を空白にし、区切りの `|` を除き、`\|` を `|` に戻す。
 * 元の文字列を使うのは、コードスパンのバッククォートやエスケープを、台帳に書いたとおりに読むためである。
 * @param {string} text
 * @param {MdNode} cell
 * @param {boolean} last 行の最後のセルか（行末の `|` を除く）
 * @returns {string}
 */
function cellText(text, cell, last) {
  const { start, end } = rangeOf(cell);
  // 位置は UTF-16 の offset なので、サロゲートペアを 1 要素にする [...] ではなく split("") で分ける
  const units = text.slice(start, end).split("");
  visit(cell, (node) => {
    if (node.type !== "html") return;
    const r = rangeOf(node);
    blankRange(units, r.start - start, r.end - start);
  });
  return trimDelimiters(units.join(""), last);
}

/**
 * セルの文字列から区切りの `|` を除き、`\|` を `|` に戻す。
 * @param {string} raw
 * @param {boolean} last
 * @returns {string}
 */
function trimDelimiters(raw, last) {
  let value = raw.startsWith("|") ? raw.slice(1) : raw;
  // 行末の `|` の後ろに空白やタブが残っていても、GFM は `|` を区切りとして読む
  const end = last ? value.trimEnd() : value;
  if (last && end.endsWith("|") && !escapedAt(end, end.length - 1)) value = end.slice(0, -1);
  return value.replaceAll("\\|", "|");
}

/**
 * 節が文書の末尾まで続くか。閉じないフェンスとコメントのブロックの判定に使う。
 * コンテナ（リスト・引用）の中で閉じないものはコンテナの終わりで終わり、パーサの読み方では後ろの表を隠さないので、文書の末尾まで続くかだけを見る。
 * コンテナの中の節は、コンテナの最後の項目にあって文書の末尾まで続くときだけ当たる。
 * @param {string} text
 * @param {MdNode} node
 * @returns {boolean}
 */
function reachesEnd(text, node) {
  return rangeOf(node).end >= text.trimEnd().length;
}

/**
 * 末尾まで閉じないフェンスか。フェンスの code の節は、開く行を 1 つ数える。閉じる行も数えた節は閉じている（COUNT_FENCES）。
 * 字下げした code（フェンスを持たない）は数が 0 なので当たらない。
 * @param {string} text
 * @param {MdNode} node code の節
 * @returns {boolean}
 */
function isUnclosedFence(text, node) {
  return node.data?.fences === 1 && reachesEnd(text, node);
}

/**
 * HTML の節に含まれるコメントが占める範囲（文書の先頭からの offset）。表の外の行を数えるときに、この範囲を除く。
 * 閉じたコメント（`<!-->`・`<!--->` を含む）は `-->` か `--!>`（HTML ではどちらも閉じる）まで、閉じないものは節の終わりまでを範囲にする。
 * 節の値ではなく元の文字列から探すので、`<details>` などの HTML ブロックの中のコメントも当たる。
 * @param {string} source html の節の元の文字列
 * @param {number} offset 節の先頭の offset
 * @returns {{ start: number, end: number }[]}
 */
function commentRanges(source, offset) {
  return [...source.matchAll(/<!--(?:>|->|[\s\S]*?--!?>|[\s\S]*$)/gu)].map((m) => ({
    start: offset + m.index,
    end: offset + m.index + m[0].length,
  }));
}

/**
 * HTML の節を読み、表の外の行を数えない範囲と、末尾まで閉じないコメントのブロックかを返す。
 * 閉じないコメントとして扱うのは、パーサがコメントのブロック（行頭か、3 文字までの字下げの後の `<!--`）として読み、`-->` が無いまま文書の末尾まで続くものだけである。
 * 引用・リストの中で文書の末尾まで続かないものと、ほかの HTML ブロックの中で開いた `<!--` は、パーサの読み方では後ろの表を隠さないので扱わない。
 * @param {string} text
 * @param {MdNode} node html の節
 * @returns {{ hidden: { start: number, end: number }[], unclosed: boolean }}
 */
function readHtml(text, node) {
  const r = rangeOf(node);
  const source = text.slice(r.start, r.end);
  if (!/^\s*<!--/u.test(source)) return { hidden: commentRanges(source, r.start), unclosed: false };
  // コメントのブロックは、閉じる行の `-->` の後ろもブロックに入るので、節の全体を数えない
  // パーサは `-->` を含む行でブロックを終える。閉じたかも `-->` で決める（`<!-->` と `<!--->` も `-->` を含む）
  const closed = source.includes("-->");
  return { hidden: [{ start: r.start, end: r.end }], unclosed: !closed && reachesEnd(text, node) };
}

/**
 * 末尾まで閉じない HTML コメントを、利用者に返す文にする。
 * @param {number} line コメントを開いた行の番号（1 始まり）
 * @returns {string}
 */
function unclosedCommentMessage(line) {
  return `${line} 行目で開いた HTML コメント（<!--）が末尾まで閉じていない。その後ろの行はすべてコメントになり、表として読めない。--> で閉じる`;
}

/**
 * 表に属さないのに `|` を含む行（GFM で表にならない行）。
 * @typedef {{ line: number, cells: number, leadingPipe: boolean }} StrayRow
 */

/**
 * @typedef {{ headers: string[], rows: string[][], rowLines: number[] }} Table
 */

/**
 * 表の節を、見出しと行に分けて読む。
 * @param {string} text
 * @param {MdNode} node table の節
 * @param {(cell: string) => string} normalizeHeader
 * @returns {Table}
 */
function readTable(text, node, normalizeHeader) {
  const [header, ...body] = node.children ?? [];
  /** @param {MdNode} row */
  const cellsOf = (row) => {
    const cells = row.children ?? [];
    return cells.map((cell, index) => cellText(text, cell, index === cells.length - 1));
  };
  return {
    headers: header === undefined ? [] : cellsOf(header).map(normalizeHeader),
    rows: body.map(cellsOf),
    rowLines: body.map((row) => rangeOf(row).startLine),
  };
}

/**
 * 表の外の、`|` を含む行を挙げる。HTML コメントとコード（フェンス・字下げ・インライン）の中は、表示されないか例示なので数えない。
 * コメント以外の HTML（`<details>` など）の中の行は、描画で表の行にならないが、エディタでは表の行に見えるので数える。
 * @param {string} text
 * @param {{ hidden: { start: number, end: number }[], tableLines: Set<number> }} parsed 数えない範囲と、表の行の番号
 * @returns {StrayRow[]}
 */
function strayRowsOf(text, { hidden, tableLines }) {
  const chars = text.split("");
  for (const r of hidden) blankRange(chars, r.start, r.end);
  /** @type {StrayRow[]} */
  const strayRows = [];
  chars
    .join("")
    // パーサと同じく、CR だけの改行も行の区切りにする（tableLines はパーサの行番号）
    .split(/\r\n|\r|\n/u)
    .forEach((line, index) => {
      if (tableLines.has(index + 1)) return;
      const cells = splitRow(line);
      if (cells === null) return;
      strayRows.push({
        line: index + 1,
        cells: cells.length,
        leadingPipe: line.trim().startsWith("|"),
      });
    });
  return strayRows;
}

/**
 * Markdown の表を全て取り出す。読み方は GFM の描画と同じで、同梱した GFM のパーサが決める。
 * コードの中・HTML コメントの中の表は表にならないので読まない（コメントアウトして残した行を、台帳の行として数えない）。
 * 引用やリストの中の表も、GFM と同じく表として読む。
 * 行のセル数は書いたとおりに返す（GFM の描画は余るセルを捨て、足りないセルを空にするが、呼び出し側が列の数の誤りとして扱えるようにする）。
 *
 * 表に属さないのに `|` を含む行は、警告なしに捨てず、行番号・セル数・行頭の `|` の有無を strayRows に返す
 * （GFM は行頭・行末の `|` を省けるので、行頭の `|` だけでは表の行を見分けられない）。
 * 末尾まで閉じないフェンス（閉じる行に情報文字列を付けた ` ```sh `、4 文字以上字下げした閉じる行など）は、開いた行の番号を unclosedFence に返す。
 * 末尾まで閉じない HTML コメントのブロック（行頭か、3 文字までの字下げの後の `<!--`）は、開いた行の番号を unclosedComment に返す（readHtml）。
 * どちらも後ろの表を読めなくするので、呼び出し側は台帳を読まずに止める。
 * @param {string} text
 * @param {{ normalizeHeader?: (cell: string) => string }} [options] normalizeHeader は見出しのセルの正規化（デフォルトは collapse）
 * @returns {{ tables: Table[], strayRows: StrayRow[], unclosedFence: number | null, unclosedComment: number | null }}
 *   rowLines は各行のファイル上の行番号（1 始まり。エラー文で行を指せるように）
 */
function parseTables(text, options = {}) {
  const { normalizeHeader = collapse } = options;
  /** @type {Table[]} */
  const tables = [];
  /** @type {{ start: number, end: number }[]} */
  const hidden = [];
  /** @type {Set<number>} */
  const tableLines = new Set();
  /** @type {number | null} */
  let unclosedFence = null;
  /** @type {number | null} */
  let unclosedComment = null;
  visit(parseGfm(text, [COUNT_FENCES]), (node) => {
    if (node.type === "table") {
      tables.push(readTable(text, node, normalizeHeader));
      const r = rangeOf(node);
      for (let line = r.startLine; line <= r.endLine; line += 1) tableLines.add(line);
    } else if (node.type === "code" || node.type === "inlineCode") {
      hidden.push(rangeOf(node));
      if (node.type === "code" && unclosedFence === null && isUnclosedFence(text, node)) {
        unclosedFence = rangeOf(node).startLine;
      }
    } else if (node.type === "html") {
      const html = readHtml(text, node);
      hidden.push(...html.hidden);
      if (unclosedComment === null && html.unclosed) unclosedComment = rangeOf(node).startLine;
    }
  });
  const strayRows = strayRowsOf(text, { hidden, tableLines });
  return { tables, strayRows, unclosedFence, unclosedComment };
}

export { collapse, parseTables, unclosedCommentMessage, unclosedFenceMessage };
