// CSV の読み書き（RFC 4180）。区切りは `,`、改行は `\n` で書き、読むときは `\r\n` も受け付ける。
// 値に `,`・`"`・改行を含むときだけ `"` で囲み、`"` は `""` にする。

/**
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * =・+・-・@ で始まる値（数を除く）の先頭に ' を付け、表計算ソフトが数式として実行しないようにする。
 * ブランチ名・PR の作者・check の名前など、他の人が決められる値が入るため。
 * @param {string} value
 * @returns {string}
 */
export function formulaSafe(value) {
  return /^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
}

/**
 * 列の順を決めて行を CSV にする。行に無い列は空にする。
 * @param {readonly string[]} columns
 * @param {readonly Record<string, string | number | boolean | null | undefined>[]} rows
 * @param {{ formulaSafe?: boolean }} [opts] formulaSafe: 表計算ソフトで開く CSV（report の出力）で、数式として読まれる値を文字列にする
 * @returns {string}
 */
export function toCsv(columns, rows, opts = {}) {
  const lines = [columns.map(quote).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = row[c];
          const text = v === undefined || v === null ? "" : String(v);
          return quote(opts.formulaSafe ? formulaSafe(text) : text);
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** @typedef {{ records: string[][]; fields: string[]; field: string; inQuotes: boolean }} CsvState */

/**
 * 引用符の中の 1 文字を読み、次に読む位置を返す。`""` は `"` 1 文字にし、それ以外の `"` で引用符を閉じる。
 * @param {string} text
 * @param {number} i
 * @param {CsvState} st
 * @returns {number}
 */
function stepInQuotes(text, i, st) {
  const ch = text[i];
  if (ch !== '"') {
    st.field += ch;
    return i + 1;
  }
  if (text[i + 1] === '"') {
    st.field += '"';
    return i + 2;
  }
  st.inQuotes = false;
  return i + 1;
}

/**
 * 引用符の外の 1 文字を読み、次に読む位置を返す。
 * @param {string} text
 * @param {number} i
 * @param {CsvState} st
 * @returns {number}
 */
function stepOutsideQuotes(text, i, st) {
  const ch = text[i];
  if (ch === '"' && st.field === "") {
    st.inQuotes = true;
    return i + 1;
  }
  if (ch === ",") {
    st.fields.push(st.field);
    st.field = "";
    return i + 1;
  }
  if (ch === "\n" || ch === "\r") {
    st.fields.push(st.field);
    st.records.push(st.fields);
    st.fields = [];
    st.field = "";
    return i + (ch === "\r" && text[i + 1] === "\n" ? 2 : 1);
  }
  st.field += ch;
  return i + 1;
}

/**
 * CSV を、行ごとの値の配列にする。閉じていない引用符はエラーにする。
 * @param {string} text
 * @returns {string[][]}
 */
function splitRecords(text) {
  /** @type {CsvState} */
  const st = { records: [], fields: [], field: "", inQuotes: false };
  let i = 0;
  // どちらの関数も、次に読む位置を 1 か 2 進めて返すので、ループは必ず終わる
  while (i < text.length) {
    i = st.inQuotes ? stepInQuotes(text, i, st) : stepOutsideQuotes(text, i, st);
  }
  if (st.inQuotes) throw new Error("CSV の引用符が閉じていない");
  if (st.field !== "" || st.fields.length > 0) {
    st.fields.push(st.field);
    st.records.push(st.fields);
  }
  return st.records;
}

/**
 * CSV を、1 行目を見出しにしたオブジェクトの配列にする。見出しに無い列を持つ行と、閉じていない引用符はエラーにする。
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const nonEmpty = splitRecords(text).filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return [];
  const [header, ...body] = nonEmpty;
  return body.map((r, n) => {
    if (r.length !== header.length) {
      throw new Error(
        `CSV の ${n + 2} 行目の列数（${r.length}）が見出し（${header.length}）と違う`,
      );
    }
    /** @type {Record<string, string>} */
    const obj = {};
    header.forEach((h, k) => {
      obj[h] = r[k];
    });
    return obj;
  });
}
