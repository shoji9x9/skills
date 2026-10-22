// 手順・観点の軸を足した後に、それより前に閉じた（特性化を終えた）機能を「旧手順のまま」として列挙するチェック。判定の規則は、このファイルで定義する。
// 原本はこのスキルの側にあり、スキルのディレクトリから直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新が反映されるようにするため）。
//
// 何のためか: 機能は 1 つずつ閉じるので、後の機能で見つけた確かめる軸（0 件の表示・送っている間の押し直し等）を
// 手順に足しても、既に閉じた機能へ遡って当てる工程が無いと、前の機能は古い手順のまま収束扱いで残る。
// 成果物の陳腐化の検出（データセット版・採取ツールの版）はどれも「手順が変わった」ことに当たらない。
// そこで、手順の変更を 2 つの出所から読み、変更より前に作られた成果物を持つ機能ごとに
// 「当て直した／当てないと決めた」の記録を要求する。
//   - スキルの手順の改訂: parity-suite が同梱する assets/procedure-revisions.json（--revisions）。
//     成果物の metadata.json の run.procedure_revision がその改訂より小さい機能が対象（キーが無い成果物は 0＝本機構の導入前）
//   - プロジェクト側の観点の追加: .replace/procedure-changes.md の「観点の追加」表（--ledger）。
//     成果物の run.finished_at の日付が追加日以前の機能が対象（同じ日は含める。当てたかを日付で決められないため）
// 判断の記録は同じ台帳の「既に閉じた機能への当て直し」表に追記する。形式の原本は references/procedure-changes.md である。
//
// 何をしないか: 当て直しが本当に行われたかの再測定はしない（記録の形だけを見る）。台帳・成果物の書き換えもしない。
// Issue の open / closed は見ない（成果物があれば閉じていなくても旧手順で特性化されている）。
//
// 終了コードは次のとおりである。
//
// - 0: 対象の組み合わせが、すべて判断済み。
// - 1: 未判断・見直し中が残る。
// - 2: 使い方の誤り・読めない入力（台帳の表や列の欠落、語彙にない値、重複した ID、実在しない変更 ID など）。
// - 3: 未判断は無いが、成果物を読めず、対象かどうかを判定できない機能がある（合格として扱わない）。
// - 4: 対象外（特性化済みの成果物が 1 つも無い。0 件を「旧手順の機能なし」と読ませない）。
//
// 決定論的: 乱数・現在時刻に依存しない。slug は名前順、記録は台帳の順で読む。
// TypeScript 構文は使わない（型は JSDoc）。

import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { makeIo, parseFlagArgs } from "./lib/flag-args.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { stepFence } from "./lib/fence.mjs";
import {
  blankComments,
  collapse,
  opensHtmlBlock,
  parseTables,
  splitRow,
  unclosedFenceMessage,
} from "./lib/markdown.mjs";

/**
 * ツールのバージョン（このファイルで定義する）。判定の規則や出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "3";

/** 成果物の mode の語彙（parity-suite の metadata.json の mode）。 */
export const MODES = ["feature", "api-resource", "batch"];

/** 当て直しの判断の語彙（原本は references/procedure-changes.md「判断の語彙」）。 */
export const DECISIONS = {
  reapplied: "当て直し済み",
  skipped: "当てない",
  inProgress: "見直し中",
};

/** 見直しの置き場のうち、Issue 番号でないもの（変更そのものの完了条件に入れる）。 */
export const PLACEMENT_IN_CHANGE = "この変更の完了条件";

/** 改訂一覧を持つスキル（成果物の run.procedure_revision はこのスキルの改訂番号）。 */
export const REVISIONS_SKILL = "parity-suite";

const CHANGE_HEADERS = ["ID", "追加日", "足した軸", "由来", "対象の種類", "見直しの置き場"];
const RECORD_HEADERS = ["記録 ID", "変更 ID", "slug", "判断", "記録日", "根拠・理由"];

/**
 * `YYYY-MM-DD` として実在する日付か。
 * @param {string} value
 * @returns {boolean}
 */
export function isDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // 2026-02-30 のように Date が繰り上げる値を落とす。
  return date.toISOString().slice(0, 10) === value;
}

/**
 * ISO 8601 の日時から、書かれたままの日付（YYYY-MM-DD）を取る。読めなければ null。
 * @param {unknown} value
 * @returns {string | null}
 */
export function dateOf(value) {
  if (!nonEmptyString(value)) return null;
  // 日付だけ・プレースホルダ（「<ISO 8601 の終了日時>」）を日時として読まない。
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value)) return null;
  // 2026-02-30T… を Date.parse が 03-02 へ繰り上げて受理するので、書かれた日付の実在を先に確かめる。
  if (!isDate(value.slice(0, 10))) return null;
  if (Number.isNaN(Date.parse(value))) return null;
  // UTC へ換算しない。UTC より遅れたオフセット（-05:00 等）の終了日時を換算すると翌日になり、
  // 同じ日に足した軸の対象から外れる（見逃す側と判定されてしまう）。書き手の日付のまま比べる。
  return value.slice(0, 10);
}

/**
 * @typedef {{ id: string, revision: number, axis: string, affects: string[] }} RevisionChange
 */

/**
 * 改訂一覧の changes の 1 要素を検証する。読めない要素は null を返す（理由は errors に積む）。
 * @param {unknown} change
 * @param {string} where
 * @param {{ skill: unknown, revision: number | null, seen: Set<number>, errors: string[] }} context
 * @returns {RevisionChange | null}
 */
