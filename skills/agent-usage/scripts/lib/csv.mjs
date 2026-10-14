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
 * 列の順を決めて行を CSV にする。行に無い列は空にする。
 * @param {readonly string[]} columns
 * @param {readonly Record<string, string | number | boolean | null | undefined>[]} rows
 * @returns {string}
 */
export function toCsv(columns, rows) {
  const lines = [columns.map(quote).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = row[c];
          return quote(v === undefined || v === null ? "" : String(v));
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * CSV を、1 行目を見出しにしたオブジェクトの配列にする。見出しに無い列を持つ行と、閉じていない引用符はエラーにする。
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let fields = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      fields.push(field);
      records.push(fields);
      fields = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) throw new Error("CSV の引用符が閉じていない");
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    records.push(fields);
  }
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
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
