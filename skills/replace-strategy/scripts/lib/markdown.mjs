// Markdown の表とコードフェンスを読む helper。このスキルの台帳の表を読むスクリプトが共通に使う。

import { stepFence } from "./fence.mjs";

/**
 * 空白を 1 つに畳み、前後を除く（Markdown の表はフォーマッタが桁を詰め直すため素の比較では揺れる）。
 * @param {string} value
 * @returns {string}
 */
function collapse(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/**
 * `| a | b |` を配列にする（表の行でなければ null）。
 * GFM はセル内の縦棒を `\|` で書くので、`\|` は列の区切りにせず、セルの値では `|` に戻す。
 * GFM は行頭・行末の `|` を必須にしないので、無くても表の行として読む。
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
 * コードスパンを閉じるバッククォートの直後の位置を返す（同じ行に無ければ -1）。
 * 閉じる側は、開く側と同じ数のバッククォートの並びに限る（CommonMark）。
 * @param {string} rest
 * @param {number} index 開くバッククォートの位置
 * @param {number} ticks 開くバッククォートの数
 * @returns {number}
 */
function codeSpanEnd(rest, index, ticks) {
  const run = /`+/gu;
  run.lastIndex = index + ticks;
  for (let m = run.exec(rest); m !== null; m = run.exec(rest)) {
    if (m[0].length === ticks) return m.index + ticks;
  }
  return -1;
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
 * コードスパンを開くバッククォートの並びを返す（無ければ null）。
 * エスケープされたバッククォートは文字として読み、並びの残りから開く（CommonMark）。
 * @param {string} rest
 * @returns {{ index: number, ticks: number } | null}
 */
function codeSpanStart(rest) {
  const run = /`+/gu;
  for (let m = run.exec(rest); m !== null; m = run.exec(rest)) {
    if (!escapedAt(rest, m.index)) return { index: m.index, ticks: m[0].length };
    if (m[0].length > 1) return { index: m.index + 1, ticks: m[0].length - 1 };
  }
  return null;
}

/**
 * 1 行の中で閉じたコメントの終わりの位置（`-->` の直後）を返す（同じ行で閉じなければ -1）。
 * CommonMark 0.31 では、`<!-->` と `<!--->` もそれだけで閉じたコメントである。
 * @param {string} rest
 * @param {number} start `<!--` の位置
 * @returns {number}
 */
function commentEnd(rest, start) {
  const body = rest.slice(start + 4);
  if (body.startsWith(">")) return start + 5;
  if (body.startsWith("->")) return start + 6;
  const close = body.indexOf("-->");
  return close < 0 ? -1 : start + 4 + close + 3;
}

/**
 * 行の途中のコメント（インラインのコメント）のうち、同じ行で閉じたものを空白に置き換える。
 * 同じ行で閉じない `<!--` は文字として読む。表や見出しは段落を中断するので、インラインのコメントは後ろの行の表を隠さない（GFM）。
 * コードスパンの中の `<!--` はコメントにしない。CommonMark と同じく、先に始まった方を採る。
 * バックスラッシュを付けた `\<!--` と `` \` `` は、コメントとコードスパンの始まりにしない。
 * @param {string} line
 * @returns {string}
 */
function blankInlineComments(line) {
  let out = "";
  let rest = line;
  for (;;) {
    const start = rest.indexOf("<!--");
    if (start < 0) return out + rest;
    const code = codeSpanStart(rest);
    if (code !== null && code.index < start) {
      // 閉じるバッククォートが同じ行に無ければ、バッククォートを文字として読み、その後ろから探し続ける。
      const end = codeSpanEnd(rest, code.index, code.ticks);
      const stop = end < 0 ? code.index + code.ticks : end;
      out += rest.slice(0, stop);
      rest = rest.slice(stop);
      continue;
    }
    if (escapedAt(rest, start)) {
      // `\<!--` は文字として読む（CommonMark のバックスラッシュのエスケープ）。
      out += rest.slice(0, start + 4);
      rest = rest.slice(start + 4);
      continue;
    }
    const end = commentEnd(rest, start);
    if (end < 0) return out + rest;
    out += rest.slice(0, start) + " ".repeat(end - start);
    rest = rest.slice(end);
  }
}

/**
 * 行が HTML コメントのブロックを開くか（行頭の `<!--`。字下げは 3 文字まで。4 文字以上は字下げのコードブロック）を返す。
 * @param {string} line
 * @returns {boolean}
 */
function opensHtmlBlock(line) {
  return /^ {0,3}<!--/u.test(line);
}

/**
 * HTML コメントを、改行を保ったまま空白に置き換える（行の対応は変えない）。
 * 行頭（字下げ 3 文字まで）の `<!--` は HTML ブロックを開く（CommonMark）。
 * ブロックは `-->` を含む行で終わり、その行の残りもブロックに入るので、行ごと空白にする。閉じなければ末尾まで続く。
 * 行の途中の `<!--` は、同じ行で閉じるときだけコメントにする（blankInlineComments）。
 * コードフェンスの中は例示なので置き換えない（フェンスの中の `<!--` で、以降の表を消さないため）。
 * コメントの中のフェンス行はフェンスとして扱わない。
 * fenced を渡すと、各行がフェンスの記号の行かフェンスの中か（true）を入れる。
 * フェンスは置き換える前の行で判定するので、呼び出し側は置き換えた後の行でフェンスを判定し直さず、fenced を使う。
 * 置き換えた後の行で判定し直すと、` ```<!-- ` --> ` のようにコメントを空白にして初めてフェンスに見える行で開いてしまう。
 * state を渡すと、末尾まで閉じないフェンスを開いた行の番号（1 始まり。閉じていれば null）を unclosedFence に入れる。
 * @param {string[]} lines
 * @param {boolean[]} [fenced]
 * @param {{ unclosedFence: number | null }} [state]
 * @returns {string[]}
 */
function blankComments(lines, fenced, state) {
  /** @type {string | null} */
  let fence = null;
  /** @type {number | null} */
  let openedAt = null;
  let block = false;
  const blanked = lines.map((line, index) => {
    if (fenced !== undefined) fenced[index] = false;
    if (block) {
      if (line.includes("-->")) block = false;
      return " ".repeat(line.length);
    }
    const step = stepFence(fence, line);
    if (fence === null && step.fence !== null) openedAt = index + 1;
    fence = step.fence;
    if (step.marker || fence !== null) {
      if (fenced !== undefined) fenced[index] = true;
      return line;
    }
    if (opensHtmlBlock(line)) {
      block = !line.includes("-->");
      return " ".repeat(line.length);
    }
    return blankInlineComments(line);
  });
  if (state !== undefined) state.unclosedFence = fence === null ? null : openedAt;
  return blanked;
}

/**
 * 表に属さないのに `|` を含む行（見出しに見えるが、次の行が区切り行でない行）。
 * @typedef {{ line: number, cells: number, leadingPipe: boolean }} StrayRow
 */

/**
 * Markdown の表を全て取り出す。コードフェンスの中は例示なので読まない。
 * 区切り行のハイフンは GFM では 1 個以上（3 個以上を要求すると `|-|-|` の表を読み落とす）。
 *
 * HTML コメントの中の表は読まない（コメントアウトして残した行を、台帳の行として数えない）。
 * 表の行の途中のフェンス行（`|` を含むものも）で、表を終える（GFM と同じ）。
 *
 * 表に属さないのに `|` を含む行は、警告なしに捨てず、行番号・セル数・行頭の `|` の有無を strayRows に返す
 * （GFM は行頭・行末の `|` を省けるので、行頭の `|` だけでは表の行を見分けられない）。
 * 末尾まで閉じないフェンス（閉じる行に情報文字列を付けた ` ```sh ` など）は、開いた行の番号を unclosedFence に返す。
 * フェンスの後ろの表はすべて読まれないので、呼び出し側は台帳を読まずに止める。
 * @param {string} text
 * @param {{ normalizeHeader?: (cell: string) => string, consumed?: Set<number> }} [options]
 *   normalizeHeader は見出しのセルの正規化（デフォルトは collapse）。consumed を渡すと、表として読んだ行（見出し・区切り・行）の行番号（0 始まり）を入れる
 * @returns {{ tables: { headers: string[], rows: string[][], rowLines: number[] }[], strayRows: StrayRow[], unclosedFence: number | null }}
 *   rowLines は各行のファイル上の行番号（1 始まり。エラー文で行を指せるように）
 */
function parseTables(text, options = {}) {
  const { normalizeHeader = collapse, consumed } = options;
  /** @type {boolean[]} */
  const fenced = [];
  /** @type {{ unclosedFence: number | null }} */
  const state = { unclosedFence: null };
  const lines = blankComments(text.split(/\r?\n/u), fenced, state);
  /** @type {{ headers: string[], rows: string[][], rowLines: number[] }[]} */
  const tables = [];
  /** @type {StrayRow[]} */
  const strayRows = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (fenced[i]) continue;
    const header = splitRow(lines[i]);
    if (header === null) continue;
    const delimiter = splitRow(lines[i + 1]);
    if (
      delimiter === null ||
      !delimiter.every((cell) => /^:?-+:?$/u.test(cell.trim())) ||
      delimiter.length !== header.length
    ) {
      strayRows.push({
        line: i + 1,
        cells: header.length,
        leadingPipe: lines[i].trim().startsWith("|"),
      });
      continue;
    }
    /** @type {string[][]} */
    const rows = [];
    /** @type {number[]} */
    const rowLines = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      if (fenced[j]) break;
      const row = splitRow(lines[j]);
      if (row === null) break;
      rows.push(row);
      rowLines.push(j + 1);
    }
    tables.push({ headers: header.map(normalizeHeader), rows, rowLines });
    if (consumed !== undefined) for (let k = i; k < j; k += 1) consumed.add(k);
    i = j - 1;
  }
  return { tables, strayRows, unclosedFence: state.unclosedFence };
}

/**
 * 閉じないフェンスを、利用者に返すエラー文にする（3 つのスクリプトで同じ文にする）。
 * @param {number} line
 * @returns {string}
 */
function unclosedFenceMessage(line) {
  return `${line} 行目で開いたコードフェンスが末尾まで閉じていない（閉じる行は、開いた記号と同じ記号を同じ数以上だけ書き、情報文字列を付けない。リストの項目と引用の中のフェンスは読めないので、その外に書く。以降の表が読まれない）`;
}

export { blankComments, opensHtmlBlock, collapse, parseTables, splitRow, unclosedFenceMessage };