function readRevisionChange(change, where, { skill, revision, seen, errors }) {
  if (!isPlainObject(change)) {
    errors.push(`${where} がオブジェクトでない`);
    return null;
  }
  const rev = change.revision;
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1) {
    errors.push(`${where}.revision が 1 以上の整数でない`);
    return null;
  }
  if (revision !== null && rev > revision) {
    errors.push(`${where}.revision が一覧の revision より大きい`);
  }
  if (seen.has(rev)) errors.push(`${where}.revision が重複している: ${rev}`);
  seen.add(rev);
  if (!nonEmptyString(change.axis)) errors.push(`${where}.axis が空`);
  const affects = change.affects;
  if (!isArray(affects) || affects.length === 0) {
    errors.push(`${where}.affects が空`);
    return null;
  }
  // MODES は文字列だけなので、typeof は型を絞るためだけにある（判定は変わらない）。
  /** @type {(mode: unknown) => mode is string & { readonly __isMode: true }} */
  const isMode = (mode) => typeof mode === "string" && MODES.includes(mode);
  const modes = affects.filter(isMode);
  const unknown = affects.filter((mode) => !isMode(mode));
  if (unknown.length > 0) errors.push(`${where}.affects に語彙外の mode: ${unknown.join(", ")}`);
  return {
    id: `${skill}#${rev}`,
    revision: rev,
    axis: String(change.axis),
    affects: modes,
  };
}

/**
 * parity-suite の手順の改訂一覧を検証する。
 * @param {unknown} doc
 * @returns {{ ok: true, skill: string, revision: number, changes: RevisionChange[] } | { ok: false, errors: string[] }}
 */
