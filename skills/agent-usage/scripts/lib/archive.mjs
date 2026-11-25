// 古い行を records/ から別のディレクトリへ移す（archive）と、移した境界の時刻（records/.archived-before）の読み書き。
// 境界より前に終わった行は records/ に無いので、collect はその行を書かない（新しい clone でも、ログが長く残っていても書き直さない）。
// report は、移した先を手元に取得したディレクトリを --archive で受け取って、records/ と合わせて読む。

import { existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeFileAtomic } from "./atomic.mjs";
import { parseCsv, toCsv } from "./csv.mjs";
import { columnsWithExtra } from "./records.mjs";
import { parseTime, toIso } from "./time.mjs";
import { filesUnder } from "./walk.mjs";

/** @typedef {Record<string, string>} RawRow */

/** 移した境界の時刻を書くファイル（records/ の直下）。CSV ではないので、記録を読む処理は読まない。 */
export const ARCHIVED_BEFORE_FILE = ".archived-before";

/**
 * @param {string} recordsDir
 * @returns {string}
 */
export function archivedBeforePath(recordsDir) {
  return join(recordsDir, ARCHIVED_BEFORE_FILE);
}

/**
 * 移した境界の時刻を読む。ファイルが無ければ null（まだ移していない）。
 * 中身が末尾が Z の ISO 8601 の時刻でなければエラーにする。読めないときに境界が無いとして扱うと、移した行を collect が書き直すため。
 * @param {string} recordsDir
 * @returns {number | null}
 */
export function readArchivedBefore(recordsDir) {
  const path = archivedBeforePath(recordsDir);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(text) ? parseTime(text) : null;
  if (t === null)
    throw new Error(
      `${path}: 移した境界の時刻（末尾が Z の ISO 8601）でない: ${JSON.stringify(text.slice(0, 80))}`,
    );
  return t;
}

/**
 * 行を移すかを決める時刻。行の終わり（end）、無ければ始まり（start）、それも無ければ記録した時刻（observed_at）。
 * どれも時刻でなければ null。
 * @param {Readonly<Record<string, string | undefined>>} r
 * @returns {number | null}
 */
export function rowEndTime(r) {
  return parseTime(r.end) ?? parseTime(r.start) ?? parseTime(r.observed_at);
}

/**
 * --before の日付（YYYY-MM-DD）を、その日の UTC の 0 時にする。暦に無い日付は null。
 * @param {string} date
 * @returns {number | null}
 */
export function utcDateStart(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date ? t : null;
}

/**
 * @typedef {object} ArchiveOptions
 * @property {string} recordsDir
 * @property {number} now
 * @property {string} before 移す境界の日付（YYYY-MM-DD。UTC の 0 時）
 * @property {string} out 移した行を書くディレクトリ
 * @property {boolean} dryRun true なら、移す行を数えるだけで、何も書かない
 */

/**
 * @typedef {object} ArchiveReport
 * @property {number} boundary 移した境界の時刻
 * @property {number | null} previous 前の境界の時刻（無ければ null）
 * @property {number} movedRows 移した行の数
 * @property {string[]} outFiles 書いた（dryRun なら書く）移した先のファイル
 * @property {string[]} rewritten 行を減らして書き直した records/ のファイル
 * @property {string[]} removed すべての行を移したので消した records/ のファイル
 */

/**
 * 1 つの記録のファイルを、移す行と残す行に分ける。
 * @param {string} f
 * @param {string} where エラーに添える位置
 * @param {number} boundary
 */
function splitFile(f, where, boundary) {
  const text = readFileSync(f, "utf8");
  const rows = parseCsv(text);
  /** @type {RawRow[]} */
  const moved = [];
  /** @type {RawRow[]} */
  const kept = [];
  rows.forEach((r, i) => {
    const t = rowEndTime(r);
    // 時刻の無い行は、移すかを決められない。警告なしに残すと、境界より前の行が records/ に残り続けるので止める
    if (t === null)
      throw new Error(`${where}:${i + 2}: end・start・observed_at のどれも時刻でない`);
    (t < boundary ? moved : kept).push(r);
  });
  return { moved, kept, crlf: text.includes("\r\n") };
}

/**
 * 移した先のファイルの名前（行の終わりの UTC の年月）。
 * @param {RawRow} r
 * @returns {string}
 */
function monthFileOf(r) {
  return `${toIso(rowEndTime(r) ?? 0).slice(0, 7)}.csv`;
}

/**
 * 移した先のファイルに行を足す。既にあるファイルの行と全列が同じ行は足さない
 * （archive が途中で止まった後に実行し直しても、同じ行を重ねない）。
 * @param {string} path
 * @param {readonly RawRow[]} rows
 */
