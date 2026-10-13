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
 * 表に属さないのに `|` を含む行（見出しに見えるが、次の行が区切り行でない行）。
 * @typedef {{ line: number, cells: number, leadingPipe: boolean }} StrayRow
 */

/**
 * Markdown の表を全て取り出す。コードフェンスの中は例示なので読まない。
 * 区切り行のハイフンは GFM では 1 個以上（3 個以上を要求すると `|-|-|` の表を読み落とす）。
 *
 * HTML コメントの扱いは呼び出し元が選ぶ（台帳の書式に合わせて、読み飛ばしの規則を変えないため）。
 * - `keep`（デフォルト）: コメントを区別しない
 * - `blank`: コメントを改行を保ったまま空白に置き換えてから読む（行の対応は変えない。閉じていないコメントは末尾まで）
 * - `skip-lines`: フェンスの外で `<!--` で始まる行から、`-->` を含む行までを読み飛ばす
 *
 * fenceEndsTable が真なら、表の行の途中のフェンス行（`|` を含むものも）で表を終える。
 * 偽（デフォルト）なら、表の行として読めない行（`|` を含まない行）でだけ終える。
 *
 * 表に属さないのに `|` を含む行は、警告なしに捨てず、行番号・セル数・行頭の `|` の有無を strayRows に返す
 * （GFM は行頭・行末の `|` を省けるので、行頭の `|` だけでは表の行を見分けられない）。
 * @param {string} text
 * @param {{ comments?: "keep" | "blank" | "skip-lines", fenceEndsTable?: boolean, normalizeHeader?: (cell: string) => string, consumed?: Set<number> }} [options]
 *   normalizeHeader は見出しのセルの正規化（デフォルトは collapse）。consumed を渡すと、表として読んだ行（見出し・区切り・行）の行番号（0 始まり）を入れる
 * @returns {{ tables: { headers: string[], rows: string[][], rowLines: number[] }[], strayRows: StrayRow[] }}
 *   rowLines は各行のファイル上の行番号（1 始まり。エラー文で行を指せるように）
 */
function parseTables(text, options = {}) {
  const {
    comments = "keep",
    fenceEndsTable = false,
    normalizeHeader = collapse,
    consumed,
  } = options;
  const source =
    comments === "blank"
      ? text.replace(/<!--[\s\S]*?(?:-->|$)/gu, (m) => m.replace(/[^\n]/gu, " "))
      : text;
  const lines = source.split(/\r?\n/u);
  /** @type {{ headers: string[], rows: string[][], rowLines: number[] }[]} */
  const tables = [];
  /** @type {StrayRow[]} */
  const strayRows = [];
  /** @type {string | null} */
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (
      comments === "skip-lines" &&
      fence === null &&
      (comment || lines[i].trim().startsWith("<!--"))
    ) {
      comment = !lines[i].includes("-->");
      continue;
    }
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
      if (fenceEndsTable && fenceOf(lines[j]) !== null) break;
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