export function readRevisions(doc) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ["改訂一覧がオブジェクトでない"] };
  const skill = doc.skill;
  if (!nonEmptyString(skill)) errors.push("skill が空");
  // 比べる意味（成果物の run.procedure_revision との大小）は parity-suite の改訂番号にしか無い。別のスキルの改訂一覧を
  // 渡すと、番号が偶然合うだけで無関係な改訂を「当て済み」と認める。
  else if (skill !== REVISIONS_SKILL)
    errors.push(`skill が ${REVISIONS_SKILL} でない（別のスキルの改訂一覧）: ${skill}`);
  // Number.isInteger が真なら数なので、typeof は型を絞るためだけにある（判定は変わらない）。
  const revision =
    typeof doc.revision === "number" && Number.isInteger(doc.revision) ? doc.revision : null;
  if (revision === null || revision < 1) {
    errors.push("revision が 1 以上の整数でない");
  }
  if (!isArray(doc.changes)) {
    errors.push("changes が配列でない");
    return { ok: false, errors };
  }
  /** @type {RevisionChange[]} */
  const changes = [];
  /** @type {Set<number>} */
  const seen = new Set();
  doc.changes.forEach((change, index) => {
    const read = readRevisionChange(change, `changes[${index}]`, { skill, revision, seen, errors });
    if (read !== null) changes.push(read);
  });
  // 一覧の revision は最新の改訂番号。改訂の無い番号を名乗ると、成果物がその番号を書いた時点で
  // 「最新の手順で作った」と読まれ、実在しない改訂との比較になる。
  // 1 から revision までのどの番号にも要素が要る。抜けた番号の改訂は対象の判定から消え、
  // その軸を一度も求めないまま exit 0 になる（最新の番号だけ確かめても抜けは見えない）。
  if (revision !== null) {
    for (let rev = 1; rev <= revision; rev += 1) {
      if (!seen.has(rev)) errors.push(`revision ${rev} に対応する changes の要素が無い`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  // errors が空なら skill は REVISIONS_SKILL、revision は 1 以上の整数なので、次の行は型を絞るためだけにある（到達しない）。
  if (typeof skill !== "string" || revision === null)
    return {
      ok: false,
      errors: [
        "検査を通ったのに skill か revision が決まっていない（このツールの不具合。到達しない分岐に到達した）",
      ],
    };
  return { ok: true, skill, revision, changes };
}

/**
 * 表を列名の集合で探す。同じ列名の表が 2 つ以上あるのは台帳の不整合として落とす。
 * @param {{ headers: string[], rows: string[][] }[]} tables
 * @param {string[]} headers
 * @returns {{ table: { headers: string[], rows: string[][] } | null, duplicated: boolean }}
 */
function findTable(tables, headers) {
  const hits = tables.filter(
    (table) =>
      table.headers.length === headers.length &&
      headers.every((header, index) => table.headers[index] === header),
  );
  return { table: hits[0] ?? null, duplicated: hits.length > 1 };
}

/**
 * 表の行に見えるか。外側の `|` を省いた行（`PC-002 | … | #1`）も表の行として書ける（GFM）ので、
 * `|` で始まるかでは見ない。列が欠けた行（5 セル）も表の外として扱われれば同じく判定から消えるので、
 * 台帳の列数ではなく 3 セル（区切り 2 つ）以上を表の行とみなす。HTML コメントの中は呼び出し側で除く。
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeTableRow(line) {
  const cells = splitRow(line.trim());
  return cells !== null && cells.length >= 3;
}

/**
 * コードフェンスの外で表の行に見える行を数える（parseTables が読んだ行と突き合わせるため）。
 * 読んだ行は件数の差し引きではなく行番号で除く。外側の `|` を省いた表の行は `|` で始まらないので、
 * 件数で差し引くと表の外の行を打ち消して、警告なしに通してしまう。
 * @param {string} text
 * @param {Set<number>} [consumed] parseTables が表として読んだ行番号（数えない）
 * @returns {number}
 */
export function countRowLikeLines(text, consumed = new Set()) {
  /** @type {boolean[]} */
  const fenced = [];
  let count = 0;
  // HTML コメント（テンプレートの記入例・説明）は表ではない。parseTables と同じ blankComments で空白にしてから数える。
  // フェンスも parseTables と同じく、blankComments が置き換える前の行で判定した fenced を使う。
  blankComments(text.split(/\r?\n/u), fenced).forEach((line, index) => {
    if (fenced[index]) return;
    if (!consumed.has(index) && looksLikeTableRow(line)) count += 1;
  });
  return count;
}

/**
 * HTML コメントの記号が、台帳で扱える位置にだけあるかを確かめる。
 * 扱える形は「行頭の `<!--` で始まり行末の `-->` で終わる 1 行」「行頭の `<!--` だけの開始行 … 行末の `-->` で終わる終了行」の 2 つ。
 * 行頭は、blankComments と同じく字下げ 3 文字までとする。
 * それ以外（散文の後ろの `<!--`、行の途中の `-->`、1 行に複数の記号、エスケープした `\<!--`、閉じないコメント）は落とす。
 * parseTables の読み方（blankComments）は GFM の描画と食い違う形が残っているので、その形の台帳を読まずに止める。
 * @param {string} text
 * @returns {{ lines: number[], unclosed: boolean }} 扱えない位置の記号を含む行番号（1 始まり）と、閉じないコメントの有無
 */
export function strayCommentMarkers(text) {
  /** @type {number[]} */
  const lines = [];
  /** @type {string | null} */
  let fence = null;
  let comment = false;
  text.split(/\r?\n/u).forEach((line, index) => {
    const trimmed = line.trim();
    const opens = trimmed.split("<!--").length - 1;
    const closes = trimmed.split("-->").length - 1;
    if (comment) {
      if (closes === 0 && opens === 0) return;
      if (opens > 0 || closes > 1 || !trimmed.endsWith("-->")) lines.push(index + 1);
      comment = false;
      return;
    }
    const step = stepFence(fence, line);
    fence = step.fence;
    if (step.marker || fence !== null) return;
    if (opens === 0 && closes === 0) return;
    if (!opensHtmlBlock(line) || opens > 1 || closes > 1) {
      lines.push(index + 1);
      return;
    }
    if (closes === 0) comment = true;
    else if (!trimmed.endsWith("-->")) lines.push(index + 1);
  });
  return { lines, unclosed: comment };
}

/**
 * 対象の種類のセルを読む。`*` は全 mode。
 * @param {string} cell
 * @returns {string[] | null}
 */
export function parseModes(cell) {
  if (cell === "*") return [...MODES];
  const modes = cell
    .split(/[,、]/u)
    .map((mode) => mode.trim())
    .filter((mode) => mode !== "");
  if (modes.length === 0 || modes.some((mode) => !MODES.includes(mode))) return null;
  return modes;
}

/**
 * @typedef {{ id: string, added_at: string, axis: string, origin: string, affects: string[], placement: string }} LedgerChange
 * @typedef {{ id: string, change: string, slug: string, decision: string, recorded_at: string, basis: string }} LedgerRecord
 * @typedef {{ headers: string[], rows: string[][] }} LedgerTable
 */

/**
 * 台帳の 2 つの表を探し、表の形の不備（表が無い・重複・表の外の行・扱えない位置のコメント）を errors に積む。
 * @param {string} text
 * @returns {{ errors: string[], changeTable: LedgerTable | null, recordTable: LedgerTable | null }}
 */
function findLedgerTables(text) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Set<number>} */
  const consumed = new Set();
  const { tables, unclosedFence } = parseTables(text, { consumed });
  // 閉じないフェンスは後ろの表をすべて読めなくするので、表が無いなどのエラーより先に、原因として出す。
  if (unclosedFence !== null) errors.push(`台帳の ${unclosedFenceMessage(unclosedFence)}`);
  const changeTable = findTable(tables, CHANGE_HEADERS);
  const recordTable = findTable(tables, RECORD_HEADERS);
  // 表の不在を「変更なし」「記録なし」と読まない。列名を書き換えた台帳も同じ（警告なしに 0 件になる）。
  if (changeTable.table === null)
    errors.push(`「観点の追加」表が無い（列: ${CHANGE_HEADERS.join(" | ")}）`);
  if (recordTable.table === null) {
    errors.push(`「既に閉じた機能への当て直し」表が無い（列: ${RECORD_HEADERS.join(" | ")}）`);
  }
  if (changeTable.duplicated) errors.push("「観点の追加」表が 2 つ以上ある");
  // 表は空行で終わる。区切り行と行の間に空行を挟むと、以降の行は表の外として警告なしに捨てられ、
  // 「観点の追加」の行なら、その変更の対象が判定から丸ごと消える（偽の合格）。表の外の表の行を数えて落とす。
  const orphans = countRowLikeLines(text, consumed);
  if (orphans > 0) {
    errors.push(
      `表の外に表の行のような行が ${orphans} 行ある（表の途中に空行か HTML コメントの行を挟むと、それ以降の行は読まれない）`,
    );
  }
  if (recordTable.duplicated) errors.push("「既に閉じた機能への当て直し」表が 2 つ以上ある");
  const markers = strayCommentMarkers(text);
  if (markers.lines.length > 0) {
    errors.push(
      `HTML コメントの記号が行頭の <!-- と行末の --> 以外の位置にある（${markers.lines.join(", ")} 行目）`,
    );
  }
  if (markers.unclosed) errors.push("HTML コメントが閉じていない（以降の表が読まれない）");
  return { errors, changeTable: changeTable.table, recordTable: recordTable.table };
}

