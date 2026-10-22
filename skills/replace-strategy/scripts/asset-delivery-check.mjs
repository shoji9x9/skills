// 静的資産の台帳で「実体をコピーする」と決めた資産を、新側が実際に配っているかを突き合わせる。
// 判定の規則は、このファイルで定義する。
//
// `.replace/assets.md` は、資産の種類ごとに「実体をコピーする／同等物を作る／コピーしない」を決める。
// しかし、決めた方針どおりに新側が配っているかは、スイートの green・画素・特性照合・aria のどれにも現れないことがある
// （favicon はタブにしか出ない。title や印刷用の資産も同じ）。そこで、parity-replace の完了の判定でこのチェックを通す。
//
// 期待する集合の出所は、台帳（宣言）の「状態 `有効` × 方針 `実体をコピーする`」の行である。
// 突き合わせの記録（asset-delivery.json）は、その全行に 1 件ずつ答える。
// 記録に無い行は「確かめていない」として失敗にする（記録の側から期待する集合を作らない）。
//
// files を書いた行ごとに、次の 2 つを確かめる。
//
// 1. 新側の配信物が参照している。記録の new を --new-base で解決した URL が、
//    新側の画面で asset-probe.mjs を当てた出力（--probe）に、完全一致（href）で現れることを確かめる。
//    見るフィールドは images[].src・urlRefs[].url・fontFaces[].src[]・icons[].href・resources[].url である。
//    次のフィールドは採用しない。unclassifiedResources（資産以外の取得も含まれる）、
//    manifests（manifest そのものの URL で、中の icons は読んでいない）、localFragmentRefs（文書の中の参照）である。
// 2. 取得したバイト列が、移行元の配信物と一致する。current を --current-base、new を --new-base で解決して取得し、
//    どちらも 2xx で、sha256 が一致することを確かめる（SPA のフォールバックが 200 で index.html を返す形も、ここで失敗にする）。
//
// 突き合わせない行は、disposition: accepted（この機能の画面が使わない・機械的に確かめられない）だけである。
// accepted には、reason と利用者の承認（approved_by・approved_at）が必須である。
// 「この画面では使わない」をチェックする人が自分で宣言する used: false は置かない。
// 台帳の「描き方と使われるページ」は自由記述で、そこから外してよい行を読み取る規則は、表記ゆれのたびに外せる側へ外れた
// （全頁・共通ヘッダー・`/*`・日本語の続くパス・サブパスの配下）。外すのは、常に利用者の判断にする。
//
// 判定できないときは失敗として扱う。次のものは、どれも exit 2（判定していない）にする。
// 台帳の表が無い・複数ある・状態や方針が語彙にない・同じ種類に `有効` が 2 行ある・記録の形が不正・
// 表に属さない行がある・コードフェンスが閉じない・確かめる資産があるのにプローブが無い。
// 取得の失敗・参照が無い・バイト列の不一致・記録に無い行・台帳に無い記録は、exit 1 にする。
//
// ネットワークに依存する（取得して比べることがチェックの中身である）。それ以外は決定論的に動く。
// TypeScript の構文は使わない（型は JSDoc で書く）。

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { parseJsonOrThrow } from "./lib/json.mjs";
import { parseTables, unclosedFenceMessage } from "./lib/markdown.mjs";

/** ツールのバージョン（このファイルで定義する）。判定の規則や出力の形を変えたら上げる。 */
export const VERSION = "3";

/** replace-metadata.json に書くキー。 */
export const WRITE_KEY = "asset_delivery_check";

/** 使い方の誤り・入力の不備（exit 2）。 */
export class UsageError extends Error {}

/** 台帳の状態の語彙。 */
const STATUS_ACTIVE = "有効";
const STATUS_CANCELLED_PREFIX = "取り消し済み";
/** 台帳の方針の語彙（空欄は未決）。 */
export const POLICY_COPY = "実体をコピーする";
const POLICIES = new Set([POLICY_COPY, "同等物を作る", "コピーしない", ""]);
/**
 * 旧い方針の値（改名する前の台帳）。同じ意味として新しい値に読み替える。
 * 既に書かれた台帳を書き直さずに判定できるようにするためで、警告は出さない。
 */
