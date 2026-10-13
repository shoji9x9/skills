// Markdown の表とコードフェンスを読む helper。

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

export { collapse, fenceOf, splitRow };
