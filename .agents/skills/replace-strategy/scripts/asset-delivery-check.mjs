// 静的資産の台帳で「実体を写す」と決めた資産を、新側が実際に配っているかを突き合わせる（正本）。Issue #458。
//
// 何のためか: `.replace/assets.md` は資産の種類ごとに「実体を写す／同等物を作る／写さない」を決めるが、
// 決めた方針どおりに新側が配っているかは、スイートの green・画素・特性照合・aria のどれにも写らないことがある
// （favicon はタブにしか出ない。title・印刷用の資産も同じ）。parity-replace の完了判定でここを通す。
//
// 期待集合の出所: 台帳（宣言）の「状態 `有効` × 方針 `実体を写す`」の行。突き合わせの記録（asset-delivery.json）は
// その全行に 1 件ずつ答える——記録に無い行は「確かめていない」として落とす（記録の側から期待集合を作らない）。
//
// 行ごとに確かめること（files を書いた行）:
//   1. 新側の配信物が参照している: 新側の画面で asset-probe.mjs を当てた出力（--probe）の
//      images[].src / urlRefs[].url / fontFaces[].src[] / icons[].href / resources[].url のどれかに、
//      記録の new を --new-base で解決した URL が完全一致（href）で現れる。
//      採用しないフィールド: unclassifiedResources（資産以外の取得も混ざる）・manifests（manifest 自体の URL で、
//      中の icons は読んでいない）・localFragmentRefs（文書内の参照）。
//   2. 取得したバイトが移行元の配信物と一致する: current を --current-base、new を --new-base で解決して取得し、
//      どちらも 2xx で sha256 が一致する（SPA のフォールバックが 200 で index.html を返す形もここで落ちる）。
// 突き合わせない行: disposition: accepted（この機能の画面が使わない・機械的に確かめられない。reason と利用者の承認
//   approved_by / approved_at 必須）だけ。「この画面では使わない」を検査者が自分で宣言する used: false は置かない——
//   台帳の「描き方と使われるページ」は自由記述で、そこから外してよい行を読み取る規則は表記ゆれのたびに外せる側へ漏れた
//   （全頁・共通ヘッダー・`/*`・日本語の続くパス・サブパス配下。PR #535 のレビュー）。外すのは常に利用者の判断にする。
//
// fail-closed: 台帳の表が無い・複数ある・状態や方針が語彙外・同じ種類に `有効` が 2 行・記録の形が崩れている・
//   表に属さない行がある・確かめる資産があるのにプローブが無い、はどれも exit 2（判定していない）。取得の失敗・参照が無い・バイト不一致・
//   記録に無い行・台帳に無い記録は exit 1。
//
// ネットワークに依存する（取得して比べることが検査の中身）。それ以外は決定論的。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。 */
export const VERSION = "1";

/** replace-metadata.json に書くキー。 */
export const WRITE_KEY = "asset_delivery_check";

/** 使い方の誤り・入力の不備（exit 2）。 */
export class UsageError extends Error {}

/** 台帳の状態の語彙。 */
const STATUS_ACTIVE = "有効";
const STATUS_CANCELLED_PREFIX = "取り消し済み";
/** 台帳の方針の語彙（空欄は未決）。 */
export const POLICY_COPY = "実体を写す";
const POLICIES = new Set([POLICY_COPY, "同等物を作る", "写さない", ""]);

/**
 * 空白を 1 つに畳み、前後を除き、セル全体を囲む強調（`**` / `__`）を外す。台帳の人が書いた表記ゆれを揃える。
 * 記録側の kind にも同じ正規化を当てる（片側だけ正規化すると、表記の違う同じ種類が突き合わない）。
 * @param {string} value
 * @returns {string}
 */
export function normalizeCell(value) {
  let s = String(value).replace(/\s+/gu, " ").trim();
  for (;;) {
    const m = /^(\*\*|__)(.*)\1$/u.exec(s);
    if (m === null) break;
    s = m[2].trim();
  }
  return s;
}

/**
 * `| a | b |` を配列にする（表の行でなければ null）。`\|` は列の区切りにしない。
 * @param {string | undefined} line
 * @returns {string[] | null}
 */
