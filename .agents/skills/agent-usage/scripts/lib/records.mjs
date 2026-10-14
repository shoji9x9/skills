// 明細（.agent-usage/records/）の読み書き。
//   records/<person-id>/<UTC の時刻>-<Issue 番号かブランチ>.csv   ローカルのログからの行（人別）。
//   records/_github/<UTC の時刻>-<person-id>.csv                  GitHub から取った行（リポジトリ全体の CI・レビュー・取得した期間）。
// collect は毎回新しいファイルを作り、既存のファイルは変えない（並行するブランチの merge で競合しない）。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseCsv, toCsv } from "./csv.mjs";
import { COLUMNS, contentSignature, isKind, signature } from "./rows.mjs";
import { parseTime } from "./time.mjs";

/** @typedef {import("./rows.mjs").Row} Row */

export const GITHUB_DIR = "_github";

/** GitHub から取る行の種類。人別のファイルではなく _github/ に書く。 */
export const GITHUB_KINDS = ["ci", "review-wait", "review", "coverage"];

/**
 * @param {string} root
 * @returns {string}
 */
export function usageDir(root) {
  return join(root, ".agent-usage");
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function csvFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...csvFiles(p));
    else if (ent.isFile() && ent.name.endsWith(".csv")) out.push(p);
  }
  return out.sort();
}

/**
 * records/ のすべての行を読む。種類・key・observed_at の無い行はエラーにする（手で直して不正になった行を、警告なしに捨てない）。
 * @param {string} recordsDir
 * @returns {{ rows: Row[]; files: number }}
 */
export function readRecords(recordsDir) {
  /** @type {Row[]} */
  const rows = [];
  const files = csvFiles(recordsDir);
  for (const f of files) {
    const where = relative(recordsDir, f);
    let n = 1;
    for (const r of parseCsv(readFileSync(f, "utf8"))) {
      n += 1;
      if (!r.key) throw new Error(`${where}:${n}: key が空`);
      if (!r.kind || !isKind(r.kind))
        throw new Error(`${where}:${n}: 知らない kind ${JSON.stringify(r.kind)}`);
      if (parseTime(r.observed_at) === null)
        throw new Error(`${where}:${n}: observed_at が時刻でない`);
      /** @type {Row} */
      const row = {};
      for (const c of COLUMNS) if (r[c] !== undefined) row[c] = r[c];
      rows.push(row);
    }
  }
  return { rows, files: files.length };
}

/**
 * key ごとに、observed_at の最も新しい行を残す。同じ時刻なら内容の署名の大きい方（どの順で読んでも同じ結果にする）。
 * @param {readonly Row[]} rows
 * @returns {Map<string, Row>}
 */
export function latestByKey(rows) {
  /** @type {Map<string, Row>} */
  const out = new Map();
  for (const r of rows) {
    const key = r.key ?? "";
    const prev = out.get(key);
    if (!prev) {
      out.set(key, r);
      continue;
    }
    const a = parseTime(prev.observed_at) ?? 0;
    const b = parseTime(r.observed_at) ?? 0;
    if (b > a || (b === a && signature(r) > signature(prev))) out.set(key, r);
  }
  return out;
}

/**
 * 既に記録した内容と違う行（新しい key か、内容が変わった行）だけを残す。
 * @param {readonly Row[]} candidates
 * @param {Map<string, Row>} existing
 * @returns {Row[]}
 */
export function changedRows(candidates, existing) {
  return candidates.filter((r) => {
    const prev = existing.get(r.key ?? "");
    return !prev || contentSignature(prev) !== contentSignature(r);
  });
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function fileStamp(ms) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * ファイル名に使える形にする（ブランチの名前の / など）。
 * @param {string} s
 * @returns {string}
 */
export function safeName(s) {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "none";
}

/**
 * 行を新しいファイルに書く。同じ名前があれば番号を付ける。書いたファイルのパスを返す。
 * @param {string} dir
 * @param {string} base 拡張子を除いたファイル名
 * @param {readonly Row[]} rows
 * @returns {string}
 */
export function writeNewFile(dir, base, rows) {
  mkdirSync(dir, { recursive: true });
  let path = join(dir, `${base}.csv`);
  for (let i = 2; existsSync(path); i += 1) path = join(dir, `${base}-${i}.csv`);
  writeFileSync(path, toCsv(COLUMNS, rows), { flag: "wx" });
  return path;
}