// 旧い値は改名前の台帳を読むために残す。
// textlint-disable
export const LEGACY_POLICIES = new Map([
  ["実体を写す", POLICY_COPY],
  ["写さない", "コピーしない"],
]);
// textlint-enable

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
 * @typedef {{ kind: string, line: number }} LedgerRow
 */

/**
 * 台帳から方針の表（「種類」「方針」「状態」の列を持つ表）を 1 つだけ取り出す。
 * @param {string} text
 * @returns {ReturnType<typeof parseTables>["tables"][number]}
 */
function findPolicyTable(text) {
  const { tables, strayRows, unclosedFence } = parseTables(text, {
    normalizeHeader: normalizeCell,
  });
  if (unclosedFence !== null) throw new UsageError(`台帳の ${unclosedFenceMessage(unclosedFence)}`);
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
  const table = candidates[0];
  const { headers } = table;
  // 表に属さない行（本体の途中の空行で切れた追記など）に「実体をコピーする」の行があると、期待する集合から警告なしに消える。
  // 行頭の `|` があるか、方針の表と同じセル数なら表の行を意図したものとみなし、どの表の行か決められないので判定しない（判定できないときは失敗として扱う）。
  // 散文中の `|`（セル数が合わず行頭にも無い）は対象にしない。
  const stray = strayRows.filter((r) => r.leadingPipe || r.cells === headers.length);
  if (stray.length > 0) {
    throw new UsageError(
      `台帳の ${stray.map((r) => r.line).join(", ")} 行目は表に属さない（直前の空行か HTML コメントの行で表が切れている等）。表の本体に空行と HTML コメントの行を挟まない`,
    );
  }
  for (const name of ["種類", "方針", "状態"]) {
    if (headers.filter((h) => h === name).length > 1) {
      throw new UsageError(`台帳の表に「${name}」列が 2 つある`);
    }
  }
  return table;
}

/**
 * 方針の表の列の位置。表ごとに 1 回だけ求め、行を読むたびに見出しを探さない。
 * @typedef {{ width: number, kind: number, status: number, policy: number }} LedgerColumns
 */

/**
 * 台帳の 1 行から種類と方針を読む。取り消し済みの行は null を返す。
 * @param {string[]} row
 * @param {{ columns: LedgerColumns, line: number }} context
 * @returns {{ kind: string, policy: string } | null}
 */
function readLedgerRow(row, { columns, line }) {
  if (row.length !== columns.width) {
    throw new UsageError(
      `台帳の ${line} 行目の列数が見出しと違う（${row.length} ≠ ${columns.width}。セル内の | は \\| と書く）`,
    );
  }
  const kind = normalizeCell(row[columns.kind]);
  const status = normalizeCell(row[columns.status]);
  if (kind === "") throw new UsageError(`台帳の ${line} 行目の「種類」が空`);
  if (status.startsWith(STATUS_CANCELLED_PREFIX)) return null;
  if (status !== STATUS_ACTIVE) {
    throw new UsageError(
      `台帳の ${line} 行目（${kind}）の状態が語彙外: "${status}"（${STATUS_ACTIVE} ｜ ${STATUS_CANCELLED_PREFIX}（…））`,
    );
  }
  const written = normalizeCell(row[columns.policy]);
  const policy = LEGACY_POLICIES.get(written) ?? written;
  if (!POLICIES.has(policy)) {
    throw new UsageError(
      `台帳の ${line} 行目（${kind}）の方針が語彙外: "${policy}"（実体をコピーする ｜ 同等物を作る ｜ コピーしない ｜ 空欄）`,
    );
  }
  return { kind, policy };
}

/**
 * 台帳から「状態 `有効` × 方針 `実体をコピーする`」の行を取り出す。
 * @param {string} text
 * @returns {{ copyRows: LedgerRow[], activeRows: number }}
 */