/**
 * 「観点の追加」表の行を読む。不備は errors に積む。
 * @param {string[][]} rows
 * @param {string[]} errors
 * @returns {{ changes: LedgerChange[], changeIds: Set<string> }}
 */
function readChangeRows(rows, errors) {
  /** @type {LedgerChange[]} */
  const changes = [];
  /** @type {Set<string>} */
  const changeIds = new Set();
  rows.forEach((raw, index) => {
    const where = `観点の追加 ${index + 1} 行目`;
    const row = raw.map(collapse);
    if (row.length !== CHANGE_HEADERS.length) {
      errors.push(`${where}: 列数が ${CHANGE_HEADERS.length} でない`);
      return;
    }
    const [id, addedAt, axis, origin, modesCell, placement] = row;
    if (id === "") errors.push(`${where}: ID が空`);
    // `<スキル名>#<改訂>` はスキルの改訂の変更 ID に予約する（記録の参照先が 2 つに割れないように）。
    else if (id.includes("#"))
      errors.push(`${where}: ID に # を使わない（スキルの改訂の ID と衝突する）: ${id}`);
    else if (changeIds.has(id)) errors.push(`${where}: ID が重複している: ${id}`);
    changeIds.add(id);
    if (!isDate(addedAt)) errors.push(`${where}: 追加日が YYYY-MM-DD でない: ${addedAt}`);
    if (axis === "") errors.push(`${where}: 足した軸が空`);
    if (origin === "") errors.push(`${where}: 由来が空`);
    const affects = parseModes(modesCell);
    if (affects === null) {
      errors.push(`${where}: 対象の種類が * か ${MODES.join(" / ")} の列挙でない: ${modesCell}`);
    }
    // 置き場の無い変更は、当て直しを誰が完了条件に持つのかが決まらない（見つけた機能にだけ直しが入る形に戻る）。
    if (placement !== PLACEMENT_IN_CHANGE && !/^#\d+$/u.test(placement)) {
      errors.push(
        `${where}: 見直しの置き場が「${PLACEMENT_IN_CHANGE}」か #<Issue 番号> でない: ${placement}`,
      );
    }
    changes.push({ id, added_at: addedAt, axis, origin, affects: affects ?? [], placement });
  });
  return { changes, changeIds };
}

/**
 * 「既に閉じた機能への当て直し」表の行を読む。不備は errors に積む。
 * @param {string[][]} rows
 * @param {{ changeIds: Set<string>, skillChangeIds: Set<string>, errors: string[] }} context
 * @returns {LedgerRecord[]}
 */
function readRecordRows(rows, { changeIds, skillChangeIds, errors }) {
  /** @type {LedgerRecord[]} */
  const records = [];
  const recordIds = new Set();
  const decisions = Object.values(DECISIONS);
  rows.forEach((raw, index) => {
    const where = `当て直し ${index + 1} 行目`;
    const row = raw.map(collapse);
    if (row.length !== RECORD_HEADERS.length) {
      errors.push(`${where}: 列数が ${RECORD_HEADERS.length} でない`);
      return;
    }
    const [id, change, slug, decision, recordedAt, basis] = row;
    if (id === "") errors.push(`${where}: 記録 ID が空`);
    else if (recordIds.has(id)) errors.push(`${where}: 記録 ID が重複している: ${id}`);
    recordIds.add(id);
    // 綴り違いの変更 ID は、どの変更も解決しないまま「記録した」つもりになる。
    if (!changeIds.has(change) && !skillChangeIds.has(change)) {
      errors.push(`${where}: 変更 ID が台帳にも改訂一覧にも無い: ${change}`);
    }
    if (slug === "") errors.push(`${where}: slug が空`);
    if (!decisions.includes(decision)) {
      errors.push(`${where}: 判断が ${decisions.join(" / ")} のどれでもない: ${decision}`);
    }
    if (!isDate(recordedAt)) errors.push(`${where}: 記録日が YYYY-MM-DD でない: ${recordedAt}`);
    // 当て直しは根拠（PR・commit・成果物）、当てないは理由、見直し中は置き場が要る。どれも空では判断が読めない。
    if (basis === "" || basis === "-" || basis === "—") errors.push(`${where}: 根拠・理由が空`);
    // 見直し中は置き場で追っていることが要る。散文だけでは、どこで当て直すのかが読めない。
    else if (decision === DECISIONS.inProgress && !/^#\d+/u.test(basis)) {
      errors.push(`${where}: 見直し中の根拠・理由が #<Issue 番号> で始まらない: ${basis}`);
    }
    records.push({ id, change, slug, decision, recorded_at: recordedAt, basis });
  });
  return records;
}

