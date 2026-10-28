// 参照表の役割と行数を、すべての消費側から決めるための検査（原本）。
//
// 何のためか: データ設計は「入れたものが入ったか」までしか数えていない。
// **「入れたもので現行のどの分岐が踏めるか」を数える段が無い**ので、
// 踏めない分岐は下流（parity-suite / parity-replace）が「観測できない」に当たってから分かる。
// そのときにはベースラインを採り終えているので、行を足すと version が上がり、交差する slug の採取物が古くなる。
//
// この検査は、次の 4 つを失敗にする。
//   1. 転記の抜け。`.replace/features.md` の 3 表（機能一覧「テーブル」・横断 API「参照テーブル」・バッチ「参照テーブル」）に
//      在る (テーブル, slug) が、`design.md`「対象テーブル」表に転記されていない。転記が抜けると
//      「どの機能もこの表を読まない」と読める。すると役割が「読み取りだけ」と判定され、行数を増やす検討に入らない。
//   2. 役割の矛盾。消費側の slug が 1 つでも在るのに役割が「読み取りだけ」。
//      役割は**消費するかどうか**で決まる（`JOIN` で引くか `FROM` の母集合として引くかは関係がない）。
//   3. 踏めない分岐。参照表の件数が 0 / 1、または述語の真・偽どちらかの該当行数が 0。
//      0 件では真の分岐へ入れない。1 件では絞り込みを外しても結果が変わらない（絞り込みが機能していることを観測できない）。
//      踏めない分岐は、「足す」か「gaps に記録」かを**設計の段で**選ばせる（足すと版が上がるので、選ぶのは判断であってデフォルトの値ではない）。
//   4. 変換で値が変わる識別子。次のどれかに当たる。
//      - データセットが決めた識別子の値（採番帯）が、消費側の変換（整数への変換・桁の切り詰め・型の上限）の後に
//        同じ値で届くかを、消費側ごとに列挙していない
//      - 述語の「値の出どころ」が無い
//      - 届かないと記録した値の述語を「踏める」と数えている
//
// 乱数・現在時刻・ネットワークに依存しない。読むのは Markdown だけで、DB へは接続しない
// （投入した後の実測の件数は、`verification.md` に書かれたものを読む）。TypeScript の構文は使わない（型は JSDoc で書く）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 不備が残る（設計へ戻す）、2 ＝ 使い方の誤り・表が読めない。

import { resolve } from "node:path";
import { cliIo, parseFlagPairs, usageFailer, writeCheckResult } from "./lib/check-cli.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { stepFence, unclosedFenceMessage } from "./lib/fence.mjs";
import { isArray } from "./lib/is-array.mjs";

/**
 * ツールのバージョン（原本）。判定の規則や出力の形を変えたら上げる。
 *
 * @type {string}
 */
export const VERSION = "4";

/**
 * 役割の語彙（原本）。
 *
 * `FK 親のみ` は、**消費側がどの表からも直接読まないが、FK を満たすために投入が要る親表**である
 * （`orders` の背後の `customers` など）。`投入する` にすると「消費側が居ない」で失敗し、
 * `読み取りだけ` にすると投入の対象から外れて FK を満たせない。どちらも事実と違うので、別の語にする。
 */
export const ROLES = ["投入する", "読み取りだけ", "FK 親のみ"];

/**
 * 述語の表の見出し。先頭が新しい名前で、続くのは改名する前の名前（旧称）。
 * 既に書かれた design.md を書き直さずに判定できるよう、旧称も同じ表として読む。警告は出さない。
 */
// 旧称の見出しは改名前の design.md を読むために残す。
// textlint-disable
export const PREDICATE_TABLE_HEADINGS = ["述語ごとの分岐網羅", "述語ごとの分岐被覆"];
// textlint-enable

/** 踏めない分岐の扱いの語彙（原本）。 */
export const DISPOSITIONS = ["足す", "gaps に記録"];

/** 識別子の値が、消費側の変換の後も同じ値で届くかの語彙（原本）。 */
export const ID_REACH = ["届く", "届かない"];

/**
 * 変換の後に届かない識別子の扱いの語彙（原本）。
 * 「帯を変える」は語彙に入れない。変えたなら、表は変えた後の帯で書き直すので「届く」になる。
 */
export const ID_DISPOSITIONS = ["行を足す", "gaps に記録"];

/** 「読むテーブル無し」の sentinel（replace-strategy で定義する）。 */
const NONE_SENTINEL = "-";

/**
 * セルの表記ゆれを畳む。コード引用（`）・強調（*）・全角空白・前後の空白を落とす。
 *
 * **`_` は落とさない**。`_` は識別子（`order_items`）の一部であり、落とすと別のテーブル名
 * （`orders_2024` と `orders2024`）が同じ鍵に潰れる。`_` による強調は表のセルでは使わない。
 *
 * @param {string} cell
 * @returns {string}
 */