function writeOutFile(path, rows) {
  const prev = existsSync(path) ? parseCsv(readFileSync(path, "utf8")) : [];
  const columns = columnsWithExtra([...prev, ...rows]);
  /** @param {RawRow} r */
  const sig = (r) => JSON.stringify(columns.map((c) => r[c] ?? ""));
  const seen = new Set(prev.map(sig));
  const added = rows.filter((r) => {
    const s = sig(r);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
  writeFileAtomic(path, toCsv(columns, [...prev, ...added]));
}

/**
 * dir が base の中（base 自身を含む）か。
 * @param {string} dir
 * @param {string} base
 * @returns {boolean}
 */
function isWithinDir(dir, base) {
  const rel = relative(realPathOf(base), realPathOf(dir));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * シンボリックリンクを解決した実体のパス。まだ無いパスは、在る一番近い祖先を解決し、残りを後ろに足す。
 * --out にシンボリックリンク（records/ を指すもの、records/ の祖先を指すもの）を渡したときも、records/ との重なりを見つけるため。
 * @param {string} p
 * @returns {string}
 */
function realPathOf(p) {
  const abs = resolve(p);
  /** @type {string[]} */
  const rest = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...rest);
}

/**
 * 終わりの時刻が --before の日の UTC の 0 時より前の行を、records/ から out の月ごとのファイルへ移し、境界を進める。
 * 書く順は、境界・移した先・records/ の書き直しである。途中で止まっても、境界より前の行を collect が書き直さず、
 * 実行し直すと残った行を移す（移した先に同じ行があれば重ねない）。
 * @param {ArchiveOptions} o
 * @returns {ArchiveReport}
 */
export function runArchive(o) {
  const { boundary, previous } = checkArchive(o);
  const plan = filesUnder(o.recordsDir, ".csv").map((f) => ({
    f,
    ...splitFile(f, relative(o.recordsDir, f), boundary),
  }));
  const byMonth = groupByMonth(plan);
  const changed = plan.filter((p) => p.moved.length > 0);
  const report = {
    boundary,
    previous,
    movedRows: changed.reduce((n, p) => n + p.moved.length, 0),
    outFiles: [...byMonth.keys()].sort().map((n) => join(o.out, n)),
    rewritten: changed.filter((p) => p.kept.length > 0).map((p) => p.f),
    removed: changed.filter((p) => p.kept.length === 0).map((p) => p.f),
  };
  if (o.dryRun) return report;
  writeFileAtomic(archivedBeforePath(o.recordsDir), `${toIso(boundary)}\n`);
  for (const [name, rows] of byMonth) writeOutFile(join(o.out, name), rows);
  for (const p of changed) rewriteSource(p);
  return report;
}

/**
 * 引数と前の境界を確かめ、移す境界を返す。誤りはエラーにする。
 * @param {ArchiveOptions} o
 * @returns {{ boundary: number; previous: number | null }}
 */
function checkArchive(o) {
  const boundary = utcDateStart(o.before);
  if (boundary === null) throw new Error("--before は暦に在る日付を YYYY-MM-DD で書く");
  if (boundary > o.now)
    throw new Error("--before に今日より後の日付（UTC の日付で比べる）は書けない");
  if (isWithinDir(o.out, o.recordsDir))
    throw new Error(
      `--out に records/ の中（${o.recordsDir}）は書けない。records/ の外のディレクトリを渡す`,
    );
  // records/ を含むディレクトリ（.agent-usage/ やリポジトリの直下）に移すと、report の --archive がそこを読むときに、
  // records/ と report/ の CSV もたどって読み、records/ の外の CSV（report の結果）の行でエラーになる
  if (isWithinDir(o.recordsDir, o.out))
    throw new Error(
      `--out に records/ を含むディレクトリ（${o.out}）は書けない。records/ を含まないディレクトリを渡す`,
    );
  const previous = readArchivedBefore(o.recordsDir);
  if (previous !== null && boundary < previous)
    throw new Error(
      `--before（${toIso(boundary)}）が、前に移した境界（${toIso(previous)}）より前になっている。境界は戻せない`,
    );
  return { boundary, previous };
}

/**
 * 移す行を、移した先のファイルの名前ごとにまとめる。
 * @param {readonly { moved: readonly RawRow[] }[]} plan
 * @returns {Map<string, RawRow[]>}
 */
function groupByMonth(plan) {
  /** @type {Map<string, RawRow[]>} */
  const byMonth = new Map();
  for (const p of plan)
    for (const r of p.moved) {
      const name = monthFileOf(r);
      const list = byMonth.get(name);
      if (list) list.push(r);
      else byMonth.set(name, [r]);
    }
  return byMonth;
}

/**
 * 行を移した records/ のファイルを、残りの行で書き直す。残りが無ければ消す。見出しと改行は元のファイルに合わせる
 * （parseCsv の行は見出しの列を見出しの順に持つ）。
 * @param {{ f: string; kept: readonly RawRow[]; crlf: boolean }} p
 */
function rewriteSource(p) {
  if (p.kept.length === 0) {
    unlinkSync(p.f);
    return;
  }
  const text = toCsv(Object.keys(p.kept[0] ?? {}), p.kept);
  writeFileAtomic(p.f, p.crlf ? text.replace(/\n/g, "\r\n") : text);
}

/**
 * report に --archive を渡していないのに、境界がある（records/ に無い期間がある）ときの案内。境界が無ければ空文字列。
 * @param {number | null} boundary
 * @param {number} archives 渡した --archive の数
 * @returns {string}
 */
export function archivedNote(boundary, archives) {
  if (boundary === null || archives > 0) return "";
  return `records/${ARCHIVED_BEFORE_FILE} があり、${toIso(boundary)} より前に終わった行は records/ に無い。その期間も集計するには、移した先を手元に取得して --archive <dir> で渡す`;
}