/**
 * プロジェクト側の台帳（.replace/procedure-changes.md）を読む。
 * @param {string} text
 * @param {Set<string>} skillChangeIds 改訂一覧が定める変更 ID（記録の参照先として有効なもの）
 * @returns {{ ok: true, changes: LedgerChange[], records: LedgerRecord[] } | { ok: false, errors: string[] }}
 */
export function readProcedureLedger(text, skillChangeIds) {
  const { errors, changeTable, recordTable } = findLedgerTables(text);
  if (errors.length > 0) return { ok: false, errors };
  // 表が無ければ上で errors に積んで返しているので、次の行は型を絞るためだけにある（到達しない）。
  if (changeTable === null || recordTable === null)
    return {
      ok: false,
      errors: ["検査を通ったのに表が読めていない（このツールの不具合。到達しない分岐に到達した）"],
    };
  const { changes, changeIds } = readChangeRows(changeTable.rows, errors);
  const records = readRecordRows(recordTable.rows, { changeIds, skillChangeIds, errors });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, changes, records };
}

/**
 * @typedef {{ slug: string, mode: string | null, procedure_revision: number | null, finished_on: string | null, problems: string[] }} ArtifactEntry
 */

/**
 * 成果物を読めず、対象かどうかを判定できない slug の記録を作る。
 * @param {string} slug
 * @param {string} problem
 * @returns {ArtifactEntry}
 */
function unreadableArtifact(slug, problem) {
  return { slug, mode: null, procedure_revision: null, finished_on: null, problems: [problem] };
}

/**
 * パスの状態を、在る（present）・リンク先の無いシンボリックリンク（dangling-link）・無い（missing）・
 * 調べられない（unreadable）に分ける。
 * statSync はリンクを辿るので、リンク先が無いと例外を投げる。そのときだけ lstatSync でパス自身がリンクかを見る。
 * 無いと言えるのは ENOENT・ENOTDIR のときだけで、それ以外の失敗（権限が無いなど）は unreadable にする。
 * missing にすると、読めない成果物や台帳が「無い」として扱われ、判定から警告なしに外れる。
 * @param {string} path
 * @returns {"present" | "dangling-link" | "missing" | "unreadable"}
 */
export function pathState(path) {
  try {
    statSync(path);
    return "present";
  } catch (error) {
    if (!isNotFound(error)) return "unreadable";
    try {
      return lstatSync(path).isSymbolicLink() ? "dangling-link" : "missing";
    } catch (lstatError) {
      return isNotFound(lstatError) ? "missing" : "unreadable";
    }
  }
}

/**
 * fs の例外が「パスが無い」ことを表すか。
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFound(error) {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * run.procedure_revision を読む。読めなければ null を返し、理由を problems に積む。
 * @param {Record<string, unknown>} run
 * @param {number} latestRevision
 * @param {string[]} problems
 * @returns {number | null}
 */
function readProcedureRevision(run, latestRevision, problems) {
  if (!Object.hasOwn(run, "procedure_revision")) {
    // キーが無いのは本機構の導入前の成果物。どの改訂も当たっていないとして 0 で比べる（合格として扱わない）。
    return 0;
  }
  if (
    typeof run.procedure_revision !== "number" ||
    !Number.isInteger(run.procedure_revision) ||
    run.procedure_revision < 0
  ) {
    problems.push("run.procedure_revision が 0 以上の整数でない");
    return null;
  }
  if (run.procedure_revision > latestRevision) {
    // 渡された改訂一覧より新しい手順で作られた成果物。一覧（インストール済みの parity-suite）が古い。
    problems.push(
      `run.procedure_revision (${run.procedure_revision}) が改訂一覧の最新 (${latestRevision}) より大きい（渡した改訂一覧が古い）`,
    );
    return null;
  }
  return run.procedure_revision;
}

/**
 * 読めた metadata.json の中身から、slug の記録を作る。
 * @param {unknown} doc
 * @param {string} name 置き場の slug
 * @param {number} latestRevision
 * @returns {ArtifactEntry}
 */
function artifactFromMetadata(doc, name, latestRevision) {
  /** @type {string[]} */
  const problems = [];
  const meta = isPlainObject(doc) ? doc : {};
  // 置き場の slug と成果物の slug が違えば、別の機能の成果物をこの機能として判定することになる。
  // 欠落や型の誤りも同じく照合できないので、合格として扱わない（parity-suite の metadata.json は slug を必須で持つ）。
  if (meta.slug !== name) {
    problems.push(
      `metadata.json の slug (${JSON.stringify(meta.slug)}) が置き場の slug (${name}) と一致しない`,
    );
  }
  // MODES は文字列だけなので、typeof は型を絞るためだけにある（判定は変わらない）。
  const mode = typeof meta.mode === "string" && MODES.includes(meta.mode) ? meta.mode : null;
  if (mode === null) problems.push(`mode が ${MODES.join(" / ")} のどれでもない`);
  const run = isPlainObject(meta.run) ? meta.run : {};
  return {
    slug: name,
    mode,
    procedure_revision: readProcedureRevision(run, latestRevision, problems),
    finished_on: dateOf(run.finished_at),
    problems,
  };
}

/**
 * 置き場の 1 項目を読む。特性化前の slug とドットファイルは数えないので null を返す。
 * @param {string} parityDir
 * @param {string} name
 * @param {number} latestRevision
 * @returns {ArtifactEntry | null}
 */