export function readAssetLedger(text) {
  const { headers, rows, rowLines } = findPolicyTable(text);
  /** @type {LedgerColumns} */
  const columns = {
    width: headers.length,
    kind: headers.indexOf("種類"),
    status: headers.indexOf("状態"),
    policy: headers.indexOf("方針"),
  };
  /** @type {Map<string, number>} */
  const activeByKind = new Map();
  /** @type {LedgerRow[]} */
  const copyRows = [];
  rows.forEach((row, index) => {
    // 台帳ファイル上の行番号（表の中の何行目かではない）。エラー文・findings で利用者が開く行を指す。
    const line = rowLines[index];
    const read = readLedgerRow(row, { columns, line });
    if (read === null) return;
    const { kind, policy } = read;
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
 * accepted の行に、理由と利用者の承認が書いてあることを確かめる。
 * @param {Record<string, unknown>} raw
 * @param {string} at
 * @param {string} kind
 */
function assertAcceptance(raw, at, kind) {
  if (raw.disposition !== "accepted") {
    throw new UsageError(
      `${at}.disposition は accepted だけ（${kind}: "${String(raw.disposition)}"）`,
    );
  }
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

/**
 * 突き合わせる行の files（移行元と新側の URL の組）を読む。
 * @param {Record<string, unknown>} raw
 * @param {string} at
 * @param {string} kind
 * @returns {{ current: string, new: string }[]}
 */
function readRecordFiles(raw, at, kind) {
  if (!isArray(raw.files) || raw.files.length === 0) {
    throw new UsageError(`${at}.files が空（${kind}。移行元と新側の URL の組を 1 件以上書く）`);
  }
  /** @type {{ current: string, new: string }[]} */
  const files = [];
  raw.files.forEach((f, j) => {
    if (!isPlainObject(f) || !nonEmptyString(f.current) || !nonEmptyString(f.new)) {
      throw new UsageError(`${at}.files[${j}] に current と new が無い（${kind}）`);
    }
    files.push({ current: f.current.trim(), new: f.new.trim() });
  });
  return files;
}

/**
 * 記録の entries の 1 件を読む。
 * @param {unknown} raw
 * @param {number} i
 * @param {Set<string>} seen 読んだ種類（重複の検出に使う）
 * @returns {RecordEntry}
 */
function readRecordEntry(raw, i, seen) {
  const at = `entries[${i}]`;
  if (!isPlainObject(raw)) throw new UsageError(`${at} がオブジェクトでない`);
  if (!nonEmptyString(raw.kind))
    throw new UsageError(`${at}.kind が空（台帳の「種類」を転記する）`);
  const kind = normalizeCell(raw.kind);
  if (seen.has(kind)) throw new UsageError(`記録に「${kind}」が 2 件ある`);
  seen.add(kind);
  // 「この画面では使わない」をチェックする人が自分で宣言して外す形（used: false）は持たない。警告なしに読み飛ばすと
  // used: false と書いた記録が files の無い行として別の理由で落ち、外し方が伝わらないので、名指しで落とす
  if (raw.used !== undefined) {
    throw new UsageError(
      `${at}.used は書かない（${kind}。突き合わせるなら files を書き、この画面で使わないなら disposition: accepted と利用者の承認を書く）`,
    );
  }
  const accepted = raw.disposition !== undefined;
  if (accepted) assertAcceptance(raw, at, kind);
  if (accepted && raw.files !== undefined) {
    throw new UsageError(
      `${at}.files は accepted の行に書かない（${kind}。書いたのに確かめない、を作らない）`,
    );
  }
  return {
    kind,
    accepted,
    reason: nonEmptyString(raw.reason) ? raw.reason.trim() : null,
    files: accepted ? [] : readRecordFiles(raw, at, kind),
  };
}

/**
 * 突き合わせの記録（asset-delivery.json）を読む。形の崩れは exit 2。
 * @param {unknown} doc
 * @returns {RecordEntry[]}
 */
export function readRecord(doc) {
  if (!isPlainObject(doc)) throw new UsageError("記録が JSON オブジェクトでない");
  if (!isArray(doc.entries)) throw new UsageError("記録の entries が配列でない");
  /** @type {Set<string>} */
  const seen = new Set();
  return doc.entries.map((raw, i) => readRecordEntry(raw, i, seen));
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
    if (!isArray(probe[key])) {
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
  // 上の検査で各キーが配列だと確かめてあるので、`[]` は型を絞るためだけにある（到達しない）。
  /**
   * @param {string} key
   * @returns {unknown[]}
   */
  const rowsOf = (key) => {
    const rows = probe[key];
    return isArray(rows) ? rows : [];
  };
  for (const row of rowsOf("images")) if (isPlainObject(row)) add(row.src);
  for (const row of rowsOf("urlRefs")) if (isPlainObject(row)) add(row.url);
  for (const row of rowsOf("fontFaces")) {
    if (isPlainObject(row) && isArray(row.src)) for (const u of row.src) add(u);
  }
  for (const row of rowsOf("icons")) if (isPlainObject(row)) add(row.href);
  for (const row of rowsOf("resources")) if (isPlainObject(row)) add(row.url);
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
        error: errorMessage(e),
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
 * 突き合わせた 1 組の記録。current_redirected・new_redirected・bytes_match は、組を作った後に必ず埋める。
 * @typedef {{ kind: string, current: string, new: string, referenced: boolean,
 *             current_status: number, new_status: number,
 *             current_sha256: string | null, new_sha256: string | null,
 *             current_redirected?: boolean, new_redirected?: boolean, bytes_match?: boolean }} CheckedFile
 */

/**
 * @typedef {{ newBaseOrigin: string, currentBaseOrigin: string }} BaseOrigins
 * @typedef {{ currentBase: string, newBase: string, baseOrigins: BaseOrigins, referenced: Set<string>, fetcher: Fetcher, findings: string[] }} FileContext
 * @typedef {{ newBaseOrigin: string, currentOrigins: Set<string> }} LinkOrigins
 * @typedef {{ kind: string, file: { current: string, new: string }, currentUrl: string, newUrl: string, origins: LinkOrigins | null }} FilePair
 */

/**
 * 移行元側のオリジン（--current-base と、current を解決した URL のオリジン。移行元が CDN から配る資産を含む）を集める。
 * 新側のオリジンと同じものは外す。
 * @param {string} currentBaseOrigin
 * @param {string} currentUrl
 * @param {string} newBaseOrigin
 * @returns {Set<string>}
 */
function migrationOrigins(currentBaseOrigin, currentUrl, newBaseOrigin) {
  const currentOrigins = new Set([currentBaseOrigin, new URL(currentUrl).origin]);
  currentOrigins.delete(newBaseOrigin);
  return currentOrigins;
}

/**
 * --new-base と --current-base のオリジンを求める。
 * @param {{ currentBase: string, newBase: string }} bases
 * @returns {BaseOrigins}
 */
function originsOf({ currentBase, newBase }) {
  return { newBaseOrigin: new URL(newBase).origin, currentBaseOrigin: new URL(currentBase).origin };
}

/**
 * 直リンクの判定（転送の前と後）に使うオリジンを、1 組につき 1 回だけ求める。
 * 新側と移行元が同じオリジンの構成ではオリジンで見分けられないので、判定しない（null を返す）。
 * @param {FileContext} ctx
 * @param {string} currentUrl
 * @returns {LinkOrigins | null}
 */
function linkOrigins(ctx, currentUrl) {
  const { newBaseOrigin, currentBaseOrigin } = ctx.baseOrigins;
  if (currentBaseOrigin === newBaseOrigin) return null;
  return {
    newBaseOrigin,
    currentOrigins: migrationOrigins(currentBaseOrigin, currentUrl, newBaseOrigin),
  };
}

/**
 * 取得する前に分かる指摘（同じ URL・直リンク）を findings に足す。
 * @param {FilePair} pair
 * @param {string[]} findings
 */
function pushLinkFindings({ kind, file, currentUrl, newUrl, origins }, findings) {
  // 同じ URL に解決される組は、同じ配信物を 2 回取得して比べるだけで必ず一致する（同じオリジンの構成で
  // current と new に同じパスを書いた等）。新側が配っていることの証拠にならないので落とす
  if (currentUrl === newUrl) {
    findings.push(
      `「${kind}」の current と new が同じ URL（${newUrl}）に解決される（同じ配信物を比べているだけ。新側が配る URL を書く）`,
    );
  }
  // 直リンクは両向きで落とす（どちらも同じ配信物を 2 回比べるだけで必ず一致する）。
  // 新側と移行元が別オリジンの構成のときだけ判定する（同じオリジンの構成ではオリジンで見分けられない）。
  //   - new が移行元側のオリジン（--current-base か、current を解決した URL のオリジン。移行元が CDN から配る資産を含む）を指す
  //   - current が新側のオリジン（--new-base）を指す（移行元を一度も取得していない）
  if (origins !== null) {
    const { newBaseOrigin, currentOrigins } = origins;
    const newOrigin = new URL(newUrl).origin;
    if (currentOrigins.has(newOrigin)) {
      findings.push(
        `「${kind}」の ${file.new} は移行元のオリジン（${newOrigin}）を指している（新側が移行元へ直リンクしている。新側が自分で配る URL を書く）`,
      );
    }
    if (new URL(currentUrl).origin === newBaseOrigin) {
      findings.push(
        `「${kind}」の ${file.current} は新側のオリジン（${newBaseOrigin}）を指している（移行元の配信物を取得していない。移行元が配る URL を書く）`,
      );
    }
  }
}

/**
 * 取得した応答そのものの指摘（取得できない・空・HTML）を findings に足す。
 * @param {FilePair} pair
 * @param {{ cur: Awaited<ReturnType<Fetcher>>, neu: Awaited<ReturnType<Fetcher>> }} responses
 * @param {string[]} findings
 */
function pushResponseFindings({ kind, currentUrl, newUrl }, { cur, neu }, findings) {
  /** @type {[string, Awaited<ReturnType<Fetcher>>, string][]} */
  const sides = [
    ["移行元", cur, currentUrl],
    ["新側", neu, newUrl],
  ];
  for (const [side, res, url] of sides) {
    if (!res.ok || res.bytes === null) {
      findings.push(
        `「${kind}」の${side}の配信物を取得できない（${url}: ${res.error ?? `HTTP ${res.status}`}）`,
      );
    } else if (res.bytes.length === 0) {
      // 両側とも 0 バイトなら sha256 は一致するが、資産を配っていることの証拠にならない
      findings.push(`「${kind}」の${side}の配信物が空（0 バイト。${url}）`);
    } else if (typeof res.contentType === "string" && /^text\/html\b/iu.test(res.contentType)) {
      // 静的資産（画像・書体・アイコン）が HTML で返るのは、SPA のフォールバックかログイン画面
      findings.push(
        `「${kind}」の${side}の配信物が HTML で返った（${url}: ${res.contentType}。SPA のフォールバックかログイン画面の可能性）`,
      );
    }
  }
}

/**
 * 転送の後の指摘（移行元への転送・新側への転送・同じ転送先）を findings に足す。
 * @param {FilePair} pair
 * @param {{ cur: Awaited<ReturnType<Fetcher>>, neu: Awaited<ReturnType<Fetcher>> }} responses
 * @param {string[]} findings
 */
function pushRedirectFindings({ kind, file, origins }, { cur, neu }, findings) {
  // 転送そのものは正規の配り方（ハッシュ付きのパスへの 301・署名付き URL への 302 等）なので落とさない。
  // 参照はプローブが記録する転送前の URL（記録の new）で判定し、バイトと HTML かどうかは最終応答で見る
  // （ログイン画面への転送は最終応答が HTML になるので上で落ちる）。
  // ただし両側が同じ転送先に着いたら、同じ配信物を比べているだけなので落とす。
  // 転送先は署名付き URL のクエリを含みうるので、記録と出力にはオリジンとパスだけを出す。
  // 直リンクの判定は転送の後にも当てる（新側が移行元へ 302 で飛ばす形は、転送前の new だけを見ると通る）。
  // 別オリジンの構成のときだけ判定する点と、移行元側のオリジンの集合は転送前の判定と同じ（linkOrigins で 1 回だけ求める）
  if (origins !== null) {
    const { newBaseOrigin, currentOrigins } = origins;
    const finalOrigin = (/** @type {string | undefined} */ u) =>
      typeof u === "string" && u !== "" ? new URL(u).origin : null;
    const newFinal = neu.redirected === true ? finalOrigin(neu.finalUrl) : null;
    const currentFinal = cur.redirected === true ? finalOrigin(cur.finalUrl) : null;
    if (newFinal !== null && currentOrigins.has(newFinal)) {
      findings.push(
        `「${kind}」の ${file.new} は移行元のオリジン（${newFinal}）へ転送される（新側が移行元へ転送で直リンクしている。新側が自分で配る）`,
      );
    }
    if (currentFinal !== null && currentFinal === newBaseOrigin) {
      findings.push(
        `「${kind}」の ${file.current} は新側のオリジン（${newBaseOrigin}）へ転送される（移行元の配信物を取得していない）`,
      );
    }
  }
  if (
    (cur.redirected === true || neu.redirected === true) &&
    typeof cur.finalUrl === "string" &&
    cur.finalUrl !== "" &&
    cur.finalUrl === neu.finalUrl
  ) {
    const at = new URL(cur.finalUrl);
    findings.push(
      `「${kind}」の移行元と新側が同じ転送先（${at.origin}${at.pathname}）に着いた（同じ配信物を比べているだけ。新側が自分で配る URL を書く）`,
    );
  }
}

/**
 * 1 組（current と new）を突き合わせ、指摘を ctx.findings に足して、組の記録を返す。
 * @param {string} kind
 * @param {{ current: string, new: string }} file
 * @param {FileContext} ctx
 * @returns {Promise<CheckedFile>}
 */
async function checkFile(kind, file, ctx) {
  const { findings } = ctx;
  const currentUrl = resolveAssetUrl(file.current, ctx.currentBase, `「${kind}」の current`);
  const newUrl = resolveAssetUrl(file.new, ctx.newBase, `「${kind}」の new`);
  /** @type {FilePair} */
  const pair = { kind, file, currentUrl, newUrl, origins: linkOrigins(ctx, currentUrl) };
  // 新側が移行元の配信物へ直リンクしていると、取得先が同じなので sha256 は必ず一致するが、移行元を止めた時点で消える。
  // バイトの一致を「新側が移行元と同じものを配っている」の証拠にできない組の指摘の件数。
  // bytes_match はこの種の指摘が無いときだけ真にする（参照していない等の別の軸の指摘は bytes_match に混ぜない）
  const byteFindingsBefore = findings.length;
  pushLinkFindings(pair, findings);
  const byteFindingsEnd = findings.length;
  const isReferenced = ctx.referenced.has(newUrl);
  if (!isReferenced) {
    findings.push(
      `「${kind}」の ${file.new} を新側の画面が参照していない（渡したプローブの images / urlRefs / fontFaces / icons / resources のどれにも ${newUrl} が無い）`,
    );
  }
  const [cur, neu] = await Promise.all([ctx.fetcher(currentUrl), ctx.fetcher(newUrl)]);
  /** @type {CheckedFile} */
  const result = {
    kind,
    current: file.current,
    new: file.new,
    referenced: isReferenced,
    current_status: cur.status,
    new_status: neu.status,
    current_sha256: cur.ok && cur.bytes !== null ? sha256(cur.bytes) : null,
    new_sha256: neu.ok && neu.bytes !== null ? sha256(neu.bytes) : null,
  };
  const fetchFindingsBefore = findings.length;
  pushResponseFindings(pair, { cur, neu }, findings);
  pushRedirectFindings(pair, { cur, neu }, findings);
  result.current_redirected = cur.redirected === true;
  result.new_redirected = neu.redirected === true;
  const match = result.current_sha256 !== null && result.current_sha256 === result.new_sha256;
  // 転送・HTML・空・同じ URL・直リンクの指摘が出た組は、sha256 が一致していても「一致」と記録しない
  // （参照していないの指摘は別の軸なので数えない。referenced に記録済み）
  result.bytes_match =
    match && byteFindingsEnd === byteFindingsBefore && findings.length === fetchFindingsBefore;
  if (result.current_sha256 !== null && result.new_sha256 !== null && !match) {
    findings.push(
      `「${kind}」の新側の配信物が移行元とバイト一致しない（${file.current} → ${String(result.current_sha256).slice(0, 12)}… / ${file.new} → ${String(result.new_sha256).slice(0, 12)}…）`,
    );
  }
  return result;
}

/**
 * 台帳の「実体をコピーする」の行と記録を対応づけ、突き合わせる行を返す。
 * 記録に無い行と、台帳に無い記録は findings に、承認済みで突き合わせない行は notes に足す。
 * @param {LedgerRow[]} copyRows
 * @param {RecordEntry[]} entries
 * @param {{ findings: string[], notes: string[] }} out
 * @returns {{ row: LedgerRow, entry: RecordEntry }[]}
 */
function planChecks(copyRows, entries, { findings, notes }) {
  const byKind = new Map(entries.map((e) => [e.kind, e]));
  const copyKinds = new Set(copyRows.map((r) => r.kind));
  for (const entry of entries) {
    if (!copyKinds.has(entry.kind)) {
      findings.push(
        `記録の「${entry.kind}」は台帳の「状態 有効 × 方針 実体をコピーする」の行に無い（台帳の種類の綴りと揃えるか、方針が変わったなら記録から外す）`,
      );
    }
  }
  /** @type {{ row: LedgerRow, entry: RecordEntry }[]} */
  const toCheck = [];
  for (const row of copyRows) {
    const entry = byKind.get(row.kind);
    if (entry === undefined) {
      findings.push(
        `台帳の「${row.kind}」（実体をコピーする）を突き合わせていない（asset-delivery.json に行が無い。この画面で使わないなら disposition: accepted と利用者の承認を書く）`,
      );
      continue;
    }
    if (entry.accepted) {
      notes.push(`「${row.kind}」は突き合わせない（利用者の承認済み）: ${entry.reason}`);
      continue;
    }
    toCheck.push({ row, entry });
  }
  return toCheck;
}

/**
 * 突き合わせる。currentBase と newBase は、URL として読める http(s) の絶対 URL を渡す（parseArgs が確かめる）。
 * @param {{ ledgerText: string, record: unknown, probes: { label: string, doc: unknown }[], currentBase: string, newBase: string, fetcher: Fetcher }} input
 * @returns {Promise<{ findings: string[], notes: string[], files: CheckedFile[], counts: { rows: number, checkedRows: number, files: number } }>}
 */
export async function check(input) {
  const baseOrigins = originsOf(input);
  const { copyRows } = readAssetLedger(input.ledgerText);
  const entries = readRecord(input.record);
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {CheckedFile[]} */
  const files = [];

  /** @type {Set<string>} */
  const referenced = new Set();
  for (const probe of input.probes) {
    for (const u of referencedUrls(probe.doc, probe.label)) referenced.add(u);
  }
  const toCheck = planChecks(copyRows, entries, { findings, notes });
  // 承認済み（accepted）以外の行が 1 つでもあれば、参照を確かめるプローブが要る
  const needsProbe = toCheck.length > 0;
  if (needsProbe && input.probes.length === 0) {
    throw new UsageError(
      "突き合わせる資産があるのに --probe が無い（新側の画面で asset-probe.mjs を当てた出力を渡す）",
    );
  }

  /** @type {FileContext} */
  const ctx = {
    currentBase: input.currentBase,
    newBase: input.newBase,
    baseOrigins,
    referenced,
    fetcher: input.fetcher,
    findings,
  };
  let fileCount = 0;
  for (const { row, entry } of toCheck) {
    for (const file of entry.files) {
      fileCount += 1;
      files.push(await checkFile(row.kind, file, ctx));
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
 * 引数を名前ごとに集める。--probe は何度でも指定でき、それ以外は 1 回だけ。
 * @param {string[]} argv
 * @returns {{ opts: Record<string, string>, probes: string[] }}
 */
function collectArgs(argv) {
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
  return { opts, probes };
}

/**
 * --current-base・--new-base の値が、http(s) で始まり URL として読めることを確かめる。
 * @param {string} key 引数の名前
 * @param {string} value
 */
function assertBaseUrl(key, value) {
  if (!/^https?:\/\//iu.test(value))
    throw new UsageError(`${key} は http(s) の絶対 URL: "${value}"`);
  try {
    new URL(value);
  } catch {
    throw new UsageError(`${key} を URL として読めない: "${value}"`);
  }
}

/**
 * @param {string[]} argv
 * @returns {{ assets: string, record: string, probes: string[], currentBase: string, newBase: string, write: string | null, timeoutMs: number }}
 */
export function parseArgs(argv) {
  const { opts, probes } = collectArgs(argv);
  for (const key of ["--assets", "--record", "--current-base", "--new-base"]) {
    if (!opts[key]) throw new UsageError(`${key} は必須（推測させない）`);
  }
  for (const key of ["--current-base", "--new-base"]) assertBaseUrl(key, opts[key]);
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
  "exit: 0 = 台帳の「有効 × 実体をコピーする」の行が全て突き合った（該当 0 行を含む） / 1 = 突き合わない行がある",
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
 * @typedef {{ ledger: string | null, record: string | null, probes: { path: string, sha256: string }[] }} Fingerprints
 */

/**
 * 台帳・記録・プローブを読み、判定を左右する入力の指紋を fingerprints に残す。
 * @param {ReturnType<typeof parseArgs>} args
 * @param {Fingerprints} fingerprints
 * @returns {{ ledgerText: string, record: unknown, probes: { label: string, doc: unknown }[] }}
 */
function readInputs(args, fingerprints) {
  const ledgerText = readFileSync(args.assets, "utf8");
  fingerprints.ledger = createHash("sha256").update(ledgerText).digest("hex");
  const recordText = readFileSync(args.record, "utf8");
  fingerprints.record = createHash("sha256").update(recordText).digest("hex");
  const record = parseJson(recordText, args.record);
  // プローブも判定を左右する入力なので指紋を残す（プローブをもう一度当てた後に、古い合格を見分けるため）
  const probes = args.probes.map((p) => {
    const text = readFileSync(p, "utf8");
    fingerprints.probes.push({
      path: relative(process.cwd(), p),
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    return { label: p, doc: parseJson(text, p) };
  });
  return { ledgerText, record, probes };
}

/**
 * 判定した結果を --write の先へ記録する形にする。
 * @param {Awaited<ReturnType<typeof check>>} outcome
 * @param {Fingerprints} fingerprints
 * @returns {Record<string, unknown>}
 */
function successRecord({ findings, files, counts }, fingerprints) {
  return {
    tool: "asset-delivery-check",
    tool_version: VERSION,
    ok: findings.length === 0,
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
  };
}

/**
 * 判定していない（exit 2）ことを stderr に出し、--write の先があれば失敗として記録する。
 * @param {unknown} e
 * @param {{ writeTarget: string | null, fingerprints: Fingerprints, writeFile: (p: string, s: string) => void }} options
 * @returns {number}
 */
function reportUsageFailure(e, { writeTarget, fingerprints, writeFile }) {
  const message =
    e instanceof UsageError
      ? e.message
      : e instanceof Error && "code" in e && typeof e.code === "string"
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
      process.stderr.write(`error: --write の先へ失敗を記録できない: ${errorMessage(we)}\n`);
    }
  }
  return 2;
}

/**
 * @param {string[]} argv
 * @param {{ fetcher?: Fetcher, writeFile?: (p: string, s: string) => void }} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const writeTarget = preScanWrite(argv);
  /** @type {Fingerprints} */
  const fingerprints = { ledger: null, record: null, probes: [] };
  try {
    const args = parseArgs(argv);
    const { ledgerText, record, probes } = readInputs(args, fingerprints);
    const fetcher = deps.fetcher ?? defaultFetcher(args.timeoutMs);
    const outcome = await check({
      ledgerText,
      record,
      probes,
      currentBase: args.currentBase,
      newBase: args.newBase,
      fetcher,
    });
    const { findings, notes, counts } = outcome;
    for (const note of notes) process.stdout.write(`note: ${note}\n`);
    for (const finding of findings) process.stdout.write(`warn: ${finding}\n`);
    process.stdout.write(
      `measured: 実体をコピーする行 ${counts.rows} 件（突き合わせ ${counts.checkedRows} 件・ファイル ${counts.files} 件）\n`,
    );
    if (args.write !== null)
      writeResult(args.write, successRecord(outcome, fingerprints), writeFile);
    if (findings.length > 0) {
      process.stdout.write(
        `error: 台帳の方針どおりに配っていない資産が ${findings.length} 件ある — 新側の配信物と参照を直して、もう一度突き合わせる\n`,
      );
      return 1;
    }
    process.stdout.write(
      `ok: 実体をコピーする資産は新側が移行元と同じバイトで配っている（asset-delivery-check ${VERSION}）\n`,
    );
    return 0;
  } catch (e) {
    return reportUsageFailure(e, { writeTarget, fingerprints, writeFile });
  }
}

/**
 * @param {string} text
 * @param {string} path
 * @returns {unknown}
 */
function parseJson(text, path) {
  return parseJsonOrThrow(
    text,
    (message) => new UsageError(`JSON として読めない: ${path}（${message}）`),
  );
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = await main(process.argv.slice(2));
}