function splitRow(line) {
  if (line === undefined) return null;
  let trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  /** @type {string[]} */
  const cells = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

/**
 * コードフェンスの開始／終了記号を返す（フェンス行でなければ null）。
 * @param {string} line
 * @returns {string | null}
 */
function fenceOf(line) {
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  return match === null ? null : match[1];
}

/**
 * Markdown の表を全て取り出す。HTML コメントとコードフェンスの中は台帳ではないので読まない
 * （テンプレートの説明コメント・例示の表を本物の行として読まない）。
 * @param {string} text
 * 各行のファイル上の行番号（1 始まり）を rowLines に持つ（エラー文で台帳の行を指せるように）。
 * @returns {{ tables: { headers: string[], rows: string[][], rowLines: number[] }[], strayRows: { line: number, cells: number, leadingPipe: boolean }[] }}
 */
export function parseTables(text) {
  // コメントは改行を保ったまま空白に置き換える（行の対応を崩さない）。閉じていないコメントは末尾まで。
  const uncommented = text.replace(/<!--[\s\S]*?(?:-->|$)/gu, (m) => m.replace(/[^\n]/gu, " "));
  const lines = uncommented.split(/\r?\n/u);
  /** @type {{ headers: string[], rows: string[][], rowLines: number[] }[]} */
  const tables = [];
  /**
   * 表に属さないのに `|` を含む行（空行で本体が切れた後の行など）。黙って捨てず、行番号・セル数・行頭の `|` の有無を
   * 呼び出し側へ返す（GFM は行頭・行末の `|` を省けるので、行頭の `|` だけでは表の行を見分けられない）。
   */
  /** @type {{ line: number, cells: number, leadingPipe: boolean }[]} */
  const strayRows = [];
  /** @type {string | null} */
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
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
      if (fenceOf(lines[j]) !== null) break;
      const row = splitRow(lines[j]);
      if (row === null) break;
      rows.push(row);
      rowLines.push(j + 1);
    }
    tables.push({ headers: header.map(normalizeCell), rows, rowLines });
    i = j - 1;
  }
  return { tables, strayRows };
}

/**
 * @typedef {{ kind: string, line: number }} LedgerRow
 */

/**
 * 台帳から「状態 `有効` × 方針 `実体を写す`」の行を取り出す。
 * @param {string} text
 * @returns {{ copyRows: LedgerRow[], activeRows: number }}
 */