export function normalizeCell(cell) {
  return String(cell ?? "")
    .replace(/　/g, " ")
    .replace(/[`*]/g, "")
    .trim();
}

/**
 * 各行がフェンスの記号の行かフェンスの中か（true）と、末尾まで閉じないフェンスを開いた行の番号（1 始まり。閉じていれば null）を返す。
 * 行頭（字下げ 3 文字まで）の `<!--` で開いて閉じない HTML コメントの中では、フェンス行でフェンスを開かない。
 * 開くと、コメントの中の記入例の ``` で、コメントの後ろの表がすべて消える。
 * コメントの中の表と見出しは読む（replace-strategy の台帳と違い、コメントの中を除かない）。
 *
 * @param {string[]} lines
 * @returns {{ fenced: boolean[], unclosed: number | null }}
 */
function fenceLines(lines) {
  /** @type {boolean[]} */
  const fenced = [];
  /** @type {string | null} */
  let fence = null;
  /** @type {number | null} */
  let openedAt = null;
  let comment = false;
  lines.forEach((line, index) => {
    if (comment) {
      if (line.includes("-->")) comment = false;
      fenced.push(false);
      return;
    }
    const step = stepFence(fence, line);
    if (fence === null && step.fence !== null) openedAt = index + 1;
    fence = step.fence;
    const inFence = step.marker || fence !== null;
    if (!inFence && /^ {0,3}<!--/u.test(line)) {
      // `<!-->` と `<!--->` も、それだけで閉じたコメントになる（CommonMark）。
      comment = !line.includes("-->");
    }
    fenced.push(inFence);
  });
  return { fenced, unclosed: fence === null ? null : openedAt };
}

/**
 * 末尾まで閉じないコードフェンスを開いた行の番号を返す（閉じていれば null）。
 * 閉じる行の形が合わないと（情報文字列を付けた ` ```sh `、4 文字以上の字下げ、短い記号など）フェンスは閉じず、後ろの表がすべて読まれない。
 *
 * @param {string} markdown
 * @returns {number | null}
 */
export function unclosedFenceLine(markdown) {
  return fenceLines(String(markdown ?? "").split(/\r?\n/)).unclosed;
}

/**
 * @typedef {{ heading: string, headers: string[], rows: string[][], line: number }} Table
 * @typedef {{ code: string, message: string }} Finding
 */

/**
 * 表の 1 行をセルに分ける。
 *
 * **エスケープされたパイプ（`\|`）はセルの区切りではない**。境界として割ると列がずれ、
 * 正当な設計が「件数が読めない」等の無関係な finding で落ちる。
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  const trimmed = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  /** @type {string[]} */
  const cells = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((c) => normalizeCell(c));
}

/**
 * 表の区切り行（`---`）か。
 *
 * @param {string} line
 * @returns {boolean}
 */
function isSeparatorRow(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

/**
 * `start` の行から、行頭が `|` でなくなるまでを表の本体の行として集める。
 *
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ rows: string[][], end: number }} end は表の次の行の index
 */
function readTableRows(lines, start) {
  /** @type {string[][]} */
  const rows = [];
  let j = start;
  while (j < lines.length && lines[j].trim().startsWith("|")) {
    rows.push(splitTableRow(lines[j]));
    j += 1;
  }
  return { rows, end: j };
}

/**
 * Markdown のパイプ表を見出しごとに集める。
 *
 * 行頭が `|` の連続した塊のうち、2 行目が区切り行（`---`）であるものだけを表として扱う。
 * コードフェンスの中は例示なので、表も見出しも読まない（フェンスの判定は lib/fence.mjs）。
 *
 * @param {string} markdown
 * @returns {Table[]}
 */
export function parseTables(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  /** @type {Table[]} */
  const tables = [];
  let heading = "";
  let i = 0;
  const { fenced } = fenceLines(lines);
  while (i < lines.length) {
    const line = lines[i];
    if (fenced[i]) {
      i += 1;
      continue;
    }
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = normalizeCell(headingMatch[1]);
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headers = splitTableRow(line);
      const { rows, end } = readTableRows(lines, i + 2);
      tables.push({ heading, headers, rows, line: i + 1 });
      i = end;
      continue;
    }
    i += 1;
  }
  return tables;
}

/**
 * 見出しの前方一致と必須の列名から表を 1 つ引く。
 *
 * @param {{ heading: string, headers: string[], rows: string[][], line: number }[]} tables
 * @param {string | string[]} heading 見出しの前方一致の候補（どれかに一致すればよい）
 * @param {string[]} requiredHeaders
 * @returns {{ heading: string, headers: string[], rows: string[][], line: number } | null}
 */
export function findTable(tables, heading, requiredHeaders) {
  const headings = isArray(heading) ? heading : [heading];
  return (
    tables.find(
      (t) =>
        headings.some((h) => t.heading.startsWith(h)) &&
        requiredHeaders.every((h) => t.headers.includes(h)),
    ) ?? null
  );
}

/**
 * 行を列名で引ける形にする。
 *
 * @param {{ headers: string[], rows: string[][] }} table
 * @returns {Record<string, string>[]}
 */
export function rowsAsRecords(table) {
  return table.rows.map((cells) => {
    /** @type {Record<string, string>} */
    const record = {};
    table.headers.forEach((h, idx) => {
      record[h] = cells[idx] ?? "";
    });
    return record;
  });
}

/**
 * 一覧セル（`orders, order_items` / `-` / 空欄）を読む。
 *
 * **空欄と `-` を同じに扱わない**。空欄は「まだ調べていない」で、`-` だけが「調べた結果ゼロ件」。
 *
 * @param {string} cell
 * @returns {{ kind: "blank" | "none" | "items", items: string[] }}
 */
export function splitList(cell) {
  const value = normalizeCell(cell);
  if (value === "") return { kind: "blank", items: [] };
  if (value === NONE_SENTINEL) return { kind: "none", items: [] };
  const items = splitTopLevel(value)
    .map((v) => normalizeCell(v))
    .filter((v) => v !== "" && v !== NONE_SENTINEL);
  if (items.length === 0) return { kind: "blank", items: [] };
  return { kind: "items", items };
}

/**
 * 1 文字読んで引用符と括弧の深さを進め、その文字が引用符・括弧の外の区切り（`,` `、` `／` `/`）かを返す。
 *
 * @param {{ depth: number, quote: string | null }} scan - 読んでいる位置の状態（この関数が更新する）
 * @param {string} char
 * @returns {boolean}
 */
function advanceToSeparator(scan, char) {
  if (scan.quote !== null) {
    if (char === scan.quote) scan.quote = null;
    return false;
  }
  if (char === "'" || char === '"' || char === "`") {
    scan.quote = char;
    return false;
  }
  if (char === "(" || char === "（") {
    scan.depth += 1;
    return false;
  }
  if (char === ")" || char === "）") {
    if (scan.depth > 0) scan.depth -= 1;
    return false;
  }
  return scan.depth === 0 && (char === "," || char === "、" || char === "／" || char === "/");
}

/**
 * 区切り（`,` `、` `／` `/`）で分けるが、**引用符・括弧の内側では分けない**。
 *
 * 条件の中の区切りで割ると、`status IN ('pending','canceled')` が誤って 2 件の絞り込みと判定される。
 * すると、正しく列挙した設計が「述語行が無い」として失敗する（exit 0 に到達できない誤検知）。
 *
 * @param {string} value
 * @returns {string[]}
 */
export function splitTopLevel(value) {
  /** @type {string[]} */
  const parts = [];
  let current = "";
  /** @type {{ depth: number, quote: string | null }} */
  const scan = { depth: 0, quote: null };
  for (const char of value) {
    if (advanceToSeparator(scan, char)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * 述語の文面が指定の列を**識別子として**含むか。
 *
 * **部分文字列で見ない**。`owner_id = :me` は `id` を部分文字列として含むので、
 * `id, owner_id` のように一方が他方の一部になる列名の組では、片方の分岐が数えられていなくても通る。
 * 前後が識別子を構成しない文字（英数字・`_` 以外）であることまで確かめる。
 *
 * @param {string} predicateText
 * @param {string} column
 * @returns {boolean}
 */
export function namesColumn(predicateText, column) {
  if (column === "") return false;
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(predicateText);
}

/**
 * 絞り込みの記述から列名を取り出す。読めなければ null。
 *
 * 先頭の括弧と引用符は剥がしてから読む（`(owner_id = :me)` のような形で
 * 先頭のトークンが空になると、その列の分岐が警告なしに数えられなくなる）。
 *
 * **区切りは先頭で剥がす記号と対称に持つ。** 開き側だけを区切りにすると、
 * 囲んだ形（`(status)` / `「status」` / `"status"`）で閉じ側が列名の一部として残り、
 * 実在しない列名で述語行を探すことになる（半角の `)` が欠けていた）。
 *
 * @param {string} filter
 * @returns {string | null}
 */
export function filterColumn(filter) {
  const stripped = normalizeCell(filter).replace(/^[\s(（「『"'`]+/, "");
  const column = stripped.split(/[\s=<>!,()（）「」『』"'`]/)[0];
  return column === "" ? null : column;
}

/**
 * 列と述語行を 1 対 1 で対応づける（二部マッチング。Kuhn の増加路法）。
 *
 * **行の再利用を許さない**。1 行が複数の列の文面を含むと、その 1 行で複数の絞り込みを
 * 満たしたことになり、真・偽の行数は結合した条件のものしか表さない。
 * 貪欲だと「後の列が使える行を先の列が取る」形で取りこぼすので、増加路で全体の最大マッチングを取る。
 *
 * @param {string[]} columns
 * @param {string[]} predicateTexts
 * @returns {number[]} 列ごとの割り当て先 index（未割り当ては -1）
 */
export function matchColumnsToRows(columns, predicateTexts) {
  /** @type {number[]} */
  const rowToColumn = Array.from({ length: predicateTexts.length }, () => -1);
  /**
   * @param {number} columnIndex
   * @param {Set<number>} visited
   * @returns {boolean}
   */
  const tryAssign = (columnIndex, visited) => {
    for (let rowIndex = 0; rowIndex < predicateTexts.length; rowIndex += 1) {
      if (visited.has(rowIndex)) continue;
      if (!namesColumn(predicateTexts[rowIndex], columns[columnIndex])) continue;
      visited.add(rowIndex);
      if (rowToColumn[rowIndex] === -1 || tryAssign(rowToColumn[rowIndex], visited)) {
        rowToColumn[rowIndex] = columnIndex;
        return true;
      }
    }
    return false;
  };
  columns.forEach((_column, columnIndex) => {
    tryAssign(columnIndex, new Set());
  });
  /** @type {number[]} */
  const assignment = Array.from({ length: columns.length }, () => -1);
  rowToColumn.forEach((columnIndex, rowIndex) => {
    if (columnIndex !== -1) assignment[columnIndex] = rowIndex;
  });
  return assignment;
}

/**
 * 件数セルを読む。数値でなければ null（型崩れとして扱う）。
 *
 * @param {string} cell
 * @returns {number | null}
 */
export function parseCount(cell) {
  const value = normalizeCell(cell).replace(/,/g, "");
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

/** features.md の 3 表と、各表で消費側が読むテーブルを並べる列。 */
const FEATURE_SOURCES = [
  { heading: "機能一覧", column: "テーブル", label: "機能一覧の「テーブル」列" },
  { heading: "横断 API", column: "参照テーブル", label: "横断 API の「参照テーブル」列" },
  { heading: "バッチ", column: "参照テーブル", label: "バッチの「参照テーブル」列" },
];

/**
 * `.replace/features.md` の 3 表から「テーブル → 消費側 slug の集合」を導く。
 *
 * 3 表のどれか 1 つでも読めなければ、**合格にしない**（読めた表だけで突き合わせると、
 * 読めなかった表にしか出てこないテーブルが、転記の抜けとして報告されない）。
 *
 * @param {string} featuresMarkdown
 * @returns {{ consumers: Map<string, Set<string>>, findings: {code:string, message:string}[], structural: boolean }}
 */
export function collectConsumers(featuresMarkdown) {
  const tables = parseTables(featuresMarkdown);
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  /** @type {Map<string, Set<string>>} */
  const consumers = new Map();
  let structural = false;
  const unclosed = unclosedFenceLine(featuresMarkdown);
  if (unclosed !== null) {
    structural = true;
    findings.push({
      code: "features-fence-unclosed",
      message: `features.md の ${unclosedFenceMessage(unclosed)}`,
    });
  }
  for (const source of FEATURE_SOURCES) {
    const table = findTable(tables, source.heading, ["slug", source.column]);
    if (!table) {
      structural = true;
      findings.push({
        code: "features-table-missing",
        message: `features.md に ${source.label} を持つ表が無い（読めた表だけで突き合わせない）`,
      });
      continue;
    }
    for (const row of rowsAsRecords(table)) {
      collectConsumerRow({ consumers, findings }, source, row);
    }
  }
  return { consumers, findings, structural };
}

/**
 * features.md の表の 1 行が挙げるテーブルを、そのテーブルの消費側 slug の集合へ足す。
 *
 * @param {{ consumers: Map<string, Set<string>>, findings: Finding[] }} acc
 * @param {{ column: string, label: string }} source
 * @param {Record<string, string>} row
 * @returns {void}
 */
function collectConsumerRow(acc, source, row) {
  const { consumers, findings } = acc;
  const slug = normalizeCell(row.slug);
  const list = splitList(row[source.column]);
  // **テーブルを挙げているのに slug が空の行を、警告なしに捨てない**。捨てるとその参照が突き合わせに入らず、
  // design.md からそのテーブルが丸ごと抜けていても、転記の抜けとして出なくなる。
  if (slug === "") {
    if (list.kind === "items") {
      findings.push({
        code: "features-slug-missing",
        message: `${source.label} に [${list.items.join(", ")}] を挙げている行があるが slug が空（どの消費側の参照か決まらず、転記の抜けの突き合わせに入らない）`,
      });
    }
    return;
  }
  if (list.kind === "blank") {
    findings.push({
      code: "features-reference-blank",
      message: `${source.label} が空欄（slug: ${slug}）。空欄は未調査であり「参照テーブル無し」ではない。replace-strategy 側で埋めてから設計する`,
    });
    return;
  }
  for (const tableName of list.items) {
    let tableConsumers = consumers.get(tableName);
    if (!tableConsumers) {
      tableConsumers = new Set();
      consumers.set(tableName, tableConsumers);
    }
    tableConsumers.add(slug);
  }
}

/**
 * @typedef {{ slugs: Set<string>, count: number | null, role: string }} DeclaredTable
 * @typedef {{
 *   findings: Finding[],
 *   consumers: Map<string, Set<string>>,
 *   declared: Map<string, DeclaredTable>,
 *   predicateRows: Record<string, string>[],
 *   predicatesByTable: Map<string, Record<string, string>[]>,
 * }} CheckContext 検査の段階が共有する入力と、finding を足す先
 * @typedef {{
 *   coveredPairs: Set<string>,
 *   noIdColumn: Set<string>,
 *   realColumnTables: Set<string>,
 *   seenIdKeys: Set<string>,
 *   unreachedGaps: { tableName: string, column: string, slugs: string[] }[],
 * }} IdRangeState 識別子の値の範囲の行を読みながら集める状態
 */

/** design.md「対象テーブル」表の必須の列。 */
const TARGET_TABLE_HEADERS = ["テーブル", "features.md の機能／リソース", "件数", "役割"];

/** design.md「述語ごとの分岐網羅」表の必須の列。 */
const PREDICATE_TABLE_COLUMNS = [
  "述語 id",
  "テーブル",
  "消費側 slug",
  "述語（列・条件）",
  "真の行数",
  "偽の行数",
  "判定",
  "扱い",
];

/** design.md「消費側パラメータ」表の必須の列。 */
const PARAM_TABLE_HEADERS = ["機能／リソース slug", "テーブル", "絞り込み列・条件"];

/** design.md「識別子の値の範囲」表の必須の列。 */
const ID_RANGE_TABLE_HEADERS = [
  "テーブル",
  "列",
  "データセットの値の範囲",
  "実運用の値の範囲",
  "消費側 slug",
  "受け取る型・変換",
  "届くか",
  "扱い",
  "根拠",
];

/** verification.md「述語ごとの該当行数」表の必須の列。 */
const MEASURED_TABLE_HEADERS = ["述語 id", "真の実測行数", "偽の実測行数"];

/**
 * 設計（と、渡されたなら検証記録）を突き合わせる。
 *
 * @param {{ featuresMarkdown: string, designMarkdown: string, verificationMarkdown?: string | null }} input
 * @returns {{ findings: {code:string, message:string}[], counts: Record<string, number>, structural: boolean }}
 */
export function checkPredicateCoverage(input) {
  const features = collectConsumers(input.featuresMarkdown);
  /** @type {Finding[]} */
  const findings = [...features.findings];
  const design = readDesignTables(input.designMarkdown, findings);
  const { targetTable, predicateTable } = design;
  if (features.structural || design.structural || !targetTable || !predicateTable) {
    return { findings, counts: { tables: 0, predicates: 0 }, structural: true };
  }
  const predicateRows = rowsAsRecords(predicateTable).filter(
    (row) => normalizeCell(row["述語 id"]) !== "",
  );
  /** @type {CheckContext} */
  const ctx = {
    findings,
    consumers: features.consumers,
    declared: readTargetTable(targetTable, findings),
    predicateRows,
    predicatesByTable: groupPredicatesByTable(predicateRows),
  };
  checkCopyMissing(ctx);
  checkDeclaredTables(ctx);
  checkTableRowCounts(ctx);
  checkPredicateRows(ctx, predicateTable);
  checkParamFilters(ctx, design.paramTable);
  checkParamPairs(ctx, design.paramTable);
  checkIdRanges(ctx, design.designTables);

  // 6. 投入後の実測件数（渡されたときだけ）
  //
  // **「渡していない」と「渡した中身が空」を書き分ける。** 空文字も分岐へ入れて表の不在として落とす。
  // 空を未指定に丸めると、verification.md を空で作った（あるいは書き出しに失敗した）場合に
  // 6 節の検査が丸ごと飛び、「実測していない」が「実測して問題なし」と同じ見え方になる。
  if (typeof input.verificationMarkdown === "string") {
    checkVerification(ctx, input.verificationMarkdown);
  }

  return {
    findings,
    counts: { tables: ctx.declared.size, predicates: predicateRows.length },
    structural: false,
  };
}

/**
 * design.md の表を読み、判定に要る表が無いことと、閉じないコードフェンスを構造の不備として足す。
 *
 * @param {string} designMarkdown
 * @param {Finding[]} findings
 * @returns {{ designTables: Table[], targetTable: Table | null, predicateTable: Table | null, paramTable: Table | null, structural: boolean }}
 */
function readDesignTables(designMarkdown, findings) {
  const designTables = parseTables(designMarkdown);
  let structural = false;
  const designUnclosed = unclosedFenceLine(designMarkdown);
  if (designUnclosed !== null) {
    structural = true;
    findings.push({
      code: "design-fence-unclosed",
      message: `design.md の ${unclosedFenceMessage(designUnclosed)}`,
    });
  }
  const targetTable = findTable(designTables, "対象テーブル", TARGET_TABLE_HEADERS);
  const predicateTable = findTable(designTables, PREDICATE_TABLE_HEADINGS, PREDICATE_TABLE_COLUMNS);
  const paramTable = findTable(designTables, "消費側パラメータ", PARAM_TABLE_HEADERS);
  if (!targetTable) {
    structural = true;
    findings.push({
      code: "design-target-table-missing",
      message:
        "design.md に「対象テーブル」表（テーブル / features.md の機能／リソース / 件数 / 役割）が無い",
    });
  }
  if (!predicateTable) {
    structural = true;
    findings.push({
      code: "design-predicate-table-missing",
      message:
        "design.md に「述語ごとの分岐網羅」表（述語 id / テーブル / 消費側 slug / 述語（列・条件） / 真の行数 / 偽の行数 / 判定 / 扱い）が無い",
    });
  }
  return { designTables, targetTable, predicateTable, paramTable, structural };
}

/**
 * 「対象テーブル」表を、テーブル名から消費側 slug の集合・件数・役割を引ける形にする。
 *
 * @param {Table} targetTable
 * @param {Finding[]} findings
 * @returns {Map<string, DeclaredTable>}
 */
function readTargetTable(targetTable, findings) {
  const targetRows = rowsAsRecords(targetTable).filter(
    (row) => normalizeCell(row["テーブル"]) !== "",
  );
  /** @type {Map<string, DeclaredTable>} */
  const declared = new Map();
  for (const row of targetRows) {
    const name = normalizeCell(row["テーブル"]);
    const list = splitList(row["features.md の機能／リソース"]);
    const role = normalizeCell(row["役割"]);
    const count = parseCount(row["件数"]);
    if (declared.has(name)) {
      findings.push({
        code: "design-table-duplicated",
        message: `対象テーブル表に ${name} の行が 2 つ以上ある（消費側 slug の集合が 1 つに決まらない）`,
      });
    }
    declared.set(name, { slugs: new Set(list.items), count, role });
    if (!ROLES.includes(role)) {
      findings.push({
        code: "role-vocabulary",
        message: `${name} の役割「${role || "（空欄）"}」は語彙外（${ROLES.join(" / ")}）`,
      });
    }
    if (count === null) {
      findings.push({
        code: "row-count-unreadable",
        message: `${name} の件数「${normalizeCell(row["件数"]) || "（空欄）"}」を数値として読めない`,
      });
    }
  }
  return declared;
}

/**
 * 1. 転記の抜け。features.md が参照する (テーブル, slug) が、対象テーブル表に無い。
 *
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkCopyMissing(ctx) {
  const { findings } = ctx;
  for (const [tableName, slugs] of ctx.consumers) {
    const entry = ctx.declared.get(tableName);
    if (!entry) {
      findings.push({
        code: "copy-missing-table",
        message: `features.md が ${tableName} を [${[...slugs].sort().join(", ")}] から参照しているのに、design.md の対象テーブル表に行が無い（転記の抜け）`,
      });
      continue;
    }
    for (const slug of [...slugs].sort()) {
      if (!entry.slugs.has(slug)) {
        findings.push({
          code: "copy-missing-slug",
          message: `${tableName} を参照する slug ${slug} が design.md に転記されていない（転記が 1 slug 抜けると、役割が「読み取りだけ」と判定されてしまう）`,
        });
      }
    }
  }
}

/**
 * 1. の転記しすぎ（集合の差）と、2. 役割の矛盾を、対象テーブル表の行ごとに確かめる。
 *
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkDeclaredTables(ctx) {
  const { findings } = ctx;
  for (const [tableName, entry] of ctx.declared) {
    const actual = ctx.consumers.get(tableName) ?? new Set();
    for (const slug of [...entry.slugs].sort()) {
      if (!actual.has(slug)) {
        findings.push({
          code: "copy-extra-slug",
          message: `design.md が ${tableName} の消費側に ${slug} を書いているが features.md の 3 表に無い（推測で足したか、features.md の側の記録の抜け）`,
        });
      }
    }
    checkRole({ findings, tableName, entry, actual });
  }
}

/**
 * 2. 役割の矛盾（役割は「消費するか」で決まる。JOIN / FROM の引き方では決めない）
 *
 * @param {{ findings: Finding[], tableName: string, entry: DeclaredTable, actual: Set<string> }} params
 * @returns {void}
 */
function checkRole({ findings, tableName, entry, actual }) {
  if (entry.role === "読み取りだけ" && actual.size > 0) {
    findings.push({
      code: "role-contradicts-consumers",
      message: `${tableName} の役割が「読み取りだけ」だが、features.md では [${[...actual].sort().join(", ")}] が参照している（消費するなら投入対象。JOIN で引くか FROM の母集合として引くかは役割を変えない）`,
    });
  }
  if (entry.role === "投入する" && actual.size === 0) {
    findings.push({
      code: "role-without-consumer",
      message: `${tableName} の役割が「投入する」だが features.md のどの表からも参照されていない（対象の根拠が無い。FK を満たすためだけに要る親表なら「FK 親のみ」と書く）`,
    });
  }
  if (entry.role !== "FK 親のみ") return;
  if (actual.size > 0) {
    findings.push({
      code: "fk-parent-has-consumer",
      message: `${tableName} の役割が「FK 親のみ」だが、features.md では [${[...actual].sort().join(", ")}] が参照している（直接読まれる表は「投入する」）`,
    });
  }
  if (entry.count === 0) {
    findings.push({
      code: "fk-parent-empty",
      message: `${tableName} は「FK 親のみ」だが 0 件（子行の FK を満たせない）`,
    });
  }
}

/**
 * 述語の行を、テーブル名ごとに分ける。
 *
 * @param {Record<string, string>[]} predicateRows
 * @returns {Map<string, Record<string, string>[]>}
 */
function groupPredicatesByTable(predicateRows) {
  /** @type {Map<string, Record<string,string>[]>} */
  const predicatesByTable = new Map();
  for (const row of predicateRows) {
    const name = normalizeCell(row["テーブル"]);
    let tablePredicates = predicatesByTable.get(name);
    if (!tablePredicates) {
      tablePredicates = [];
      predicatesByTable.set(name, tablePredicates);
    }
    tablePredicates.push(row);
  }
  return predicatesByTable;
}

/**
 * 3. 参照表の件数（0 件 / 1 件は、それ自体が「踏めない」の印）
 *
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkTableRowCounts(ctx) {
  for (const [tableName, entry] of ctx.declared) {
    if (entry.role !== "投入する") continue;
    if (entry.count === null) continue;
    if (entry.count > 1) continue;
    const reason =
      entry.count === 0
        ? "0 件では真になる分岐へ入れない"
        : "1 件では絞り込みを外しても結果が変わらず、絞り込みが機能していることを観測できない";
    const rows = ctx.predicatesByTable.get(tableName) ?? [];
    const decided = rows.some((row) => DISPOSITIONS.includes(normalizeCell(row["扱い"])));
    if (!decided) {
      ctx.findings.push({
        code: "table-row-count-unusable",
        message: `${tableName} は ${entry.count} 件（${reason}）。述語ごとの分岐網羅に扱い（${DISPOSITIONS.join(" / ")}）を決めた行が無い`,
      });
    }
  }
}

/**
 * 4. 述語ごとの真・偽（0 件の側があれば踏めない）
 *
 * @param {CheckContext} ctx
 * @param {Table} predicateTable
 * @returns {void}
 */
function checkPredicateRows(ctx, predicateTable) {
  const { findings } = ctx;
  // 「値の出どころ」列は必須列に入れない。入れると表そのものが無い（exit 2）と同じ出力になり、
  // 列を足せば直る設計を「表が読めない」と取り違える。列の欠けは不備（exit 1）として名指しする。
  const hasOriginColumn = predicateTable.headers.includes("値の出どころ");
  if (!hasOriginColumn) {
    findings.push({
      code: "predicate-origin-column-missing",
      message:
        "述語ごとの分岐網羅に「値の出どころ」列が無い（述語の値を、消費側が変換した後に渡す値で書いたかが読めない）",
    });
  }
  const seenPredicateIds = new Set();
  for (const row of ctx.predicateRows) {
    const id = normalizeCell(row["述語 id"]);
    if (seenPredicateIds.has(id)) {
      findings.push({
        code: "predicate-id-duplicated",
        message: `述語 id ${id} が 2 行以上にある（検証記録と鍵で対応づけられない）`,
      });
    }
    seenPredicateIds.add(id);
    checkPredicateConsumers(ctx, row, id);
    if (hasOriginColumn) checkPredicateOrigin(findings, row, id);
    checkPredicateCounts(ctx, row, id);
  }
}

/**
 * 述語の行のテーブルが対象テーブル表に在り、消費側 slug が features.md でそのテーブルを読むか。
 *
 * @param {CheckContext} ctx
 * @param {Record<string, string>} row
 * @param {string} id
 * @returns {void}
 */
function checkPredicateConsumers(ctx, row, id) {
  const { findings } = ctx;
  const tableName = normalizeCell(row["テーブル"]);
  if (!ctx.declared.has(tableName)) {
    findings.push({
      code: "predicate-table-unknown",
      message: `述語 ${id} のテーブル ${tableName} が対象テーブル表に無い`,
    });
  }
  const consumerList = splitList(row["消費側 slug"]);
  if (consumerList.kind !== "items") {
    findings.push({
      code: "predicate-consumer-blank",
      message: `述語 ${id} の消費側 slug が空（どの消費側の分岐かが決まらない）`,
    });
    return;
  }
  const actual = ctx.consumers.get(tableName) ?? new Set();
  for (const slug of consumerList.items) {
    if (!actual.has(slug)) {
      findings.push({
        code: "predicate-consumer-unknown",
        message: `述語 ${id} の消費側 slug ${slug} は features.md で ${tableName} を参照していない`,
      });
    }
  }
}

/**
 * 述語の値の出どころが書かれているか。
 *
 * **述語の値は、消費側が述語に渡す値で書く**。設計者が書いた値（`id = '900000000001'`）と、
 * 消費側が変換した後に渡す値（32 ビット整数への変換で 0）が違うと、述語は設計どおり真でも、
 * 消費側が取得する行は 0 件になる。この表は「踏める」のまま、比べられない処理が残る。
 * 値の意味は読めないので、少なくとも出どころの欠けを落とす。値はどの述語にも在るので `-` も欠けとして扱う。
 *
 * @param {Finding[]} findings
 * @param {Record<string, string>} row
 * @param {string} id
 * @returns {void}
 */
function checkPredicateOrigin(findings, row, id) {
  const origin = normalizeCell(row["値の出どころ"]);
  if (origin === "" || origin === NONE_SENTINEL) {
    findings.push({
      code: "predicate-origin-missing",
      message: `述語 ${id} の値の出どころが「${origin || "（空欄）"}」（消費側のどのコードが作る値か・変換を経るかが書かれていないと、変換で値が変わる処理を踏めると数えたまま通る）`,
    });
  }
}

/**
 * 述語の真・偽の行数を読み、表の件数を超えないかを確かめてから、判定と扱いを確かめる。
 *
 * @param {CheckContext} ctx
 * @param {Record<string, string>} row
 * @param {string} id
 * @returns {void}
 */
function checkPredicateCounts(ctx, row, id) {
  const { findings } = ctx;
  const tableName = normalizeCell(row["テーブル"]);
  const trueCount = parseCount(row["真の行数"]);
  const falseCount = parseCount(row["偽の行数"]);
  if (trueCount === null || falseCount === null) {
    findings.push({
      code: "predicate-count-unreadable",
      message: `述語 ${id} の真／偽の行数を数値として読めない（真: ${normalizeCell(row["真の行数"]) || "（空欄）"} / 偽: ${normalizeCell(row["偽の行数"]) || "（空欄）"}）`,
    });
    return;
  }
  // **真・偽はその表の行を分けたもの**なので、合計が表の件数を超えることはない
  // （三値論理で真でも偽でもない行〈NULL〉はありうるので、等号は求めない）。
  // 超えている行を通すと、1 件の表に「真 1 / 偽 1」と書いて踏める判定を作り、
  // 表の件数 0 / 1 の検査を扱いの欄で抑える、という形で網羅を捏造できる。
  const tableCount = ctx.declared.get(tableName)?.count ?? null;
  if (tableCount !== null && trueCount + falseCount > tableCount) {
    findings.push({
      code: "predicate-partition-exceeds-table",
      message: `述語 ${id} の真 ${trueCount} 件 ＋ 偽 ${falseCount} 件が ${tableName} の件数 ${tableCount} を超える（真・偽はその表の行を分けたもの。超える数はその表から出ない）`,
    });
  }
  checkPredicateVerdict(findings, row, { id, trueCount, falseCount });
}

/**
 * 述語の判定が真・偽の行数と合うかと、踏めない述語に扱いを決めたかを確かめる。
 *
 * @param {Finding[]} findings
 * @param {Record<string, string>} row
 * @param {{ id: string, trueCount: number, falseCount: number }} counts
 * @returns {void}
 */
function checkPredicateVerdict(findings, row, { id, trueCount, falseCount }) {
  const verdict = normalizeCell(row["判定"]);
  const disposition = normalizeCell(row["扱い"]);
  const steppable = trueCount >= 1 && falseCount >= 1;
  const expected = steppable ? "踏める" : "踏めない";
  if (verdict !== expected) {
    findings.push({
      code: "predicate-verdict-mismatch",
      message: `述語 ${id} の判定が「${verdict || "（空欄）"}」だが、真 ${trueCount} 件 / 偽 ${falseCount} 件からは「${expected}」（0 件の側がある分岐は踏めない）`,
    });
  }
  if (!steppable) {
    if (!DISPOSITIONS.includes(disposition)) {
      findings.push({
        code: "predicate-disposition-missing",
        message: `述語 ${id} は踏めない（真 ${trueCount} 件 / 偽 ${falseCount} 件）のに扱いが「${disposition || "（空欄）"}」。足すか gaps に記録するかを設計の段で選ぶ（足すと version が上がり交差する slug の採取物が陳腐化する）`,
      });
    } else if (disposition === "gaps に記録" && normalizeCell(row["根拠"]) === "") {
      findings.push({
        code: "predicate-gaps-reason-missing",
        message: `述語 ${id} は「gaps に記録」だが根拠が空欄（消費側がその分岐を使うかの判断材料が残らない）`,
      });
    }
  } else if (
    disposition !== "" &&
    disposition !== NONE_SENTINEL &&
    !DISPOSITIONS.includes(disposition)
  ) {
    findings.push({
      code: "predicate-disposition-vocabulary",
      message: `述語 ${id} の扱い「${disposition}」は語彙外（${DISPOSITIONS.join(" / ")} / ${NONE_SENTINEL}）`,
    });
  }
}

/**
 * 5. 消費側パラメータの絞り込みが、述語として列挙されているか
 *
 * **表が無いときを素通りさせない**。絞り込みの一覧が読めないと、この節は 0 行の走査になり
 * 「絞り込みが 1 つも無い」と「絞り込みを数えていない」が同じ（findings 0 件）に見える。
 *
 * @param {CheckContext} ctx
 * @param {Table | null} paramTable
 * @returns {void}
 */
function checkParamFilters(ctx, paramTable) {
  if (!paramTable) {
    ctx.findings.push({
      code: "design-param-table-missing",
      message:
        "design.md に「消費側パラメータ」表（機能／リソース slug / テーブル / 絞り込み列・条件）が無い（絞り込みの一覧が読めないと、述語を数え漏らしても 0 件と同じ見え方になる）",
    });
    return;
  }
  for (const row of rowsAsRecords(paramTable)) {
    checkParamRow(ctx, row);
  }
}

/**
 * 消費側パラメータの 1 行の絞り込みに、述語の行が在るか。
 *
 * @param {CheckContext} ctx
 * @param {Record<string, string>} row
 * @returns {void}
 */
function checkParamRow(ctx, row) {
  const { findings } = ctx;
  const slug = normalizeCell(row["機能／リソース slug"]);
  const tableName = normalizeCell(row["テーブル"]);
  const filters = splitList(row["絞り込み列・条件"]);
  // **空欄と `-` を書き分ける**（features.md の参照テーブル列と同じ規律）。
  // 空欄は「まだ調べていない」なので、絞り込みが無い行（`-`）と同じに扱うと、
  // 未調査のテーブルに述語行が無くても findings 0 件で通る。
  if (filters.kind === "blank") {
    findings.push({
      code: "param-filters-blank",
      message: `消費側パラメータの ${slug || "（slug 空欄）"} × ${tableName || "（テーブル空欄）"} の絞り込み列・条件が空欄（未調査。絞り込みが無いなら - と書く）`,
    });
    return;
  }
  if (filters.kind !== "items") return;
  // **キーが欠けた行を、警告なしに飛ばさない**。絞り込みが書いてあるのに slug やテーブルが空だと、
  // 「数える相手が決まらない行」と「絞り込みの無い行」が同じ（findings 0 件）に見える。
  if (slug === "" || tableName === "") {
    findings.push({
      code: "param-row-unkeyed",
      message: `消費側パラメータに絞り込み「${filters.items.join(", ")}」があるのに ${slug === "" ? "機能／リソース slug" : "テーブル"} が空（どの分岐を数えるか決まらない）`,
    });
    return;
  }
  const rows =
    ctx.predicatesByTable
      .get(tableName)
      ?.filter((r) => splitList(r["消費側 slug"]).items.includes(slug)) ?? [];
  if (rows.length === 0) {
    findings.push({
      code: "predicate-not-enumerated",
      message: `消費側パラメータの ${slug} × ${tableName} に絞り込みがあるのに、述語ごとの分岐網羅に対応する行が無い（数えていない分岐は 0 件と同じ見え方になる）`,
    });
    return;
  }
  checkFilterColumns(findings, { slug, tableName, filters: filters.items }, rows);
}

/**
 * 絞り込みの列ごとに、他の列と共有しない述語の行が在るか。
 *
 * **絞り込み列は 1 行に複数並ぶ**（`status, owner_id`）。1 本でも述語行があれば足りると数えると、
 * 残りの列の分岐は「数えていない」まま 0 件と同じ見え方になる。列ごとに述語を要求する。
 * 突き合わせは述語の文面に列名が現れるかで行うため、`status = 'shipped'` のように**列名を書く**必要がある
 * （列名を書かない式は数えられていないものとして落ちる）。
 *
 * @param {Finding[]} findings
 * @param {{ slug: string, tableName: string, filters: string[] }} param
 * @param {Record<string, string>[]} rows その slug とテーブルの述語の行
 * @returns {void}
 */
function checkFilterColumns(findings, param, rows) {
  const { slug, tableName } = param;
  const columns = readFilterColumns(findings, param);
  // **列ごとに別の述語行が要る**。`status = 'shipped' AND owner_id = :me` の 1 行は
  // 2 つの列の文面を含むので、行の再利用を許すと、1 行で複数の絞り込みを満たしたことになる。
  // 真・偽の行数は、結合した条件のものしか表さない（1 列に 1 行という取り決めが成り立たなくなる）。
  const predicateTexts = rows.map((r) => normalizeCell(r["述語（列・条件）"]));
  const assignment = matchColumnsToRows(columns, predicateTexts);
  columns.forEach((column, index) => {
    if (assignment[index] !== -1) return;
    const namedAnywhere = predicateTexts.some((text) => namesColumn(text, column));
    findings.push(
      namedAnywhere
        ? {
            code: "predicate-filter-shares-row",
            message: `消費側パラメータの ${slug} × ${tableName} の列 ${column} に、他の列と共有していない述語行が無い（1 行が複数の絞り込みを兼ねると、真・偽の行数が結合条件のものになる）`,
          }
        : {
            code: "predicate-filter-not-enumerated",
            message: `消費側パラメータの ${slug} × ${tableName} の絞り込み「${column}」に対応する述語行が無い（述語の文面に列 ${column} が現れない。1 行に複数の絞り込みが並ぶとき、1 本の述語で全部を満たしたことにしない）`,
          },
    );
  });
}

/**
 * 絞り込みの記述から列名を取り出す。読めない絞り込みは finding にする。
 *
 * @param {Finding[]} findings
 * @param {{ slug: string, tableName: string, filters: string[] }} param
 * @returns {string[]}
 */
function readFilterColumns(findings, { slug, tableName, filters }) {
  /** @type {string[]} */
  const columns = [];
  for (const filter of filters) {
    const column = filterColumn(filter);
    if (column === null) {
      // **読めない絞り込みを飛ばさない**。括弧つきの条件（`(owner_id = :me)`）で
      // 先頭のトークンが空になる形を警告なしに捨てると、その列の分岐が数えられないまま通る。
      findings.push({
        code: "predicate-filter-unreadable",
        message: `消費側パラメータの ${slug} × ${tableName} の絞り込み「${filter}」から列名を読めない（列名で始まる形で書く）`,
      });
      continue;
    }
    columns.push(column);
  }
  return columns;
}

/**
 * 5b. features.md が宣言した (slug, テーブル) の組に、消費側パラメータの行が在るか
 *
 * **行が無い組はループが 0 回になる**ので、「絞り込みを調べていない」と「絞り込みが無い」が
 * 同じ（findings 0 件）に見える。調べた結果が無ければ `-` の行を置かせる。
 *
 * @param {CheckContext} ctx
 * @param {Table | null} paramTable
 * @returns {void}
 */
function checkParamPairs(ctx, paramTable) {
  if (!paramTable) return;
  /** @type {Set<string>} */
  const paramPairs = new Set();
  for (const row of rowsAsRecords(paramTable)) {
    const slug = normalizeCell(row["機能／リソース slug"]);
    const tableName = normalizeCell(row["テーブル"]);
    if (slug === "" || tableName === "") continue;
    paramPairs.add(`${slug}\u0000${tableName}`);
  }
  for (const [tableName, slugs] of ctx.consumers) {
    if (!ctx.declared.has(tableName)) continue;
    for (const slug of [...slugs].sort()) {
      if (paramPairs.has(`${slug}\u0000${tableName}`)) continue;
      ctx.findings.push({
        code: "param-row-missing",
        message: `features.md では ${slug} が ${tableName} を読むのに、消費側パラメータにその組の行が無い（絞り込みを調べていないことが、絞り込みが無いことと同じ見え方になる。調べて無ければ絞り込み列・条件に - と書く）`,
      });
    }
  }
}

/**
 * 5c. データセットが決めた識別子の値（採番帯）が、消費側の変換の後も同じ値で届くか
 *
 * 採番帯は、ほかの環境や作業と重ならないように、データセット自身が決める値である。そのため実運用の範囲の外に出やすい。
 * 消費側が述語へ渡す前に変換する（32 ビット整数への変換・桁の切り詰め・型の上限）と別の値になり、
 * 述語は設計どおり真でも、消費側が取得する行は 0 件になる。
 * 分岐網羅の表と verification.md は設計者の値で数えるので、何も出ない。
 * **消費側 (slug, テーブル) ごとに変換を列挙させる**。表ごと 1 行で済ませると、変換する消費側が 1 つでも
 * 在ることが「別の消費側で届いた」に隠れる。
 *
 * @param {CheckContext} ctx
 * @param {Table[]} designTables
 * @returns {void}
 */
function checkIdRanges(ctx, designTables) {
  const idRangeTable = findTable(designTables, "識別子の値の範囲", ID_RANGE_TABLE_HEADERS);
  if (!idRangeTable) {
    ctx.findings.push({
      code: "id-range-table-missing",
      message:
        "design.md に「識別子の値の範囲」表（テーブル / 列 / データセットの値の範囲 / 実運用の値の範囲 / 消費側 slug / 受け取る型・変換 / 届くか / 扱い / 根拠）が無い（採番帯が消費側の変換を通るかを確かめていないことが、通ることと同じ見え方になる）",
    });
  } else {
    checkIdRangeRows(ctx, idRangeTable);
  }
}

/**
 * 「識別子の値の範囲」表の行を読み、表全体の突き合わせ（列 `-` との併記・消費側ごとの行・届かない値の述語）まで行う。
 *
 * @param {CheckContext} ctx
 * @param {Table} idRangeTable
 * @returns {void}
 */
function checkIdRangeRows(ctx, idRangeTable) {
  /** @type {IdRangeState} */
  const state = {
    coveredPairs: new Set(),
    // 識別子の列が無い（列 `-`）と宣言したテーブル。
    noIdColumn: new Set(),
    // 実在の列の行を持つテーブル。
    realColumnTables: new Set(),
    // (テーブル, 列, slug) の既出。
    seenIdKeys: new Set(),
    unreachedGaps: [],
  };
  for (const row of rowsAsRecords(idRangeTable)) {
    checkIdRangeRow(ctx, state, row);
  }
  checkIdRangeDashConflicts(ctx.findings, state);
  checkIdRangeRowMissing(ctx, state);
  checkUnconvertedPredicates(ctx, state);
}

/**
 * 「識別子の値の範囲」表の 1 行のテーブルと列を確かめ、列の種類（`-`・実在の列）ごとの検査へ渡す。
 *
 * @param {CheckContext} ctx
 * @param {IdRangeState} state
 * @param {Record<string, string>} row
 * @returns {void}
 */
function checkIdRangeRow(ctx, state, row) {
  const { findings, declared } = ctx;
  const tableName = normalizeCell(row["テーブル"]);
  const column = normalizeCell(row["列"]);
  const reason = normalizeCell(row["根拠"]);
  // 根拠の `-` は空欄と同じく欠けとして扱う。`-` は「調べた結果ゼロ件」の印で、根拠の代わりにならない。
  const reasonMissing = reason === "" || reason === NONE_SENTINEL;
  if (tableName === "" && column === "") return;
  const label = `${tableName || "（テーブル空欄）"}.${column || "（列空欄）"}`;
  if (tableName === "" || !declared.has(tableName)) {
    findings.push({
      code: "id-range-table-unknown",
      message: `識別子の値の範囲の ${label} のテーブルが対象テーブル表に無い`,
    });
    return;
  }
  if (column === NONE_SENTINEL) {
    checkIdRangeDashRow(findings, row, { tableName, reason, reasonMissing });
    state.noIdColumn.add(tableName);
    return;
  }
  if (column === "") {
    findings.push({
      code: "id-range-column-blank",
      message: `識別子の値の範囲の ${label} の列が空欄（未調査。帯の値を持つ列が無いなら - と根拠を書く）`,
    });
    return;
  }
  checkIdRangeColumnRow(ctx, state, { row, tableName, column, label, reason, reasonMissing });
}

/**
 * 列 `-` の行を確かめる。
 *
 * 列 `-` は「このテーブルに帯の値を持つ列が無い」。**FK 列も親の帯の値を持つ**ので、
 * 子表を読む消費側が親の識別子を変換するなら、その FK 列の行が要る（`-` にしない）。
 * 投入ツールは ID を固定値で決めるので、「DB の採番に任せる」はこの逃げ道の理由にならない。
 * 真偽は読めない自己申告なので、根拠を要求し、同じ表に実列の行があれば矛盾として落とす。
 *
 * @param {Finding[]} findings
 * @param {Record<string, string>} row
 * @param {{ tableName: string, reason: string, reasonMissing: boolean }} key
 * @returns {void}
 */
function checkIdRangeDashRow(findings, row, { tableName, reason, reasonMissing }) {
  if (reasonMissing) {
    findings.push({
      code: "id-range-reason-missing",
      message: `識別子の値の範囲の ${tableName} は列が - （帯の値を持つ列が無い）だが根拠が「${reason || "（空欄）"}」`,
    });
  }
  // 列 `-` の行に範囲・消費側・変換・判定が書いてあると、帯の値を持つ列が在るという記述と矛盾する。
  // 警告なしに表ごとの免除として扱うと、変換の検査を丸ごと外せる。残りのセルは `-` か空欄に限る。
  const populated = [
    "データセットの値の範囲",
    "実運用の値の範囲",
    "消費側 slug",
    "受け取る型・変換",
    "届くか",
    "扱い",
  ].filter((header) => {
    const value = normalizeCell(row[header]);
    return value !== "" && value !== NONE_SENTINEL;
  });
  if (populated.length > 0) {
    findings.push({
      code: "id-range-dash-row-populated",
      message: `識別子の値の範囲の ${tableName} は列が - （帯の値を持つ列が無い）なのに「${populated.join("」「")}」が書いてある（列を書いた行にするか、残りを - にする）`,
    });
  }
}

/**
 * 実在の列の行を確かめる（範囲・変換・根拠の記入、消費側、届くかと扱い）。
 *
 * @param {CheckContext} ctx
 * @param {IdRangeState} state
 * @param {{ row: Record<string, string>, tableName: string, column: string, label: string, reason: string, reasonMissing: boolean }} params
 * @returns {void}
 */
function checkIdRangeColumnRow(ctx, state, params) {
  const { findings } = ctx;
  const { row, tableName, column, label, reason, reasonMissing } = params;
  // 列は 1 行に 1 つにする。`id, parent_id` のように並べると、変換の違う識別子が 1 つの「届くか」を共有する。
  if (splitList(column).items.length > 1) {
    findings.push({
      code: "id-range-column-multiple",
      message: `識別子の値の範囲の ${label} の列に複数の列が並んでいる（識別子の列ごとに行を立てる）`,
    });
  }
  state.realColumnTables.add(tableName);
  checkIdRangeCells(findings, row, label);
  // 根拠は届く・届かないを問わず要る。届くかは変換の意味から設計者が判定した自己申告で、
  // 読み手が確かめられる材料（帯が型の上限に収まる等）が無いと、届くと書くだけで通る。
  if (reasonMissing) {
    findings.push({
      code: "id-range-reason-missing",
      message: `識別子の値の範囲の ${label} の根拠が「${reason || "（空欄）"}」（変換の後も届くか、届かない処理をどう扱ったかを確かめた材料が残らない）`,
    });
  }
  const slugList = splitList(row["消費側 slug"]);
  checkIdRangeConsumers(ctx, state, { tableName, column, label, slugList });
  checkIdRangeReach(findings, state, { row, tableName, column, label, slugList });
}

/**
 * 実在の列の行で、範囲の 2 列と変換の列が書かれているか。
 *
 * @param {Finding[]} findings
 * @param {Record<string, string>} row
 * @param {string} label
 * @returns {void}
 */
function checkIdRangeCells(findings, row, label) {
  // 範囲の 2 列は、`-` も欠けとして失敗にする。値を持つ列の行なので、範囲は必ず在る。
  // `-` を受けると、範囲を並べて記録させる取り決めが警告なしに外れる。`-`（変換なし）が意味を持つのは、変換の列だけである。
  for (const header of ["データセットの値の範囲", "実運用の値の範囲"]) {
    const value = normalizeCell(row[header]);
    if (value === "" || value === NONE_SENTINEL) {
      findings.push({
        code: "id-range-cell-blank",
        message: `識別子の値の範囲の ${label} の「${header}」が「${value || "（空欄）"}」（実在の列の行では範囲を書く）`,
      });
    }
  }
  if (normalizeCell(row["受け取る型・変換"]) === "") {
    findings.push({
      code: "id-range-cell-blank",
      message: `識別子の値の範囲の ${label} の「受け取る型・変換」が空欄（未調査。変換が無いなら - と書く）`,
    });
  }
}

/**
 * 実在の列の行の消費側 slug が features.md でそのテーブルを読み、(テーブル, 列, slug) が重ならないか。
 *
 * @param {CheckContext} ctx
 * @param {IdRangeState} state
 * @param {{ tableName: string, column: string, label: string, slugList: { kind: string, items: string[] } }} params
 * @returns {void}
 */
function checkIdRangeConsumers(ctx, state, { tableName, column, label, slugList }) {
  const { findings } = ctx;
  const { seenIdKeys, coveredPairs } = state;
  if (slugList.kind !== "items") {
    findings.push({
      code: "id-range-consumer-blank",
      message: `識別子の値の範囲の ${label} の消費側 slug が空（どの消費側の変換かが決まらない）`,
    });
    return;
  }
  const actual = ctx.consumers.get(tableName) ?? new Set();
  for (const slug of slugList.items) {
    if (!actual.has(slug)) {
      findings.push({
        code: "id-range-consumer-unknown",
        message: `識別子の値の範囲の ${label} の消費側 slug ${slug} は features.md で ${tableName} を参照していない`,
      });
      continue;
    }
    // 同じ (テーブル, 列, slug) を 2 行に書くと、届く・届かないの判定が 1 つに決まらない。
    const key = `${tableName}\u0000${column}\u0000${slug}`;
    if (seenIdKeys.has(key)) {
      findings.push({
        code: "id-range-duplicated",
        message: `識別子の値の範囲で ${tableName}.${column} の消費側 ${slug} が 2 行以上にある（届くかと扱いが 1 つに決まらない）`,
      });
    }
    seenIdKeys.add(key);
    coveredPairs.add(`${slug}\u0000${tableName}`);
  }
}

/**
 * 実在の列の行の「届くか」と「扱い」が語彙に合うか。届かない値を gaps に記録した行は、述語との突き合わせに残す。
 *
 * @param {Finding[]} findings
 * @param {IdRangeState} state
 * @param {{ row: Record<string, string>, tableName: string, column: string, label: string, slugList: { kind: string, items: string[] } }} params
 * @returns {void}
 */
function checkIdRangeReach(findings, state, { row, tableName, column, label, slugList }) {
  const reach = normalizeCell(row["届くか"]);
  const disposition = normalizeCell(row["扱い"]);
  if (!ID_REACH.includes(reach)) {
    findings.push({
      code: "id-range-reach-vocabulary",
      message: `識別子の値の範囲の ${label} の届くか「${reach || "（空欄）"}」は語彙外（${ID_REACH.join(" / ")}）`,
    });
    return;
  }
  if (reach === "届く") {
    // 空欄は受けない。空欄は未調査で、`-` だけが「届くので何もしない」と決めた記録（書き分けの規律）。
    if (disposition !== NONE_SENTINEL) {
      findings.push({
        code: "id-range-disposition-vocabulary",
        message: `識別子の値の範囲の ${label} は届くのに扱いが「${disposition || "（空欄）"}」（届く行の扱いは -）`,
      });
    }
    return;
  }
  // 届かない。「帯を変える」を選んだなら表は変えた後の帯で書き直すので「届く」になる。
  // 残る選択は、届く値の行を足す（帯の外になるなら利用者が判断する）か、比べられない処理として gaps に記録するかである。
  if (!ID_DISPOSITIONS.includes(disposition)) {
    findings.push({
      code: "id-range-disposition-missing",
      message: `識別子の値の範囲の ${label} は変換の後に届かないのに扱いが「${disposition || "（空欄）"}」（${ID_DISPOSITIONS.join(" / ")} から選ぶ。帯を変えたなら変えた後の帯で書き直す）`,
    });
    return;
  }
  if (disposition === "gaps に記録" && slugList.kind === "items") {
    state.unreachedGaps.push({ tableName, column, slugs: slugList.items });
  }
}

/**
 * 同じテーブルに、列 `-` の行と実在の列の行の両方があれば矛盾として落とす。
 *
 * @param {Finding[]} findings
 * @param {IdRangeState} state
 * @returns {void}
 */
function checkIdRangeDashConflicts(findings, state) {
  const { noIdColumn, realColumnTables } = state;
  for (const tableName of noIdColumn) {
    if (!realColumnTables.has(tableName)) continue;
    findings.push({
      code: "id-range-dash-conflict",
      message: `識別子の値の範囲で ${tableName} は列 - （帯の値を持つ列が無い）と、実在の列の行の両方がある（- の行が、消費側ごとの行の要求を警告なしに外す）`,
    });
  }
}

/**
 * 投入するテーブルを読む消費側 (slug, テーブル) ごとに、識別子の値の範囲の行が在るか。
 *
 * @param {CheckContext} ctx
 * @param {IdRangeState} state
 * @returns {void}
 */
function checkIdRangeRowMissing(ctx, state) {
  const { coveredPairs, noIdColumn } = state;
  for (const [tableName, slugs] of ctx.consumers) {
    const entry = ctx.declared.get(tableName);
    if (!entry || entry.role !== "投入する" || noIdColumn.has(tableName)) continue;
    for (const slug of [...slugs].sort()) {
      if (coveredPairs.has(`${slug}\u0000${tableName}`)) continue;
      ctx.findings.push({
        code: "id-range-row-missing",
        message: `${slug} が読む ${tableName} の識別子について、識別子の値の範囲に行が無い（消費側が識別子を受け取る型・変換を列挙していない。受け取らないなら受け取る型・変換に - と書く）`,
      });
    }
  }
}

/**
 * **変換で届かないと記録した値を、述語では「踏める」と数えていないか。**
 * gaps に記録した（届く行を足していない）なら、その消費側が変換後の値で引く行は 0 件なので、
 * 同じ列の述語は変換後の値で数えれば踏めない。「踏める」のまま残るのが、この検査が防ぐ形そのもの。
 *
 * @param {CheckContext} ctx
 * @param {IdRangeState} state
 * @returns {void}
 */
function checkUnconvertedPredicates(ctx, state) {
  for (const gap of state.unreachedGaps) {
    for (const row of ctx.predicatesByTable.get(gap.tableName) ?? []) {
      const predicateSlugs = splitList(row["消費側 slug"]).items;
      if (!predicateSlugs.some((slug) => gap.slugs.includes(slug))) continue;
      if (!namesColumn(normalizeCell(row["述語（列・条件）"]), gap.column)) continue;
      if (normalizeCell(row["判定"]) !== "踏める") continue;
      ctx.findings.push({
        code: "predicate-counts-unconverted-value",
        message: `述語 ${normalizeCell(row["述語 id"])} は ${gap.tableName}.${gap.column} を「踏める」と数えているが、識別子の値の範囲ではその値が消費側の変換の後に届かない（gaps に記録）。変換後の値で真・偽を数え直す`,
      });
    }
  }
}

/**
 * 6. verification.md の「述語ごとの該当行数」表を読み、述語ごとの実測を設計と突き合わせる。
 *
 * @param {CheckContext} ctx
 * @param {string} verificationMarkdown
 * @returns {void}
 */
function checkVerification(ctx, verificationMarkdown) {
  const { findings } = ctx;
  const verificationTables = parseTables(verificationMarkdown);
  const verificationUnclosed = unclosedFenceLine(verificationMarkdown);
  if (verificationUnclosed !== null) {
    // verification.md の表が無いとき（verification-table-missing）と同じく、構造の不備にはしない。
    findings.push({
      code: "verification-fence-unclosed",
      message: `verification.md の ${unclosedFenceMessage(verificationUnclosed)}`,
    });
  }
  const measured = findTable(verificationTables, "述語ごとの該当行数", MEASURED_TABLE_HEADERS);
  if (!measured) {
    findings.push({
      code: "verification-table-missing",
      message:
        "verification.md に「述語ごとの該当行数」表（述語 id / 真の実測行数 / 偽の実測行数）が無い（投入後に 0 件・1 件が報告に出ない）",
    });
    return;
  }
  const measuredById = indexMeasuredRows(findings, measured);
  for (const row of ctx.predicateRows) {
    checkMeasuredPredicate(findings, row, measuredById);
  }
}

/**
 * 実測の表を、述語 id から行を引ける形にする。
 *
 * @param {Finding[]} findings
 * @param {Table} measured
 * @returns {Map<string, Record<string, string>>}
 */
function indexMeasuredRows(findings, measured) {
  /** @type {Map<string, Record<string,string>>} */
  const measuredById = new Map();
  for (const row of rowsAsRecords(measured)) {
    const id = normalizeCell(row["述語 id"]);
    if (id === "") continue;
    // 後の行で警告なしに上書きしない。同じ id の行が 2 つあると、食い違うほうの実測が
    // 突き合わせに使われずに捨てられ、0 件の分岐が報告に出ないまま通る。
    if (measuredById.has(id)) {
      findings.push({
        code: "verification-predicate-duplicated",
        message: `verification.md の「述語ごとの該当行数」に述語 id ${id} の行が 2 つ以上ある（どちらの実測と突き合わせるか決まらない）`,
      });
    }
    measuredById.set(id, row);
  }
  return measuredById;
}

/**
 * 1 つの述語の実測が在り、設計の数と合い、投入後に踏めるか（gaps に記録した述語を除く）。
 *
 * @param {Finding[]} findings
 * @param {Record<string, string>} row 述語ごとの分岐網羅の行
 * @param {Map<string, Record<string, string>>} measuredById
 * @returns {void}
 */
function checkMeasuredPredicate(findings, row, measuredById) {
  const id = normalizeCell(row["述語 id"]);
  const designedTrue = parseCount(row["真の行数"]);
  const designedFalse = parseCount(row["偽の行数"]);
  const record = measuredById.get(id);
  if (!record) {
    findings.push({
      code: "verification-predicate-missing",
      message: `述語 ${id} の実測行数が verification.md に無い（設計の数が投入で成立したか分からない）`,
    });
    return;
  }
  const measuredTrue = parseCount(record["真の実測行数"]);
  const measuredFalse = parseCount(record["偽の実測行数"]);
  if (measuredTrue === null || measuredFalse === null) {
    findings.push({
      code: "verification-count-unreadable",
      message: `述語 ${id} の実測行数を数値として読めない`,
    });
    return;
  }
  if (measuredTrue !== designedTrue || measuredFalse !== designedFalse) {
    findings.push({
      code: "verification-count-mismatch",
      message: `述語 ${id} の実測（真 ${measuredTrue} / 偽 ${measuredFalse}）が設計（真 ${designedTrue} / 偽 ${designedFalse}）と違う`,
    });
  }
  // **設計の段で「gaps に記録」と決めた分岐は、投入後も踏めないのが正しい姿**。
  // 0 件を無条件に落とすと、設計が受理した扱いを検証が覆し、
  // 「足す」を選ばない限り exit 0 にできなくなる（記録して進む方法が無くなる）。
  const disposition = normalizeCell(row["扱い"]);
  if ((measuredTrue === 0 || measuredFalse === 0) && disposition !== "gaps に記録") {
    findings.push({
      code: "verification-branch-unreachable",
      message: `述語 ${id} は投入後も踏めない（真 ${measuredTrue} 件 / 偽 ${measuredFalse} 件）。足すか、設計の扱いを「gaps に記録」にして根拠を書く`,
    });
  }
}

const USAGE =
  "usage: predicate-coverage-check.mjs --features <.replace/features.md> --design <.replace/dataset/design.md> [--verification <.replace/dataset/verification.md>]";

/**
 * 引数から、読む入力の名前とパスの組を決める。誤りがあれば、そのメッセージを返す。
 *
 * @param {Record<string, string>} args
 * @returns {{ error: string } | { inputs: [string, string][] }}
 */
function listInputs(args) {
  const featuresPath = args["--features"];
  const designPath = args["--design"];
  const verificationPath = args["--verification"];
  if (!featuresPath || !designPath) {
    return { error: "--features と --design は必須" };
  }
  /** @type {[string, string][]} */
  const inputs = [
    ["features", featuresPath],
    ["design", designPath],
  ];
  // `--verification` は任意だが、**値が空のときは未指定へ丸めない**。丸めると 6 節の検査が飛び、
  // 指定したつもりの利用者に「実測して問題なし」と同じ出力を返す。
  if (verificationPath !== undefined) {
    if (verificationPath.trim() === "") {
      return { error: "--verification に空の値が渡っている（省略するか、実在するパスを渡す）" };
    }
    inputs.push(["verification", verificationPath]);
  }
  return { inputs };
}

/**
 * 入力のファイルを読む。読めないファイルがあれば、そのメッセージを返す。
 *
 * @param {[string, string][]} inputs
 * @param {{ readFile: (path: string) => string, cwd: string }} io
 * @returns {{ error: string } | { sources: Record<string, string> }}
 */
function readInputs(inputs, { readFile, cwd }) {
  /** @type {Record<string, string>} */
  const sources = {};
  for (const [key, path] of inputs) {
    try {
      sources[key] = readFile(resolve(cwd, path));
    } catch (error) {
      return {
        error: `${path} を読めない: ${String(error && (typeof error === "object" && "message" in error ? error.message : undefined))}`,
      };
    }
  }
  return { sources };
}

/**
 * CLI 本体。
 *
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const { readFile, cwd, write, writeErr } = cliIo(deps);
  const fail = usageFailer(writeErr, USAGE);
  const parsed = parseFlagPairs(argv, ["--features", "--design", "--verification"]);
  if (parsed.error !== undefined) return fail(parsed.error);
  const listed = listInputs(parsed.args);
  if ("error" in listed) return fail(listed.error);
  const read = readInputs(listed.inputs, { readFile, cwd });
  if ("error" in read) return fail(read.error);
  const { sources } = read;
  const result = checkPredicateCoverage({
    featuresMarkdown: sources.features,
    designMarkdown: sources.design,
    verificationMarkdown: sources.verification ?? null,
  });
  return writeCheckResult(write, result, {
    tool: "predicate-coverage-check",
    version: VERSION,
    fields: {
      findings: result.findings,
    },
  });
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
