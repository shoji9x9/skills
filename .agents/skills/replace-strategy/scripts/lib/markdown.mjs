// Markdown の表を読む helper。このスキルの台帳の表を読むスクリプトが共通に使う。
// 人が GitHub やエディタで見る表とスクリプトが読む表を一致させるため、同梱した GFM（GitHub Flavored Markdown）のパーサ
// （../vendor/mdast-gfm.mjs。micromark と GFM の拡張）で読み、表・HTML・コードの範囲を木から取る。

import { parseGfm } from "../vendor/mdast-gfm.mjs";
import { unclosedFenceMessage } from "./fence.mjs";

/** @typedef {import("../vendor/mdast-gfm.mjs").Node} MdNode */

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
 * @returns {{ start: number, end: number, startLine: number, endLine: number, startColumn: number }}
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
    startColumn: position.start.column,
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
 * 末尾まで閉じないフェンスか。閉じる行は、開いた記号と同じ文字を同じ数以上並べ、後ろに空白とタブだけを置く行である（CommonMark）。
 * コンテナ（リスト・引用）の中で閉じないフェンスはコンテナの終わりで終わり、後ろの表を隠さないので、文書の末尾まで続くものだけを挙げる。
 * @param {string} text
 * @param {MdNode} node code の節
 * @param {number[]} starts 各行の先頭の offset
 * @returns {boolean}
 */
function isUnclosedFence(text, node, starts) {
  const r = rangeOf(node);
  const open = /^(`{3,}|~{3,})/u.exec(text.slice(r.start, r.end));
  if (open === null) return false;
  if (r.end < text.trimEnd().length) return false;
  if (r.endLine === r.startLine) return true;
  // 最後の行から、コンテナの印（引用の `>`・リストの字下げ）の幅を除いて、閉じる行かを見る。
  // 開く行の字下げ（3 文字まで）は除く幅に入れない。閉じる行の字下げは開く行と関係なく 3 文字まで許される（CommonMark）
  const prefix = text.slice(starts[r.startLine - 1], r.start);
  const indent = / {0,3}$/u.exec(prefix)?.[0].length ?? 0;
  const lastLine = text.slice(starts[r.endLine - 1], r.end).slice(prefix.length - indent);
  const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(lastLine);
  return !(close !== null && close[1][0] === open[1][0] && close[1].length >= open[1].length);
}

/**
 * 各行の先頭の offset（0 始まりの行番号で引く）。
 * @param {string} text
 * @returns {number[]}
 */
function lineStarts(text) {
  const starts = [0];
  for (const m of text.matchAll(/\r?\n/gu)) starts.push(m.index + m[0].length);
  return starts;
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
 * 表の外の、`|` を含む行を挙げる。HTML（コメントを含む）とコードの中は、文字として表示されないか例示なので数えない。
 * @param {string} text
 * @param {{ hidden: MdNode[], tableLines: Set<number> }} parsed
 * @returns {StrayRow[]}
 */
function strayRowsOf(text, { hidden, tableLines }) {
  const chars = text.split("");
  for (const node of hidden) {
    const r = rangeOf(node);
    blankRange(chars, r.start, r.end);
  }
  /** @type {StrayRow[]} */
  const strayRows = [];
  chars
    .join("")
    .split(/\r?\n/u)
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
 * フェンスの後ろの表はすべて読まれないので、呼び出し側は台帳を読まずに止める。
 * @param {string} text
 * @param {{ normalizeHeader?: (cell: string) => string }} [options] normalizeHeader は見出しのセルの正規化（デフォルトは collapse）
 * @returns {{ tables: Table[], strayRows: StrayRow[], unclosedFence: number | null }}
 *   rowLines は各行のファイル上の行番号（1 始まり。エラー文で行を指せるように）
 */
function parseTables(text, options = {}) {
  const { normalizeHeader = collapse } = options;
  const starts = lineStarts(text);
  /** @type {Table[]} */
  const tables = [];
  /** @type {MdNode[]} */
  const hidden = [];
  /** @type {Set<number>} */
  const tableLines = new Set();
  /** @type {number | null} */
  let unclosedFence = null;
  visit(parseGfm(text), (node) => {
    if (node.type === "table") {
      tables.push(readTable(text, node, normalizeHeader));
      const r = rangeOf(node);
      for (let line = r.startLine; line <= r.endLine; line += 1) tableLines.add(line);
    } else if (node.type === "html" || node.type === "code") {
      hidden.push(node);
      if (node.type === "code" && unclosedFence === null && isUnclosedFence(text, node, starts)) {
        unclosedFence = rangeOf(node).startLine;
      }
    }
  });
  return { tables, strayRows: strayRowsOf(text, { hidden, tableLines }), unclosedFence };
}

export { collapse, parseTables, unclosedFenceMessage };