export function readLedger(text) {
  const { tables, strayRows } = parseTables(text);
  const candidates = tables.filter(
    (t) => t.headers.includes("種類") && t.headers.includes("方針") && t.headers.includes("状態"),
  );
  if (candidates.length === 0) {
    throw new UsageError(
      "台帳に「種類」「方針」「状態」の列を持つ表が無い（assets-template.md の形で書く）",
    );
  }
  if (candidates.length > 1) {
    throw new UsageError(
      `台帳に「種類」「方針」「状態」の列を持つ表が ${candidates.length} 個ある（どれが方針の表か決められない）`,
    );
  }
  const { headers, rows, rowLines } = candidates[0];
  // 表に属さない行（本体の途中の空行で切れた追記など）に「実体を写す」の行があると、期待集合から黙って消える。
  // 行頭の `|` があるか、方針の表と同じセル数なら表の行を意図したものとみなし、どの表の行か決められないので判定しない（fail-closed）。
  // 散文中の `|`（セル数が合わず行頭にも無い）は対象にしない。
  const stray = strayRows.filter((r) => r.leadingPipe || r.cells === headers.length);
  if (stray.length > 0) {
    throw new UsageError(
      `台帳の ${stray.map((r) => r.line).join(", ")} 行目は表に属さない（直前の空行で表が切れている等）。表の本体に空行を挟まない`,
    );
  }
  for (const name of ["種類", "方針", "状態"]) {
    if (headers.filter((h) => h === name).length > 1) {
      throw new UsageError(`台帳の表に「${name}」列が 2 つある`);
    }
  }
  const kindAt = headers.indexOf("種類");
  const policyAt = headers.indexOf("方針");
  const statusAt = headers.indexOf("状態");
  /** @type {Map<string, number>} */
  const activeByKind = new Map();
  /** @type {LedgerRow[]} */
  const copyRows = [];
  rows.forEach((row, index) => {
    // 台帳ファイル上の行番号（表の中の何行目かではない）。エラー文・findings で利用者が開く行を指す。
    const line = rowLines[index];
    if (row.length !== headers.length) {
      throw new UsageError(
        `台帳の ${line} 行目の列数が見出しと違う（${row.length} ≠ ${headers.length}。セル内の | は \\| と書く）`,
      );
    }
    const kind = normalizeCell(row[kindAt]);
    const status = normalizeCell(row[statusAt]);
    if (kind === "") throw new UsageError(`台帳の ${line} 行目の「種類」が空`);
    if (status.startsWith(STATUS_CANCELLED_PREFIX)) return;
    if (status !== STATUS_ACTIVE) {
      throw new UsageError(
        `台帳の ${line} 行目（${kind}）の状態が語彙外: "${status}"（${STATUS_ACTIVE} ｜ ${STATUS_CANCELLED_PREFIX}（…））`,
      );
    }
    const policy = normalizeCell(row[policyAt]);
    if (!POLICIES.has(policy)) {
      throw new UsageError(
        `台帳の ${line} 行目（${kind}）の方針が語彙外: "${policy}"（実体を写す ｜ 同等物を作る ｜ 写さない ｜ 空欄）`,
      );
    }
    const previous = activeByKind.get(kind);
    if (previous !== undefined) {
      throw new UsageError(
        `台帳で「${kind}」の状態が ${STATUS_ACTIVE} の行が 2 つある（${previous} 行目と ${line} 行目。同じ種類で有効な行は 1 つだけ）`,
      );
    }
    activeByKind.set(kind, line);
    if (policy !== POLICY_COPY) return;
    copyRows.push({ kind, line });
  });
  return { copyRows, activeRows: activeByKind.size };
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * 記録の URL（絶対 URL か `/` 始まりのパス）を基準で解決する。
 * @param {string} value
 * @param {string} base
 * @param {string} label
 * @returns {string}
 */
export function resolveAssetUrl(value, base, label) {
  if (/^https?:\/\//iu.test(value)) return new URL(value).href;
  if (value.startsWith("/") && !value.startsWith("//")) return new URL(value, base).href;
  throw new UsageError(
    `${label} は http(s) の絶対 URL か / 始まりのパスで書く（相対パスは基準が決まらない）: "${value}"`,
  );
}

/**
 * @typedef {{ kind: string, accepted: boolean, reason: string | null, files: { current: string, new: string }[] }} RecordEntry
 */

/**
 * 突き合わせの記録（asset-delivery.json）を読む。形の崩れは exit 2。
 * @param {unknown} doc
 * @returns {RecordEntry[]}
 */
export function readRecord(doc) {
  if (!isPlainObject(doc)) throw new UsageError("記録が JSON オブジェクトでない");
  if (!Array.isArray(doc.entries)) throw new UsageError("記録の entries が配列でない");
  /** @type {Set<string>} */
  const seen = new Set();
  return doc.entries.map((raw, i) => {
    const at = `entries[${i}]`;
    if (!isPlainObject(raw)) throw new UsageError(`${at} がオブジェクトでない`);
    if (!nonEmptyString(raw.kind)) throw new UsageError(`${at}.kind が空（台帳の「種類」を写す）`);
    const kind = normalizeCell(raw.kind);
    if (seen.has(kind)) throw new UsageError(`記録に「${kind}」が 2 件ある`);
    seen.add(kind);
    // 「この画面では使わない」を検査者が自分で宣言して外す形（used: false）は持たない。黙って読み飛ばすと
    // used: false と書いた記録が files の無い行として別の理由で落ち、外し方が伝わらないので、名指しで落とす
    if (raw.used !== undefined) {
      throw new UsageError(
        `${at}.used は書かない（${kind}。突き合わせるなら files を書き、この画面で使わないなら disposition: accepted と利用者の承認を書く）`,
      );
    }
    const accepted = raw.disposition !== undefined;
    if (accepted && raw.disposition !== "accepted") {
      throw new UsageError(
        `${at}.disposition は accepted だけ（${kind}: "${String(raw.disposition)}"）`,
      );
    }
    if (accepted) {
      if (!nonEmptyString(raw.reason)) {
        throw new UsageError(`${at}.reason が空（${kind}。突き合わせない理由を書く）`);
      }
      for (const key of ["approved_by", "approved_at"]) {
        if (!nonEmptyString(raw[key])) {
          throw new UsageError(
            `${at}.${key} が空（${kind}。突き合わせないことには利用者の承認が要る）`,
          );
        }
      }
    }
    /** @type {{ current: string, new: string }[]} */
    const files = [];
    if (!accepted) {
      if (!Array.isArray(raw.files) || raw.files.length === 0) {
        throw new UsageError(`${at}.files が空（${kind}。移行元と新側の URL の組を 1 件以上書く）`);
      }
      raw.files.forEach((f, j) => {
        if (!isPlainObject(f) || !nonEmptyString(f.current) || !nonEmptyString(f.new)) {
          throw new UsageError(`${at}.files[${j}] に current と new が無い（${kind}）`);
        }
        files.push({ current: f.current.trim(), new: f.new.trim() });
      });
    } else if (raw.files !== undefined) {
      throw new UsageError(
        `${at}.files は accepted の行に書かない（${kind}。書いたのに確かめない、を作らない）`,
      );
    }
    return {
      kind,
      accepted,
      reason: nonEmptyString(raw.reason) ? raw.reason.trim() : null,
      files,
    };
  });
}

/**
 * asset-probe.mjs の出力から「参照している」と数える URL を集める。
 * @param {unknown} probe
 * @param {string} label
 * @returns {Set<string>}
 */
export function referencedUrls(probe, label) {
  if (!isPlainObject(probe)) throw new UsageError(`${label} が JSON オブジェクトでない`);
  for (const key of ["images", "urlRefs", "fontFaces", "icons", "resources", "urlPropsScanned"]) {
    if (!Array.isArray(probe[key])) {
      throw new UsageError(`${label} が asset-probe.mjs の出力でない（${key} が配列でない）`);
    }
  }
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {unknown} u */
  const add = (u) => {
    if (!nonEmptyString(u)) return;
    try {
      out.add(new URL(u).href);
    } catch {
      // 絶対 URL でない値（プローブは解決済みの URL を返すので通常は来ない）は参照に数えない
    }
  };
  for (const row of /** @type {unknown[]} */ (probe.images)) if (isPlainObject(row)) add(row.src);
  for (const row of /** @type {unknown[]} */ (probe.urlRefs)) if (isPlainObject(row)) add(row.url);
  for (const row of /** @type {unknown[]} */ (probe.fontFaces)) {
    if (isPlainObject(row) && Array.isArray(row.src)) for (const u of row.src) add(u);
  }
  for (const row of /** @type {unknown[]} */ (probe.icons)) if (isPlainObject(row)) add(row.href);
  for (const row of /** @type {unknown[]} */ (probe.resources))
    if (isPlainObject(row)) add(row.url);
  return out;
}

/**
 * @typedef {(url: string) => Promise<{ ok: boolean, status: number, bytes: Buffer | null, error: string | null, redirected?: boolean, finalUrl?: string, contentType?: string | null }>} Fetcher
 */

/**
 * 既定の取得（リダイレクトは追う。1 件ごとに timeout を切る）。
 * @param {number} timeoutMs
 * @returns {Fetcher}
 */
export function defaultFetcher(timeoutMs) {
  return async (url) => {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      const bytes = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        bytes,
        error: null,
        redirected: res.redirected,
        finalUrl: res.url,
        contentType: res.headers.get("content-type"),
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        bytes: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 突き合わせる。
 * @param {{ ledgerText: string, record: unknown, probes: { label: string, doc: unknown }[], currentBase: string, newBase: string, fetcher: Fetcher }} input
 * @returns {Promise<{ findings: string[], notes: string[], files: object[], counts: { rows: number, checkedRows: number, files: number } }>}
 */
export async function check(input) {
  const { copyRows } = readLedger(input.ledgerText);
  const entries = readRecord(input.record);
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {object[]} */
  const files = [];

  const byKind = new Map(entries.map((e) => [e.kind, e]));
  const copyKinds = new Set(copyRows.map((r) => r.kind));
  for (const entry of entries) {
    if (!copyKinds.has(entry.kind)) {
      findings.push(
        `記録の「${entry.kind}」は台帳の「状態 有効 × 方針 実体を写す」の行に無い（台帳の種類の綴りと揃えるか、方針が変わったなら記録から外す）`,
      );
    }
  }

  /** @type {Set<string>} */
  const referenced = new Set();
  for (const probe of input.probes) {
    for (const u of referencedUrls(probe.doc, probe.label)) referenced.add(u);
  }
  // 承認済み（accepted）以外の行が 1 つでもあれば、参照を確かめるプローブが要る
  const needsProbe = copyRows.some((row) => {
    const entry = byKind.get(row.kind);
    return entry !== undefined && !entry.accepted;
  });
  if (needsProbe && input.probes.length === 0) {
    throw new UsageError(
      "突き合わせる資産があるのに --probe が無い（新側の画面で asset-probe.mjs を当てた出力を渡す）",
    );
  }

  /** @type {{ row: LedgerRow, entry: RecordEntry }[]} */
  const toCheck = [];
  for (const row of copyRows) {
    const entry = byKind.get(row.kind);
    if (entry === undefined) {
      findings.push(
        `台帳の「${row.kind}」（実体を写す）を突き合わせていない（asset-delivery.json に行が無い。この画面で使わないなら disposition: accepted と利用者の承認を書く）`,
      );
      continue;
    }
    if (entry.accepted) {
      notes.push(`「${row.kind}」は突き合わせない（利用者の承認済み）: ${entry.reason}`);
      continue;
    }
    toCheck.push({ row, entry });
  }

  let fileCount = 0;
  for (const { row, entry } of toCheck) {
    for (const file of entry.files) {
      fileCount += 1;
      const currentUrl = resolveAssetUrl(
        file.current,
        input.currentBase,
        `「${row.kind}」の current`,
      );
      const newUrl = resolveAssetUrl(file.new, input.newBase, `「${row.kind}」の new`);
      // 新側が移行元の配信物へ直リンクしていると、取得先が同じなので sha256 は必ず一致するが、移行元を止めた時点で消える。
      // バイトの一致を「新側が移行元と同じものを配っている」の証拠にできない組の指摘の件数。
      // bytes_match はこの種の指摘が無いときだけ真にする（参照していない等の別の軸の指摘は bytes_match に混ぜない）
      const byteFindingsBefore = findings.length;
      // 同じ URL に解決される組は、同じ配信物を 2 回取得して比べるだけで必ず一致する（同じオリジンの構成で
      // current と new に同じパスを書いた等）。新側が配っていることの証拠にならないので落とす
      if (currentUrl === newUrl) {
        findings.push(
          `「${row.kind}」の current と new が同じ URL（${newUrl}）に解決される（同じ配信物を比べているだけ。新側が配る URL を書く）`,
        );
      }
      // 直リンクは両向きで落とす（どちらも同じ配信物を 2 回比べるだけで必ず一致する）。
      // 新側と移行元が別オリジンの構成のときだけ判定する（同じオリジンの構成ではオリジンで見分けられない）。
      //   - new が移行元側のオリジン（--current-base か、current を解決した URL のオリジン。移行元が CDN から配る資産を含む）を指す
      //   - current が新側のオリジン（--new-base）を指す（移行元を一度も取得していない）
      const newBaseOrigin = new URL(input.newBase).origin;
      const currentBaseOrigin = new URL(input.currentBase).origin;
      if (currentBaseOrigin !== newBaseOrigin) {
        const newOrigin = new URL(newUrl).origin;
        const currentOrigins = new Set([currentBaseOrigin, new URL(currentUrl).origin]);
        currentOrigins.delete(newBaseOrigin);
        if (currentOrigins.has(newOrigin)) {
          findings.push(
            `「${row.kind}」の ${file.new} は移行元のオリジン（${newOrigin}）を指している（新側が移行元へ直リンクしている。新側が自分で配る URL を書く）`,
          );
        }
        if (new URL(currentUrl).origin === newBaseOrigin) {
          findings.push(
            `「${row.kind}」の ${file.current} は新側のオリジン（${newBaseOrigin}）を指している（移行元の配信物を取得していない。移行元が配る URL を書く）`,
          );
        }
      }
      const byteFindingsEnd = findings.length;
      const isReferenced = referenced.has(newUrl);
      if (!isReferenced) {
        findings.push(
          `「${row.kind}」の ${file.new} を新側の画面が参照していない（渡したプローブの images / urlRefs / fontFaces / icons / resources のどれにも ${newUrl} が無い）`,
        );
      }
      const [cur, neu] = await Promise.all([input.fetcher(currentUrl), input.fetcher(newUrl)]);
      /** @type {Record<string, unknown>} */
      const result = {
        kind: row.kind,
        current: file.current,
        new: file.new,
        referenced: isReferenced,
        current_status: cur.status,
        new_status: neu.status,
        current_sha256: cur.ok && cur.bytes !== null ? sha256(cur.bytes) : null,
        new_sha256: neu.ok && neu.bytes !== null ? sha256(neu.bytes) : null,
      };
      const fetchFindingsBefore = findings.length;
      for (const [side, res, url] of /** @type {const} */ ([
        ["移行元", cur, currentUrl],
        ["新側", neu, newUrl],
      ])) {
        if (!res.ok || res.bytes === null) {
          findings.push(
            `「${row.kind}」の${side}の配信物を取得できない（${url}: ${res.error ?? `HTTP ${res.status}`}）`,
          );
        } else if (res.bytes.length === 0) {
          // 両側とも 0 バイトなら sha256 は一致するが、資産を配っていることの証拠にならない
          findings.push(`「${row.kind}」の${side}の配信物が空（0 バイト。${url}）`);
        } else if (typeof res.contentType === "string" && /^text\/html\b/iu.test(res.contentType)) {
          // 静的資産（画像・書体・アイコン）が HTML で返るのは、SPA のフォールバックかログイン画面
          findings.push(
            `「${row.kind}」の${side}の配信物が HTML で返った（${url}: ${res.contentType}。SPA のフォールバックかログイン画面の可能性）`,
          );
        }
      }
      // 転送そのものは正規の配り方（ハッシュ付きのパスへの 301・署名付き URL への 302 等）なので落とさない。
      // 参照はプローブが記録する転送前の URL（記録の new）で判定し、バイトと HTML かどうかは最終応答で見る
      // （ログイン画面への転送は最終応答が HTML になるので上で落ちる）。
      // ただし両側が同じ転送先に着いたら、同じ配信物を比べているだけなので落とす。
      // 転送先は署名付き URL のクエリを含みうるので、記録と出力にはオリジンとパスだけを出す。
      // 直リンクの判定は転送の後にも当てる（新側が移行元へ 302 で飛ばす形は、転送前の new だけを見ると通る）。
      // 別オリジンの構成のときだけ判定する点と、移行元側のオリジンの集合は転送前の判定と同じ
      if (currentBaseOrigin !== newBaseOrigin) {
        const currentOrigins = new Set([currentBaseOrigin, new URL(currentUrl).origin]);
        currentOrigins.delete(newBaseOrigin);
        const finalOrigin = (/** @type {string | undefined} */ u) =>
          typeof u === "string" && u !== "" ? new URL(u).origin : null;
        const newFinal = neu.redirected === true ? finalOrigin(neu.finalUrl) : null;
        const currentFinal = cur.redirected === true ? finalOrigin(cur.finalUrl) : null;
        if (newFinal !== null && currentOrigins.has(newFinal)) {
          findings.push(
            `「${row.kind}」の ${file.new} は移行元のオリジン（${newFinal}）へ転送される（新側が移行元へ転送で直リンクしている。新側が自分で配る）`,
          );
        }
        if (currentFinal !== null && currentFinal === newBaseOrigin) {
          findings.push(
            `「${row.kind}」の ${file.current} は新側のオリジン（${newBaseOrigin}）へ転送される（移行元の配信物を取得していない）`,
          );
        }
      }
      result.current_redirected = cur.redirected === true;
      result.new_redirected = neu.redirected === true;
      if (
        (cur.redirected === true || neu.redirected === true) &&
        typeof cur.finalUrl === "string" &&
        cur.finalUrl !== "" &&
        cur.finalUrl === neu.finalUrl
      ) {
        const at = new URL(cur.finalUrl);
        findings.push(
          `「${row.kind}」の移行元と新側が同じ転送先（${at.origin}${at.pathname}）に着いた（同じ配信物を比べているだけ。新側が自分で配る URL を書く）`,
        );
      }
      const match = result.current_sha256 !== null && result.current_sha256 === result.new_sha256;
      // 転送・HTML・空・同じ URL・直リンクの指摘が出た組は、sha256 が一致していても「一致」と記録しない
      // （参照していないの指摘は別の軸なので数えない。referenced に記録済み）
      result.bytes_match =
        match && byteFindingsEnd === byteFindingsBefore && findings.length === fetchFindingsBefore;
      if (result.current_sha256 !== null && result.new_sha256 !== null && !match) {
        findings.push(
          `「${row.kind}」の新側の配信物が移行元とバイト一致しない（${file.current} → ${String(result.current_sha256).slice(0, 12)}… / ${file.new} → ${String(result.new_sha256).slice(0, 12)}…）`,
        );
      }
      files.push(result);
    }
  }
  return {
    findings,
    notes,
    files,
    counts: { rows: copyRows.length, checkedRows: toCheck.length, files: fileCount },
  };
}

/**
 * @param {string[]} argv
 * @returns {{ assets: string, record: string, probes: string[], currentBase: string, newBase: string, write: string | null, timeoutMs: number }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string[]} */
  const probes = [];
  const single = new Set([
    "--assets",
    "--record",
    "--current-base",
    "--new-base",
    "--write",
    "--timeout-ms",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--probe" || single.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      i += 1;
      if (arg === "--probe") {
        probes.push(resolve(value));
        continue;
      }
      if (opts[arg] !== undefined) throw new UsageError(`${arg} が 2 回指定されている`);
      opts[arg] = value;
      continue;
    }
    throw new UsageError(`不明な引数: ${arg}`);
  }
  for (const key of ["--assets", "--record", "--current-base", "--new-base"]) {
    if (!opts[key]) throw new UsageError(`${key} は必須（推測させない）`);
  }
  for (const key of ["--current-base", "--new-base"]) {
    if (!/^https?:\/\//iu.test(opts[key])) {
      throw new UsageError(`${key} は http(s) の絶対 URL: "${opts[key]}"`);
    }
  }
  let timeoutMs = 15000;
  if (opts["--timeout-ms"] !== undefined) {
    timeoutMs = Number(opts["--timeout-ms"]);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new UsageError(`--timeout-ms は正の整数: "${opts["--timeout-ms"]}"`);
    }
  }
  return {
    assets: resolve(opts["--assets"]),
    record: resolve(opts["--record"]),
    probes,
    currentBase: opts["--current-base"],
    newBase: opts["--new-base"],
    write: opts["--write"] === undefined ? null : resolve(opts["--write"]),
    timeoutMs,
  };
}

/** 使い方（stderr に出す）。 */
const usage = [
  "usage: asset-delivery-check.mjs --assets <.replace/assets.md> --record <new/<target>/asset-delivery.json>",
  "         --current-base <現行の UI baseURL> --new-base <新側の UI baseURL> [--probe <asset-probe の出力 JSON>]...",
  "         [--write <new/<target>/replace-metadata.json>] [--timeout-ms <取得 1 件の上限。既定 15000>]",
  "exit: 0 = 台帳の「有効 × 実体を写す」の行が全て突き合った（該当 0 行を含む） / 1 = 突き合わない行がある",
  "      2 = 使い方の誤り・入力の不備（判定していない）",
].join("\n");

/**
 * --write の先を引数の解析より先に拾う（後続の引数の不備で exit 2 になっても前回の合格を残さないため）。
 * @param {string[]} argv
 * @returns {string | null}
 */
function preScanWrite(argv) {
  const i = argv.indexOf("--write");
  if (i < 0) return null;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? null : resolve(v);
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} result
 * @param {(p: string, s: string) => void} writeFile
 */
function writeResult(path, result, writeFile) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  if (!isPlainObject(doc)) throw new UsageError(`--write の先が JSON オブジェクトでない: ${path}`);
  doc[WRITE_KEY] = result;
  writeFile(path, `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * @param {string[]} argv
 * @param {{ fetcher?: Fetcher, writeFile?: (p: string, s: string) => void }} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const writeTarget = preScanWrite(argv);
  /** @type {{ ledger: string | null, record: string | null, probes: { path: string, sha256: string }[] }} */
  const fingerprints = { ledger: null, record: null, probes: [] };
  try {
    const args = parseArgs(argv);
    const ledgerText = readFileSync(args.assets, "utf8");
    fingerprints.ledger = createHash("sha256").update(ledgerText).digest("hex");
    const recordText = readFileSync(args.record, "utf8");
    fingerprints.record = createHash("sha256").update(recordText).digest("hex");
    const record = parseJson(recordText, args.record);
    // プローブも判定を左右する入力なので指紋を残す（プローブを取り直した後の古い合格を見分けるため）
    const probes = args.probes.map((p) => {
      const text = readFileSync(p, "utf8");
      fingerprints.probes.push({
        path: relative(process.cwd(), p),
        sha256: createHash("sha256").update(text).digest("hex"),
      });
      return { label: p, doc: parseJson(text, p) };
    });
    const fetcher = deps.fetcher ?? defaultFetcher(args.timeoutMs);
    const { findings, notes, files, counts } = await check({
      ledgerText,
      record,
      probes,
      currentBase: args.currentBase,
      newBase: args.newBase,
      fetcher,
    });
    for (const note of notes) process.stdout.write(`note: ${note}\n`);
    for (const finding of findings) process.stdout.write(`warn: ${finding}\n`);
    process.stdout.write(
      `measured: 実体を写す行 ${counts.rows} 件（突き合わせ ${counts.checkedRows} 件・ファイル ${counts.files} 件）\n`,
    );
    const ok = findings.length === 0;
    if (args.write !== null) {
      writeResult(
        args.write,
        {
          tool: "asset-delivery-check",
          tool_version: VERSION,
          ok,
          rows: counts.rows,
          checked_rows: counts.checkedRows,
          checked_files: counts.files,
          failures: findings.length,
          findings,
          files,
          ledger_fingerprint: fingerprints.ledger,
          record_fingerprint: fingerprints.record,
          probe_fingerprints: fingerprints.probes,
          error: null,
        },
        writeFile,
      );
    }
    if (!ok) {
      process.stdout.write(
        `error: 台帳の方針どおりに配っていない資産が ${findings.length} 件ある — 新側の配信物と参照を直して取り直す\n`,
      );
      return 1;
    }
    process.stdout.write(
      `ok: 実体を写す資産は新側が移行元と同じバイトで配っている（asset-delivery-check ${VERSION}）\n`,
    );
    return 0;
  } catch (e) {
    const message =
      e instanceof UsageError
        ? e.message
        : e instanceof Error && typeof (/** @type {NodeJS.ErrnoException} */ (e).code) === "string"
          ? e.message
          : `判定できない例外で終了した: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    process.stderr.write(`error: ${message}\n${usage}\n`);
    // exit 2 でも前回の合格を残さない（判定していないことを記録に残す）
    if (writeTarget !== null) {
      try {
        writeResult(
          writeTarget,
          {
            tool: "asset-delivery-check",
            tool_version: VERSION,
            ok: false,
            ledger_fingerprint: fingerprints.ledger,
            record_fingerprint: fingerprints.record,
            probe_fingerprints: fingerprints.probes,
            error: message,
          },
          writeFile,
        );
      } catch (we) {
        process.stderr.write(
          `error: --write の先へ失敗を記録できない: ${we instanceof Error ? we.message : String(we)}\n`,
        );
      }
    }
    return 2;
  }
}

/**
 * @param {string} text
 * @param {string} path
 * @returns {unknown}
 */
function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `JSON として読めない: ${path}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
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
  process.exitCode = await main(process.argv.slice(2));
}