function readArtifact(parityDir, name, latestRevision) {
  const dir = join(parityDir, name);
  // リンク先の無いシンボリックリンクでは、statSync が例外を投げる。捨てずに判定不能として残す。
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch (error) {
    return unreadableArtifact(name, `成果物のディレクトリを読めない: ${errorMessage(error)}`);
  }
  // 置き場の外に置く正当なファイルは無い（ドットファイル〈.gitkeep 等〉だけ許す）。
  // slug の置き場がファイルに置き換わった形を警告なしに飛ばすと、その機能が判定から消える。
  if (!isDir) {
    if (name.startsWith(".")) return null;
    return unreadableArtifact(
      name,
      "成果物の置き場がディレクトリでない（slug の置き場がファイルに置き換わっている）",
    );
  }
  const path = join(dir, "metadata.json");
  // metadata.json の無い slug は特性化前（未着手）であって、旧手順で閉じた機能ではない。
  // 中身のあるディレクトリでも同じ扱いにする。parity-suite は metadata.json を終盤（手順 8）で書くので、
  // 対応表・スペックだけがある形は特性化中の正常な状態で、判定不能にすると特性化中の機能 1 つで検査が止まる。
  // 特性化前（metadata.json が本当に無い）と区別し、リンク先の無いリンクは、読めない成果物として残す。
  const metadataState = pathState(path);
  if (metadataState === "dangling-link") {
    return unreadableArtifact(name, "metadata.json がリンク先の無いシンボリックリンク");
  }
  if (metadataState === "unreadable") {
    return unreadableArtifact(name, "metadata.json の有無を調べられない（権限が無いなど）");
  }
  if (metadataState === "missing") return null;
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return unreadableArtifact(name, `metadata.json を読めない: ${errorMessage(error)}`);
  }
  return artifactFromMetadata(doc, name, latestRevision);
}

/**
 * .replace/parity/<slug>/metadata.json を集める。
 * @param {string} parityDir
 * @param {number} latestRevision
 * @returns {{ slugs: ArtifactEntry[] }}
 */
export function readArtifacts(parityDir, latestRevision) {
  /** @type {ArtifactEntry[]} */
  const slugs = [];
  const names = readdirSync(parityDir).sort();
  for (const name of names) {
    const entry = readArtifact(parityDir, name, latestRevision);
    if (entry !== null) slugs.push(entry);
  }
  return { slugs };
}

/**
 * @typedef {{ id: string, axis: string, placement: string | null, source: string }} Hit
 */

/**
 * 1 つの機能について、当て直しの対象になる変更を集める。日付を読めない組は undeterminable に積む。
 * @param {ArtifactEntry} entry
 * @param {string} mode 成果物の mode（読めない成果物は呼び出し側で除く）
 * @param {{ revisionChanges: RevisionChange[], ledgerChanges: LedgerChange[], undeterminable: Array<{ slug: string, change?: string, reason: string }> }} context
 * @returns {Hit[]}
 */
function hitsFor(entry, mode, { revisionChanges, ledgerChanges, undeterminable }) {
  /** @type {Hit[]} */
  const hits = [];
  for (const change of revisionChanges) {
    if (!change.affects.includes(mode)) continue;
    if (entry.procedure_revision === null) continue; // 読めない改訂番号は problems に出ている
    if (entry.procedure_revision < change.revision) {
      hits.push({ id: change.id, axis: change.axis, placement: null, source: "skill" });
    }
  }
  for (const change of ledgerChanges) {
    if (!change.affects.includes(mode)) continue;
    if (entry.finished_on === null) {
      // 日付を読めないと、追加より前に閉じたかを決められない。対象外として扱わない。
      undeterminable.push({
        slug: entry.slug,
        change: change.id,
        reason: "run.finished_at を日時として読めない（追加日より前に作られたかを決められない）",
      });
      continue;
    }
    if (entry.finished_on <= change.added_at) {
      hits.push({
        id: change.id,
        axis: change.axis,
        placement: change.placement,
        source: "project",
      });
    }
  }
  return hits;
}

/**
 * 対象の組み合わせを、最新の判断の記録で未解決か解決済みに振り分ける。
 * @param {Hit} hit
 * @param {{ slug: string, record: { id: string, decision: string, basis: string } | undefined, unresolved: Array<Record<string, unknown>>, resolved: Array<Record<string, unknown>> }} context
 */
function sortHit(hit, { slug, record, unresolved, resolved }) {
  const base = { change: hit.id, slug, axis: hit.axis, source: hit.source };
  if (record === undefined) {
    unresolved.push({ ...base, state: "未判断", placement: hit.placement });
  } else if (record.decision === DECISIONS.inProgress) {
    unresolved.push({
      ...base,
      state: DECISIONS.inProgress,
      placement: hit.placement,
      record: record.id,
      basis: record.basis,
    });
  } else {
    resolved.push({ ...base, state: record.decision, record: record.id, basis: record.basis });
  }
}

/**
 * 変更 × 機能の対象を決め、判断の記録と突き合わせる。
 * @param {{
 *   revisions: { changes: RevisionChange[] },
 *   ledger: { changes: LedgerChange[], records: LedgerRecord[] },
 *   slugs: ArtifactEntry[],
 * }} input
 */
