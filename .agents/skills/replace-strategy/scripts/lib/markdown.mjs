// Markdown の表とコードフェンスを読む helper。このスキルの台帳の表を読むスクリプトが共通に使う。

/**
 * 空白を 1 つに畳み、前後を除く（Markdown の表はフォーマッタが桁を詰め直すため素の比較では揺れる）。
 * @param {string} value
 * @returns {string}
 */
function collapse(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/**
 * コードフェンスの開始／終了記号を返す（フェンス行でなければ null）。
 * @param {string | undefined} line
 * @returns {string | null}
 */
function fenceOf(line) {
  if (line === undefined) return null;
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  return match === null ? null : match[1];
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
 * 行の途中で開いたコメント（インラインのコメント）が、段落の中で閉じるかを返す。
 * CommonMark では、インラインのコメントは段落の終わり（空行・フェンス行）を越えない。
 * 閉じない `<!--` は文字として読まれ、以降の表を隠さない。
 * @param {string[]} lines
 * @param {number} index `<!--` がある行の番号（0 始まり）
 * @param {string} tail 同じ行の `<!--` より後ろ
 * @returns {boolean}
 */
function closesInParagraph(lines, index, tail) {
  if (tail.includes("-->")) return true;
  for (let k = index + 1; k < lines.length; k += 1) {
    if (lines[k].trim() === "" || fenceOf(lines[k]) !== null) return false;
    if (lines[k].includes("-->")) return true;
  }
  return false;
}

/**
 * HTML コメントを、改行を保ったまま空白に置き換える（行の対応は変えない）。
 * コードフェンスの中は例示なので置き換えない（フェンスの中の `<!--` で、以降の表を消さないため）。
 * 同じ理由で、1 行の中のコードスパンの中の `<!--` もコメントの始まりにしない。
 * コメントの中のフェンス行はフェンスとして扱わない。
 * 行頭（字下げ 3 文字まで）の `<!--` は HTML ブロックを開き、閉じていなければ末尾まで置き換える（CommonMark）。
 * 行の途中の `<!--` は、段落の中で `-->` が来るときだけコメントにする（閉じなければ文字として読む）。
 * @param {string[]} lines
 * @returns {string[]}
 */
function blankComments(lines) {
  /** @type {string | null} */
  let fence = null;
  let comment = false;
  return lines.map((line, index) => {
    if (!comment) {
      const mark = fenceOf(line);
      if (mark !== null) {
        if (fence === null) fence = mark;
        else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
        return line;
      }
      if (fence !== null) return line;
    }
    let out = "";
    let rest = line;
    while (rest !== "") {
      if (comment) {
        const end = rest.indexOf("-->");
        if (end < 0) {
          out += " ".repeat(rest.length);
          rest = "";
        } else {
          out += " ".repeat(end + 3);
          rest = rest.slice(end + 3);
          comment = false;
        }
      } else {
        const start = rest.indexOf("<!--");
        const code = /`+/u.exec(rest);
        if (start < 0) {
          out += rest;
          rest = "";
        } else if (code !== null && code.index < start) {
          // コードスパン（`<!--` の説明など）の中はコメントにしない。CommonMark と同じく、先に始まった方を採る。
          // 閉じるバッククォートが同じ行に無ければ、バッククォートを文字として読み、その後ろから探し続ける。
          const end = codeSpanEnd(rest, code.index, code[0].length);
          const stop = end < 0 ? code.index + code[0].length : end;
          out += rest.slice(0, stop);
          rest = rest.slice(stop);
        } else if (
          (out !== "" || !/^ {0,3}$/u.test(rest.slice(0, start))) &&
          !closesInParagraph(lines, index, rest.slice(start + 4))
        ) {
          // 行の途中で開き、段落の中で閉じない `<!--` は文字として読む（以降の表の行を警告なしに消さない）。
          out += rest.slice(0, start + 4);
          rest = rest.slice(start + 4);
        } else {
          out += rest.slice(0, start) + "    ";
          rest = rest.slice(start + 4);
          comment = true;
        }
      }
    }
    return out;
  });
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
 * @param {string} text
 * @param {{ normalizeHeader?: (cell: string) => string, consumed?: Set<number> }} [options]
 *   normalizeHeader は見出しのセルの正規化（デフォルトは collapse）。consumed を渡すと、表として読んだ行（見出し・区切り・行）の行番号（0 始まり）を入れる
 * @returns {{ tables: { headers: string[], rows: string[][], rowLines: number[] }[], strayRows: StrayRow[] }}
 *   rowLines は各行のファイル上の行番号（1 始まり。エラー文で行を指せるように）
 */
function parseTables(text, options = {}) {
  const { normalizeHeader = collapse, consumed } = options;
  const lines = blankComments(text.split(/\r?\n/u));
  /** @type {{ headers: string[], rows: string[][], rowLines: number[] }[]} */
  const tables = [];
  /** @type {StrayRow[]} */
  const strayRows = [];
  /** @type {string | null} */
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const mark = fenceOf(lines[i]);
    if (mark !== null) {
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
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
      if (fenceOf(lines[j]) !== null) break;
      const row = splitRow(lines[j]);
      if (row === null) break;
      rows.push(row);
      rowLines.push(j + 1);
    }
    tables.push({ headers: header.map(normalizeHeader), rows, rowLines });
    if (consumed !== undefined) for (let k = i; k < j; k += 1) consumed.add(k);
    i = j - 1;
  }
  return { tables, strayRows };
}

export { collapse, fenceOf, parseTables, splitRow };
