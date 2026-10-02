// 手順・観点の軸を足した後に、それより前に閉じた（特性化を終えた）機能を「旧手順のまま」として列挙する検査（正本）。Issue #505。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
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
// 判断の記録は同じ台帳の「既に閉じた機能への当て直し」表に追記する。形式の正本は references/procedure-changes.md。
//
// 何をしないか: 当て直しが本当に行われたかの再測定はしない（記録の形だけを見る）。台帳・成果物の書き換えもしない。
// Issue の open / closed は見ない（成果物があれば閉じていなくても旧手順で特性化されている）。
//
// 終了コード: 0 ＝ 対象の組み合わせがすべて判断済み、1 ＝ 未判断・見直し中が残る、
// 2 ＝ 使い方の誤り・読めない入力（台帳の表・列の欠落、語彙外の値、重複 ID、実在しない変更 ID 等）、
// 3 ＝ 未判断は無いが、成果物を読めず対象かどうかを判定できない機能がある（合格に倒さない）、
// 4 ＝ 対象外（特性化済みの成果物が 1 つも無い。0 件を「旧手順の機能なし」と読ませない）。
//
// 決定論的: 乱数・現在時刻に依存しない。slug は名前順、記録は台帳の順で読む。
// TypeScript 構文は使わない（型は JSDoc）。

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 表の読み方は evidence-gap-check.mjs と同じ（コードフェンスの中は読まない・外側の `|` は省略可）。
// import せずに持つのは、CLI を単体のシンボリックリンク経由・--preserve-symlinks-main で起動すると
// 相対 import がリンクの置き場から解決されて落ちるため（scripts/skills/_cross/skill-script-cli-entry.test.js）。

/**
 * 空白を 1 つに畳み、前後を除く。
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
 * @param {string | undefined} line
 * @returns {string[] | null}
 */
function splitRow(line) {
  if (line === undefined) return null;
  let trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  // GFM はセル内の縦棒を `\|` で書く。区切りにせず、セルの値では `|` に戻す。
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.replaceAll("\\|", "|"));
}

/**
 * Markdown の表を全て取り出す（コードフェンスの中は例示なので読まない）。
 * @param {string} text
 * @param {Set<number>} [consumed] 渡すと、表として読んだ行（見出し・区切り・行）の行番号を入れる
 * @returns {{ headers: string[], rows: string[][] }[]}
 */
export function parseTables(text, consumed) {
  const lines = text.split(/\r?\n/u);
  /** @type {{ headers: string[], rows: string[][] }[]} */
  const tables = [];
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i += 1) {
    // HTML コメントの中の表（コメントアウトした記入例・退役した表）は台帳ではない。読むと、生きた表の代わりに
    // 変更を供給するか、同じ列名の表の重複に化ける。countRowLikeLines と同じ規則で読み飛ばす。
    if (fence === null && (comment || lines[i].trim().startsWith("<!--"))) {
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
    if (delimiter === null || !delimiter.every((cell) => /^:?-+:?$/u.test(cell.trim()))) continue;
    if (delimiter.length !== header.length) continue;
    /** @type {string[][]} */
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const row = splitRow(lines[j]);
      if (row === null) break;
      rows.push(row);
    }
    tables.push({ headers: header.map(collapse), rows });
    if (consumed !== undefined) for (let k = i; k < j; k += 1) consumed.add(k);
    i = j - 1;
  }
  return tables;
}

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 成果物の mode の語彙（parity-suite の metadata.json の mode）。 */
export const MODES = ["feature", "api-resource", "batch"];

/** 当て直しの判断の語彙（正本は references/procedure-changes.md「判断の語彙」）。 */
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
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {value is string}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * プレーンなオブジェクトか。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  // 同じ日に足した軸の対象から漏れる（見逃す側に倒れる）。書き手の日付のまま比べる。
  return value.slice(0, 10);
}

/**
 * parity-suite の手順の改訂一覧を検証する。
 * @param {unknown} doc
 * @returns {{ ok: true, skill: string, revision: number, changes: Array<{ id: string, revision: number, axis: string, affects: string[] }> } | { ok: false, errors: string[] }}
 */
