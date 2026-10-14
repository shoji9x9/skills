// 明細（.agent-usage/records/）の読み書き。
//   records/<person-id>/branches/<UTC の時刻>-<ブランチ>.csv   ローカルのログからの行（人別・ブランチ別）。
//   records/_github/<person-id>/<UTC の時刻>-<ブランチ>.csv    GitHub から取った行（リポジトリ全体の CI・レビュー・取得した期間）。
// 時刻は、そのブランチで初めて collect した時刻。collect は今のブランチのファイルだけを変える
// （そのブランチのファイルを書くのはそのブランチだけなので、並行するブランチの merge で競合しない）。
// 古い形（collect 1 回につき 1 ファイル）の records/<person-id>/<時刻>-<…>.csv・records/_github/<時刻>-<…>.csv もそのまま読む。

import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { writeFileAtomic } from "./atomic.mjs";
import { parseCsv, toCsv } from "./csv.mjs";
import { COLUMNS, contentSignature, isKind, signature } from "./rows.mjs";
import { parseTime } from "./time.mjs";

/** @typedef {import("./rows.mjs").Row} Row */

export const GITHUB_DIR = "_github";

/** 人別の行のうち、ブランチごとのファイルを置くディレクトリ（records/<person-id>/ の下）。 */
export const BRANCH_DIR = "branches";

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
 * ファイル名の先頭の UTC の時刻（`yyyyMMddTHHmmssZ`）を返す。無ければ null。
 * @param {string} path
 * @returns {number | null}
 */
export function fileStampTime(path) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(basename(path));
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  return Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, se ?? 0);
}

/** 最後の行を探すために、ファイルの末尾から読む量。これに収まらない行は、判定できないとしてファイル全体を読む。 */
const TAIL_BYTES = 16384;

/**
 * ファイルの最後の行の observed_at を、見出しと末尾だけを読んで返す。判定できなければ null（呼び出し側はファイル全体を読む）。
 * @param {string} path
 * @returns {number | null}
 */
export function lastObservedAt(path) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const head = Buffer.alloc(len);
    readSync(fd, head, 0, len, 0);
    const tail = Buffer.alloc(len);
    readSync(fd, tail, 0, len, size - len);
    const headText = head.toString("utf8");
    const nl = headText.indexOf("\n");
    const lines = tail.toString("utf8").replace(/\n$/, "").split("\n");
    // 末尾の 1 行がバッファに収まっていること（先頭の要素は途中から始まりうる）
    if (nl < 0 || lines.length < 2) return null;
    const rows = parseCsv(`${headText.slice(0, nl + 1)}${lines[lines.length - 1]}\n`);
    return rows.length === 1 ? parseTime(rows[0]?.observed_at) : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * @typedef {object} ReadOptions
 * @property {number} [since] ファイル名の時刻と最後の行の observed_at がどちらもこれより前のファイルは読まない（時刻の無いファイルは読む）。
 *   ブランチのファイルの名前の時刻は初めて書いた時刻で、後から足した行の時刻は最後の行にしか表れないので、両方を見る
 * @property {ReadonlySet<string>} [keep] since に関わらず読むファイル（今のブランチのファイル）
 */

/**
 * records/ の行を読む。種類・key・observed_at の無い行はエラーにする（手で直して不正になった行を、警告なしに捨てない）。
 * @param {string} recordsDir
 * @param {ReadOptions} [opts]
 * @returns {{ rows: Row[]; files: number; skipped: number }}
 */