export function check(input) {
  /** @type {Map<string, { id: string, decision: string, recorded_at: string, basis: string }>} */
  const latest = new Map();
  // 追記専用の台帳なので、同じ組み合わせの記録は後の行が現在の判断（見直し中 → 当て直し済み）。
  for (const record of input.ledger.records) {
    latest.set(`${record.change}\u0000${record.slug}`, record);
  }
  /** @type {Array<Record<string, unknown>>} */
  const unresolved = [];
  /** @type {Array<Record<string, unknown>>} */
  const resolved = [];
  /** @type {Array<{ slug: string, change?: string, reason: string }>} */
  const undeterminable = [];
  const targeted = new Set();
  const context = {
    revisionChanges: input.revisions.changes,
    ledgerChanges: input.ledger.changes,
    undeterminable,
  };

  for (const entry of input.slugs) {
    for (const problem of entry.problems)
      undeterminable.push({ slug: entry.slug, reason: problem });
    const { mode } = entry;
    if (mode === null) continue;
    for (const hit of hitsFor(entry, mode, context)) {
      const key = `${hit.id}\u0000${entry.slug}`;
      targeted.add(key);
      sortHit(hit, { slug: entry.slug, record: latest.get(key), unresolved, resolved });
    }
  }

  // 対象でない組み合わせへの記録（slug の綴り違い・特性化前の slug・既に最新の手順で作り直した機能）。落とさず見せる。
  const stray = input.ledger.records
    .filter((record) => !targeted.has(`${record.change}\u0000${record.slug}`))
    .map((record) => ({ record: record.id, change: record.change, slug: record.slug }));

  return { unresolved, resolved, undeterminable, stray };
}

const USAGE =
  "usage: node procedure-staleness-check.mjs --revisions <parity-suite>/assets/procedure-revisions.json " +
  "[--ledger .replace/procedure-changes.md] [--parity-dir .replace/parity] [--change <変更 ID>]";

/**
 * @typedef {import("./lib/flag-args.mjs").Io} Io
 * @typedef {{ changes: LedgerChange[], records: LedgerRecord[] }} Ledger
 */

/**
 * 引数を読む。誤りがあれば error に理由を入れて返す。
 * @param {string[]} argv
 * @returns {{ args: Record<string, string>, error?: undefined } | { args?: undefined, error: string }}
 */
function parseArgs(argv) {
  const known = new Set(["--revisions", "--ledger", "--parity-dir", "--change"]);
  const parsed = parseFlagArgs(argv, known);
  if (parsed.error !== undefined) return parsed;
  const { args } = parsed;
  // 改訂一覧を省略可能にすると、スキルの手順の改訂が、警告なしに判定から消える。
  if (args["--revisions"] === undefined) return { error: "--revisions は必須" };
  return { args };
}

/**
 * 改訂一覧を読んで検証する。読めない・不備があれば出力して終了コードを返す。
 * @param {string} revisionsPath
 * @param {Io} io
 * @returns {{ code: number } | { revisions: { skill: string, revision: number, changes: RevisionChange[] } }}
 */
function loadRevisions(revisionsPath, { out, fail }) {
  /** @type {unknown} */
  let revisionsDoc;
  try {
    revisionsDoc = JSON.parse(readFileSync(revisionsPath, "utf8"));
  } catch (error) {
    return { code: fail(`${revisionsPath} を読めない: ${errorMessage(error)}`) };
  }
  const revisions = readRevisions(revisionsDoc);
  if (!revisions.ok) {
    out({ ok: false, structural: true, revisions: revisionsPath, errors: revisions.errors });
    return { code: 2 };
  }
  return { revisions };
}

/**
 * 台帳を読む。台帳が無いのは「プロジェクト側で観点を足していない」なので空の台帳を返す。
 * 読めない・不備があれば出力して終了コードを返す。
 * @param {{ ledgerPath: string, explicit: boolean, skillChangeIds: Set<string>, io: Io }} options
 * @returns {{ code: number } | { ledger: Ledger, ledgerExists: boolean }}
 */
function loadLedger({ ledgerPath, explicit, skillChangeIds, io: { out, fail } }) {
  // 台帳が無いのは「プロジェクト側で観点を足していない」。ただし出力に残してパスの誤りと区別できるようにする。
  const ledgerState = pathState(ledgerPath);
  const ledgerExists = ledgerState === "present";
  // 台帳が無い（プロジェクト側で軸を足していない）と、台帳を失った状態（リンク先の無いシンボリックリンク）を区別して後者を落とす。
  if (!ledgerExists) {
    if (ledgerState === "dangling-link")
      return { code: fail(`${ledgerPath} がリンク先の無いシンボリックリンク`) };
    if (ledgerState === "unreadable")
      return { code: fail(`${ledgerPath} の有無を調べられない（権限が無いなど）`) };
    // 明示したパスが無いのは綴り・cwd の誤り。「台帳なし」として読むと台帳の未判断が警告なしに消える（--parity-dir と同じ扱い）。
    if (explicit) return { code: fail(`--ledger に渡した ${ledgerPath} が無い`) };
    return { ledger: { changes: [], records: [] }, ledgerExists };
  }
  /** @type {string} */
  let text;
  try {
    text = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    return { code: fail(`${ledgerPath} を読めない: ${errorMessage(error)}`) };
  }
  const read = readProcedureLedger(text, skillChangeIds);
  if (!read.ok) {
    out({ ok: false, structural: true, ledger: ledgerPath, errors: read.errors });
    return { code: 2 };
  }
  return { ledger: read, ledgerExists };
}