export function readRevisions(doc) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(doc)) return { ok: false, errors: ["改訂一覧がオブジェクトでない"] };
  const skill = doc.skill;
  if (!nonEmptyString(skill)) errors.push("skill が空");
  // 比べる意味（成果物の run.procedure_revision との大小）は parity-suite の改訂番号にしか無い。別のスキルの改訂一覧を
  // 渡すと、番号が偶然合うだけで無関係な改訂を「当て済み」と認める。
  else if (skill !== REVISIONS_SKILL)
    errors.push(`skill が ${REVISIONS_SKILL} でない（別のスキルの改訂一覧）: ${skill}`);
  const revision = doc.revision;
  if (!Number.isInteger(revision) || /** @type {number} */ (revision) < 1) {
    errors.push("revision が 1 以上の整数でない");
  }
  if (!Array.isArray(doc.changes)) {
    errors.push("changes が配列でない");
    return { ok: false, errors };
  }
  /** @type {Array<{ id: string, revision: number, axis: string, affects: string[] }>} */
  const changes = [];
  const seen = new Set();
  doc.changes.forEach((change, index) => {
    const where = `changes[${index}]`;
    if (!isObject(change)) {
      errors.push(`${where} がオブジェクトでない`);
      return;
    }
    const rev = change.revision;
    if (!Number.isInteger(rev) || /** @type {number} */ (rev) < 1) {
      errors.push(`${where}.revision が 1 以上の整数でない`);
      return;
    }
    if (
      Number.isInteger(revision) &&
      /** @type {number} */ (rev) > /** @type {number} */ (revision)
    ) {
      errors.push(`${where}.revision が一覧の revision より大きい`);
    }
    if (seen.has(rev)) errors.push(`${where}.revision が重複している: ${rev}`);
    seen.add(rev);
    if (!nonEmptyString(change.axis)) errors.push(`${where}.axis が空`);
    const affects = change.affects;
    if (!Array.isArray(affects) || affects.length === 0) {
      errors.push(`${where}.affects が空`);
      return;
    }
    const unknown = affects.filter((mode) => !MODES.includes(/** @type {string} */ (mode)));
    if (unknown.length > 0) errors.push(`${where}.affects に語彙外の mode: ${unknown.join(", ")}`);
    changes.push({
      id: `${skill}#${rev}`,
      revision: /** @type {number} */ (rev),
      axis: String(change.axis),
      affects: /** @type {string[]} */ (affects),
    });
  });
  // 一覧の revision は最新の改訂番号。改訂の無い番号を名乗ると、成果物がその番号を書いた時点で
  // 「最新の手順で作った」と読まれ、実在しない改訂との比較になる。
  // 1 から revision までのどの番号にも要素が要る。抜けた番号の改訂は対象の判定から消え、
  // その軸を一度も求めないまま exit 0 になる（最新の番号だけ確かめても抜けは見えない）。
  if (Number.isInteger(revision)) {
    for (let rev = 1; rev <= /** @type {number} */ (revision); rev += 1) {
      if (!seen.has(rev)) errors.push(`revision ${rev} に対応する changes の要素が無い`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    skill: /** @type {string} */ (skill),
    revision: /** @type {number} */ (revision),
    changes,
  };
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
 * `|` で始まるかでは見ない。列が欠けた行（5 セル）も表の外に落ちれば同じく判定から消えるので、
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
 * 読んだ行は件数の差し引きではなく行番号で除く——外側の `|` を省いた表の行は `|` で始まらないので、
 * 件数で差し引くと表の外の行を打ち消して黙って通す。
 * @param {string} text
 * @param {Set<number>} [consumed] parseTables が表として読んだ行番号（数えない）
 * @returns {number}
 */
export function countRowLikeLines(text, consumed = new Set()) {
  let fence = null;
  let comment = false;
  let count = 0;
  text.split(/\r?\n/u).forEach((line, index) => {
    // HTML コメント（テンプレートの記入例・説明）は表ではない。複数行にまたがるコメントも中を数えない。
    if (fence === null && (comment || line.trim().startsWith("<!--"))) {
      comment = !line.includes("-->");
      return;
    }
    const mark = fenceOf(line);
    if (mark !== null) {
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      return;
    }
    if (fence === null && !consumed.has(index) && looksLikeTableRow(line)) count += 1;
  });
  return count;
}

/**
 * HTML コメントの記号が、読み飛ばしの規則（parseTables / countRowLikeLines）が扱える位置にだけあるかを確かめる。
 * 扱える形は「行頭の `<!--` で始まり行末の `-->` で終わる 1 行」「行頭の `<!--` だけの開始行 … 行末の `-->` で終わる終了行」の 2 つ。
 * それ以外（散文の後ろの `<!--`、行の途中の `-->`、1 行に複数の記号、閉じないコメント）は読める形を足さずに落とす——
 * 読み飛ばしの規則に合わない位置のコメントは、中の表を生きた表として読むか、以降の表を丸ごと読み飛ばす。
 * @param {string} text
 * @returns {{ lines: number[], unclosed: boolean }} 扱えない位置の記号を含む行番号（1 始まり）と、閉じないコメントの有無
 */
export function strayCommentMarkers(text) {
  /** @type {number[]} */
  const lines = [];
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
    const mark = fenceOf(line);
    if (mark !== null) {
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;
    if (opens === 0 && closes === 0) return;
    if (!trimmed.startsWith("<!--") || opens > 1 || closes > 1) {
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
 * プロジェクト側の台帳（.replace/procedure-changes.md）を読む。
 * @param {string} text
 * @param {Set<string>} skillChangeIds 改訂一覧が定める変更 ID（記録の参照先として有効なもの）
 * @returns {{ ok: true, changes: Array<{ id: string, added_at: string, axis: string, origin: string, affects: string[], placement: string }>, records: Array<{ id: string, change: string, slug: string, decision: string, recorded_at: string, basis: string }> } | { ok: false, errors: string[] }}
 */
export function readLedger(text, skillChangeIds) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Set<number>} */
  const consumed = new Set();
  const tables = parseTables(text, consumed);
  const changeTable = findTable(tables, CHANGE_HEADERS);
  const recordTable = findTable(tables, RECORD_HEADERS);
  // 表の不在を「変更なし」「記録なし」と読まない。列名を書き換えた台帳も同じ（黙って 0 件になる）。
  if (changeTable.table === null)
    errors.push(`「観点の追加」表が無い（列: ${CHANGE_HEADERS.join(" | ")}）`);
  if (recordTable.table === null) {
    errors.push(`「既に閉じた機能への当て直し」表が無い（列: ${RECORD_HEADERS.join(" | ")}）`);
  }
  if (changeTable.duplicated) errors.push("「観点の追加」表が 2 つ以上ある");
  // 表は空行で終わる。区切り行と行の間に空行を挟むと、以降の行は表の外として黙って捨てられ、
  // 「観点の追加」の行なら、その変更の対象が判定から丸ごと消える（偽の合格）。表の外の表の行を数えて落とす。
  const orphans = countRowLikeLines(text, consumed);
  if (orphans > 0) {
    errors.push(
      `表の外に表の行のような行が ${orphans} 行ある（表の途中に空行を挟むと、それ以降の行は読まれない）`,
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
  if (errors.length > 0) return { ok: false, errors };

  /** @type {Array<{ id: string, added_at: string, axis: string, origin: string, affects: string[], placement: string }>} */
  const changes = [];
  const changeIds = new Set();
  /** @type {{ headers: string[], rows: string[][] }} */ (changeTable.table).rows.forEach(
    (raw, index) => {
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
    },
  );

  /** @type {Array<{ id: string, change: string, slug: string, decision: string, recorded_at: string, basis: string }>} */
  const records = [];
  const recordIds = new Set();
  const decisions = Object.values(DECISIONS);
  /** @type {{ headers: string[], rows: string[][] }} */ (recordTable.table).rows.forEach(
    (raw, index) => {
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
    },
  );
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, changes, records };
}

/**
 * .replace/parity/<slug>/metadata.json を集める。
 * @param {string} parityDir
 * @param {number} latestRevision
 * @returns {{ slugs: Array<{ slug: string, mode: string | null, procedure_revision: number | null, finished_on: string | null, problems: string[] }> }}
 */
export function readArtifacts(parityDir, latestRevision) {
  /** @type {Array<{ slug: string, mode: string | null, procedure_revision: number | null, finished_on: string | null, problems: string[] }>} */
  const slugs = [];
  const names = readdirSync(parityDir).sort();
  for (const name of names) {
    const dir = join(parityDir, name);
    // 壊れたシンボリックリンクは statSync が例外を投げる。捨てずに判定不能として残す。
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch (error) {
      slugs.push({
        slug: name,
        mode: null,
        procedure_revision: null,
        finished_on: null,
        problems: [
          `成果物のディレクトリを読めない: ${error && /** @type {Error} */ (error).message}`,
        ],
      });
      continue;
    }
    // 置き場の外に置く正当なファイルは無い（ドットファイル〈.gitkeep 等〉だけ許す）。
    // slug の置き場がファイルに置き換わった形を黙って飛ばすと、その機能が判定から消える。
    if (!isDir) {
      if (!name.startsWith(".")) {
        slugs.push({
          slug: name,
          mode: null,
          procedure_revision: null,
          finished_on: null,
          problems: [
            "成果物の置き場がディレクトリでない（slug の置き場がファイルに置き換わっている）",
          ],
        });
      }
      continue;
    }
    const path = join(dir, "metadata.json");
    // metadata.json の無い slug は特性化前（未着手）であって、旧手順で閉じた機能ではない。
    // 中身のあるディレクトリでも同じ扱いにする——parity-suite は metadata.json を終盤（手順 8）で書くので、
    // 対応表・スペックだけがある形は特性化中の正常な状態で、判定不能にすると特性化中の機能 1 つで検査が止まる。
    if (!existsSync(path)) {
      // existsSync はリンクを辿るので、壊れたシンボリックリンクも「無い」になる。
      // 特性化前（metadata.json が本当に無い）と区別し、壊れたリンクは読めない成果物として残す。
      let linked = false;
      try {
        linked = lstatSync(path).isSymbolicLink();
      } catch {
        linked = false;
      }
      if (linked) {
        slugs.push({
          slug: name,
          mode: null,
          procedure_revision: null,
          finished_on: null,
          problems: ["metadata.json が壊れたシンボリックリンク（リンク先が無い）"],
        });
      }
      continue;
    }
    /** @type {string[]} */
    const problems = [];
    /** @type {unknown} */
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      slugs.push({
        slug: name,
        mode: null,
        procedure_revision: null,
        finished_on: null,
        problems: [`metadata.json を読めない: ${error && /** @type {Error} */ (error).message}`],
      });
      continue;
    }
    const meta = isObject(doc) ? doc : {};
    // 置き場の slug と成果物の slug が違えば、別の機能の成果物をこの機能として判定することになる。
    // 欠落・型崩れも同じく照合できないので合格に倒さない（parity-suite の metadata.json は slug を必須で持つ）。
    if (meta.slug !== name) {
      problems.push(
        `metadata.json の slug (${JSON.stringify(meta.slug)}) が置き場の slug (${name}) と一致しない`,
      );
    }
    const mode = MODES.includes(/** @type {string} */ (meta.mode))
      ? /** @type {string} */ (meta.mode)
      : null;
    if (mode === null) problems.push(`mode が ${MODES.join(" / ")} のどれでもない`);
    const run = isObject(meta.run) ? meta.run : {};
    /** @type {number | null} */
    let procedureRevision = null;
    if (!Object.hasOwn(run, "procedure_revision")) {
      // キーが無いのは本機構の導入前の成果物。どの改訂も当たっていないとして 0 で比べる（合格に倒さない）。
      procedureRevision = 0;
    } else if (
      !Number.isInteger(run.procedure_revision) ||
      /** @type {number} */ (run.procedure_revision) < 0
    ) {
      problems.push("run.procedure_revision が 0 以上の整数でない");
    } else if (/** @type {number} */ (run.procedure_revision) > latestRevision) {
      // 渡された改訂一覧より新しい手順で作られた成果物。一覧（インストール済みの parity-suite）が古い。
      problems.push(
        `run.procedure_revision (${run.procedure_revision}) が改訂一覧の最新 (${latestRevision}) より大きい（渡した改訂一覧が古い）`,
      );
    } else {
      procedureRevision = /** @type {number} */ (run.procedure_revision);
    }
    slugs.push({
      slug: name,
      mode,
      procedure_revision: procedureRevision,
      finished_on: dateOf(run.finished_at),
      problems,
    });
  }
  return { slugs };
}

/**
 * 変更 × 機能の対象を決め、判断の記録と突き合わせる。
 * @param {{
 *   revisions: { changes: Array<{ id: string, revision: number, axis: string, affects: string[] }> },
 *   ledger: { changes: Array<{ id: string, added_at: string, axis: string, affects: string[], placement: string }>, records: Array<{ id: string, change: string, slug: string, decision: string, recorded_at: string, basis: string }> },
 *   slugs: Array<{ slug: string, mode: string | null, procedure_revision: number | null, finished_on: string | null, problems: string[] }>,
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

  for (const entry of input.slugs) {
    for (const problem of entry.problems)
      undeterminable.push({ slug: entry.slug, reason: problem });
    if (entry.mode === null) continue;

    /** @type {Array<{ id: string, axis: string, placement: string | null, source: string }>} */
    const hits = [];
    for (const change of input.revisions.changes) {
      if (!change.affects.includes(entry.mode)) continue;
      if (entry.procedure_revision === null) continue; // 読めない改訂番号は problems に出ている
      if (entry.procedure_revision < change.revision) {
        hits.push({ id: change.id, axis: change.axis, placement: null, source: "skill" });
      }
    }
    for (const change of input.ledger.changes) {
      if (!change.affects.includes(entry.mode)) continue;
      if (entry.finished_on === null) {
        // 日付を読めないと、追加より前に閉じたかを決められない。対象外に倒さない。
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

    for (const hit of hits) {
      const key = `${hit.id}\u0000${entry.slug}`;
      targeted.add(key);
      const record = latest.get(key);
      const base = { change: hit.id, slug: entry.slug, axis: hit.axis, source: hit.source };
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
 * CLI。
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const out = (/** @type {unknown} */ value) =>
    (deps.stdout ?? ((s) => process.stdout.write(s)))(`${JSON.stringify(value, null, 2)}\n`);
  const fail = (/** @type {string} */ message) => {
    (deps.stderr ?? ((s) => process.stderr.write(s)))(`${message}\n${USAGE}\n`);
    return 2;
  };
  const known = new Set(["--revisions", "--ledger", "--parity-dir", "--change"]);
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!known.has(key)) return fail(`未知の引数: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return fail(`${key} に値が無い`);
    if (Object.hasOwn(args, key)) return fail(`${key} が重複している`);
    args[key] = value;
    i += 1;
  }
  // 改訂一覧を省略可能にすると、スキルの手順の改訂が黙って判定から消える。
  if (args["--revisions"] === undefined) return fail("--revisions は必須");
  const revisionsPath = resolve(cwd, args["--revisions"]);
  const ledgerPath = resolve(cwd, args["--ledger"] ?? ".replace/procedure-changes.md");
  const parityDir = resolve(cwd, args["--parity-dir"] ?? ".replace/parity");

  /** @type {unknown} */
  let revisionsDoc;
  try {
    revisionsDoc = JSON.parse(readFileSync(revisionsPath, "utf8"));
  } catch (error) {
    return fail(`${revisionsPath} を読めない: ${error && /** @type {Error} */ (error).message}`);
  }
  const revisions = readRevisions(revisionsDoc);
  if (!revisions.ok) {
    out({ ok: false, structural: true, revisions: revisionsPath, errors: revisions.errors });
    return 2;
  }

  // 台帳が無いのは「プロジェクト側で観点を足していない」。ただし出力に残してパスの誤りと区別できるようにする。
  const ledgerExists = existsSync(ledgerPath);
  // existsSync はリンクを辿るので、壊れたシンボリックリンクの台帳も「無い」になる。
  // 台帳が無い（プロジェクト側で軸を足していない）と、台帳を失った状態を区別して後者を落とす。
  if (!ledgerExists) {
    let linked = false;
    try {
      linked = lstatSync(ledgerPath).isSymbolicLink();
    } catch {
      linked = false;
    }
    if (linked) return fail(`${ledgerPath} が壊れたシンボリックリンク（リンク先が無い）`);
    // 明示したパスが無いのは綴り・cwd の誤り。「台帳なし」として読むと台帳の未判断が黙って消える（--parity-dir と同じ扱い）。
    if (args["--ledger"] !== undefined) return fail(`--ledger に渡した ${ledgerPath} が無い`);
  }
  /** @type {{ changes: any[], records: any[] }} */
  let ledger = { changes: [], records: [] };
  if (ledgerExists) {
    const skillChangeIds = new Set(revisions.changes.map((change) => change.id));
    /** @type {string} */
    let text;
    try {
      text = readFileSync(ledgerPath, "utf8");
    } catch (error) {
      return fail(`${ledgerPath} を読めない: ${error && /** @type {Error} */ (error).message}`);
    }
    const read = readLedger(text, skillChangeIds);
    if (!read.ok) {
      out({ ok: false, structural: true, ledger: ledgerPath, errors: read.errors });
      return 2;
    }
    ledger = read;
  }

  // 成果物の置き場が無いのを「旧手順の機能なし」に倒さない（cwd の誤り・綴り違いで合格が出る）。
  // 特性化前のプロジェクトでも .replace/parity/ は空のディレクトリとして置けば通る。
  /** @type {ReturnType<typeof readArtifacts>} */
  let artifacts;
  try {
    if (!statSync(parityDir).isDirectory()) return fail(`${parityDir} がディレクトリでない`);
    artifacts = readArtifacts(parityDir, revisions.revision);
  } catch (error) {
    return fail(`${parityDir} を読めない: ${error && /** @type {Error} */ (error).message}`);
  }
  const { slugs } = artifacts;
  const all = check({ revisions, ledger, slugs });
  // --change は 1 つの変更の当て直しを完了条件に持つ工程のため。他の変更の未判断で止めない。
  // 変更を名指さない判定不能（成果物を読めない）は、その変更の対象かも決められないので残す。
  const only = args["--change"];
  if (only !== undefined) {
    const ids = new Set([...revisions.changes, ...ledger.changes].map((change) => change.id));
    if (!ids.has(only)) return fail(`--change の変更 ID が台帳にも改訂一覧にも無い: ${only}`);
  }
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
  const result = {
    unresolved: picked.filter((item) => !handedOff(item)),
    handed_off: picked.filter(handedOff),
    resolved: pick(all.resolved),
    undeterminable: pick(all.undeterminable),
    stray: pick(all.stray),
  };
  // 成果物を 1 つも数えていない実行を exit 0 にしない。「旧手順の機能なし」と「何も見ていない」
  // （別プロジェクトで実行した・特性化前）が同じ出力になる。evidence-gap-check と同じく 4 ＝ 対象外。
  const code =
    result.unresolved.length > 0
      ? 1
      : result.undeterminable.length > 0
        ? 3
        : slugs.length === 0
          ? 4
          : 0;
  out({
    ok: code === 0,
    version: VERSION,
    revisions: revisionsPath,
    latest_revision: revisions.revision,
    ledger: ledgerPath,
    ledger_exists: ledgerExists,
    parity_dir: parityDir,
    change: only ?? null,
    artifacts: slugs.map((entry) => ({
      slug: entry.slug,
      mode: entry.mode,
      procedure_revision: entry.procedure_revision,
      finished_on: entry.finished_on,
    })),
    unresolved: result.unresolved,
    handed_off: result.handed_off,
    resolved: result.resolved,
    undeterminable: result.undeterminable,
    stray: result.stray,
  });
  return code;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