export function readRecords(recordsDir, opts = {}) {
  /** @type {Row[]} */
  const rows = [];
  const all = csvFiles(recordsDir);
  const since = opts.since;
  const files =
    since === undefined
      ? all
      : all.filter((f) => {
          if (opts.keep?.has(f)) return true;
          const t = fileStampTime(f);
          if (t === null || t >= since) return true;
          // 古い形（records/<person-id>/<時刻>-….csv・records/_github/<時刻>-….csv）は collect 1 回につき 1 ファイルで、
          // 後から書き足さないので、名前の時刻だけで決まる
          if (relative(recordsDir, f).split(sep).length < 3) return false;
          // collect は行を後ろに足すので、最後の行の observed_at が最も新しい。これも範囲より前なら、中の行はすべて範囲より前に書いた行である。
          // ファイルの更新時刻は使わない（clone や worktree の作成で、すべてのファイルが今の時刻になる）
          const last = lastObservedAt(f);
          return last === null || last >= since;
        });
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
  return { rows, files: files.length, skipped: all.length - files.length };
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

/** ブランチのファイルの名前に使う形の長さの上限。 */
const MAX_LABEL = 100;

/**
 * ブランチのファイルの名前に使う形。英数字・`.`・`_`・`-`・`/` だけのブランチの名前は safeName した形にする。
 * それ以外の文字（日本語など）を含む名前は、safeName で別のブランチと同じ形になりうる（`feature/日本語` と `feature/中文` がどちらも `feature`）。
 * 同じファイルを 2 つのブランチが書くと merge で競合するので、元の名前のハッシュの先頭 8 文字を足して分ける。
 * @param {string} branch
 * @returns {string}
 */
export function branchLabel(branch) {
  const name = safeName(branch);
  const hash = () => createHash("sha256").update(branch).digest("hex").slice(0, 8);
  // ファイル名の上限（多くのファイルシステムで 255 バイト）に、時刻と拡張子を足しても収まるようにする
  if (name.length > MAX_LABEL) return `${name.slice(0, MAX_LABEL - 9)}-${hash()}`;
  if (/^[A-Za-z0-9._/-]+$/.test(branch)) return name;
  return `${name}-${hash()}`;
}

/**
 * ブランチのファイル（`<時刻>-<label>.csv`）を、時刻の古い順にすべて返す。
 * @param {string} dir
 * @param {string} label branchLabel したブランチの名前
 * @returns {string[]}
 */
export function branchFiles(dir, label) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^\d{8}T\d{6}Z-/.test(n) && n.slice(17) === `${label}.csv`)
    .sort()
    .map((n) => join(dir, n));
}

/**
 * ブランチのファイル（path）に行を足す。ファイルが無ければ作る。
 * 見出しが今の列と同じなら、既存の内容をそのまま残して後ろに足すので、git の差分は足した行だけになる（改行は既存のファイルに合わせる）。
 * 見出しが違う（列の違う版が書いた）ときだけ、今の列と既存の列を合わせた見出しで全体を書き直す（知らない列の値を落とさない）。
 * @param {string} path
 * @param {readonly Row[]} rows
 * @returns {string}
 */
export function appendBranchFile(path, rows) {
  const text = toCsv(COLUMNS, rows);
  if (!existsSync(path)) {
    // records/ の中に一時ファイルを作らない（中断して残ると、Hook の git add が stage してしまう）
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { flag: "wx" });
    return path;
  }
  const prev = readFileSync(path, "utf8");
  const crlf = prev.includes("\r\n");
  const lf = crlf ? prev.replace(/\r\n/g, "\n") : prev;
  const header = text.slice(0, text.indexOf("\n") + 1);
  if (lf.startsWith(header)) {
    const body = text.slice(header.length);
    const glue = lf.endsWith("\n") ? "" : "\n";
    appendFileSync(path, crlf ? `${glue}${body}`.replace(/\n/g, "\r\n") : `${glue}${body}`);
    return path;
  }
  const prevRows = parseCsv(lf);
  /** @type {Set<string>} */
  const known = new Set(COLUMNS);
  const extra = [...new Set(prevRows.flatMap((r) => Object.keys(r)))].filter((c) => !known.has(c));
  writeFileAtomic(path, toCsv([...COLUMNS, ...extra], [...prevRows, ...rows]));
  return path;
}