/**
 * 成果物の置き場を読む。置き場が無い・ディレクトリでないときは終了コードを返す。
 * @param {string} parityDir
 * @param {number} latestRevision
 * @param {Io} io
 * @returns {{ code: number } | { slugs: ArtifactEntry[] }}
 */
function loadArtifacts(parityDir, latestRevision, { fail }) {
  // 成果物の置き場が無いのを「旧手順の機能なし」として扱わない（cwd の誤り・綴り違いで合格が出る）。
  // 特性化前のプロジェクトでも .replace/parity/ は空のディレクトリとして置けば通る。
  try {
    if (!statSync(parityDir).isDirectory())
      return { code: fail(`${parityDir} がディレクトリでない`) };
    return readArtifacts(parityDir, latestRevision);
  } catch (error) {
    return { code: fail(`${parityDir} を読めない: ${errorMessage(error)}`) };
  }
}

/**
 * --change で 1 つの変更に絞り、受け渡し済みの組を未解決から分ける。
 * @param {ReturnType<typeof check>} all
 * @param {string | undefined} only
 */
function selectResults(all, only) {
  // --change は 1 つの変更の当て直しを完了条件に持つ工程のため。他の変更の未判断で止めない。
  // 変更を名指さない判定不能（成果物を読めない）は、その変更の対象かも決められないので残す。
  const pick = (/** @type {Array<Record<string, unknown>>} */ list) =>
    only === undefined
      ? list
      : list.filter((item) => item.change === undefined || item.change === only);
  // 置き場を別 Issue にした変更は、その Issue の起票までが完了条件。対象の機能に置き場の番号で始まる `見直し中` を
  // 書いたら、この変更の工程としては受け渡し済み（未解決としては --change なしの判定と status が数え続ける）。
  // 置き場と違う番号・未判断は受け渡していないので残す。
  const handedOff = (/** @type {Record<string, unknown>} */ item) =>
    only !== undefined &&
    item.state === DECISIONS.inProgress &&
    typeof item.placement === "string" &&
    /^#\d+$/u.test(item.placement) &&
    new RegExp(`^${item.placement}(?!\\d)`, "u").test(String(item.basis));
  const picked = pick(all.unresolved);
  return {
    unresolved: picked.filter((item) => !handedOff(item)),
    handed_off: picked.filter(handedOff),
    resolved: pick(all.resolved),
    undeterminable: pick(all.undeterminable),
    stray: pick(all.stray),
  };
}

/**
 * 終了コードを決める。
 * @param {ReturnType<typeof selectResults>} result
 * @param {number} artifactCount 数えた成果物の件数
 * @returns {number}
 */
function exitCode(result, artifactCount) {
  // 成果物を 1 つも数えていない実行を exit 0 にしない。「旧手順の機能なし」と「何も見ていない」
  // （別プロジェクトで実行した・特性化前）が同じ出力になる。evidence-gap-check と同じく 4 ＝ 対象外。
  return result.unresolved.length > 0
    ? 1
    : result.undeterminable.length > 0
      ? 3
      : artifactCount === 0
        ? 4
        : 0;
}

/**
 * 出力の artifacts に載せる、成果物 1 件の要約（problems は undeterminable に出すので載せない）。
 * @param {ArtifactEntry} entry
 */
function artifactSummary(entry) {
  return {
    slug: entry.slug,
    mode: entry.mode,
    procedure_revision: entry.procedure_revision,
    finished_on: entry.finished_on,
  };
}

/**
 * CLI。
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const io = makeIo(deps, USAGE);
  const { out, fail } = io;
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) return fail(parsed.error);
  const { args } = parsed;
  const revisionsPath = resolve(cwd, args["--revisions"]);
  const ledgerPath = resolve(cwd, args["--ledger"] ?? ".replace/procedure-changes.md");
  const parityDir = resolve(cwd, args["--parity-dir"] ?? ".replace/parity");

  const loadedRevisions = loadRevisions(revisionsPath, io);
  if ("code" in loadedRevisions) return loadedRevisions.code;
  const { revisions } = loadedRevisions;
  const loadedLedger = loadLedger({
    ledgerPath,
    explicit: args["--ledger"] !== undefined,
    skillChangeIds: new Set(revisions.changes.map((change) => change.id)),
    io,
  });
  if ("code" in loadedLedger) return loadedLedger.code;
  const { ledger, ledgerExists } = loadedLedger;
  const artifacts = loadArtifacts(parityDir, revisions.revision, io);
  if ("code" in artifacts) return artifacts.code;
  const { slugs } = artifacts;
  const all = check({ revisions, ledger, slugs });
  const only = args["--change"];
  // --change に渡した変更 ID は、改訂一覧か台帳の変更にあるものだけを受け付ける。
  const changes = [...revisions.changes, ...ledger.changes];
  if (only !== undefined && !changes.some((change) => change.id === only)) {
    return fail(`--change の変更 ID が台帳にも改訂一覧にも無い: ${only}`);
  }
  const result = selectResults(all, only);
  const code = exitCode(result, slugs.length);
  out({
    ok: code === 0,
    version: VERSION,
    revisions: revisionsPath,
    latest_revision: revisions.revision,
    ledger: ledgerPath,
    ledger_exists: ledgerExists,
    parity_dir: parityDir,
    change: only ?? null,
    artifacts: slugs.map(artifactSummary),
    ...result,
  });
  return code;
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
