// 新側の横のはみ出しを判定し、verify-metadata.json の overflow に書く（spec-parity verify の手順 3）。
// suite では、同じ判定を --side current で現行に当て、現行が保証している幅を決める（現行がはみ出す幅は宣言に入れない）。
//
// 何のためか: style_policy が free のリプレイスでは、現行と新側の画面を比べない。見た目が自由になった分、
// 現行が保証していた幅（ビューポート）で、新側のページが横にはみ出してスクロールするようになっても、スイートはどれも緑のまま通る。
// そこで、suite が metadata.json に記録した幅とページの組をすべて新側で測り、1 組でもはみ出していれば合格にしない。
//
// 測るのは、利用者のプロジェクトにコピーした overflow のテスト（雛形 assets/overflow.e2e.template.ts）である。
// このスクリプトはブラウザを動かさず、テストが書いた測定の記録を読むだけである。
//
// 期待する組は、測定の記録からではなく、metadata.json の capture_conditions.pages と capture_conditions.viewports から作る。
// 測っていない組は「はみ出していない」ではなく missing として数え、合格にしない。
// はみ出しは documentElement の scrollWidth が clientWidth を超えることで判定する。許容の幅は持たない（1px でも超えれば数える）。
// window.innerWidth が宣言の幅と違う記録は、その幅で測れていないので width_mismatch として数え、合格にしない。
// 宣言に無い組の記録は extra として数える（宣言と測定のどちらかが古い）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 宣言したすべての組を測り、はみ出しが無い、1 ＝ はみ出し・未測定・幅の不一致・宣言に無い組がある、
// 2 ＝ 使い方の誤り・読めない入力・形の誤り（判定していない）。

import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags, stripDashes } from "./lib/flags.mjs";
import { isInteger, isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import {
  UsageError,
  judgeIo,
  jsonText,
  readJsonFile,
  runJudge,
  writeJsonFile,
} from "./lib/read-json.mjs";

/** ツールのバージョン。判定規則と出力の形を変えたら上げる。 */
export const VERSION = "1";

/** 測定の記録の形式のバージョン。雛形の OVERFLOW_VERSION と同じ値にする。 */
export const MEASUREMENT_VERSION = "1";

/**
 * @typedef {{ width: number, height: number }} Viewport
 * @typedef {{ slug: string, pages: string[], viewports: Viewport[] }} Declaration
 * @typedef {{ page: string, viewport: Viewport, inner_width: number, client_width: number, scroll_width: number }} MeasureRecord
 */

/**
 * 1 組の鍵。ページと幅と高さの組を区切り文字に頼らずに表す。
 * @param {string} page
 * @param {Viewport} v
 * @returns {string}
 */
function keyOf(page, v) {
  return JSON.stringify([page, v.width, v.height]);
}

/**
 * 幅の宣言を読む。
 * @param {unknown} list
 * @returns {Viewport[]}
 */
function readViewports(list) {
  if (!isArray(list) || list.length === 0)
    throw new UsageError("capture_conditions.viewports が空か配列でない（suite で幅を記録する）");
  const seen = new Set();
  return list.map((v, i) => {
    if (!isPlainObject(v) || !positiveInt(v.width) || !positiveInt(v.height))
      throw new UsageError(
        `capture_conditions.viewports[${i}] の width か height が 1 以上の整数でない`,
      );
    const key = `${v.width}x${v.height}`;
    if (seen.has(key)) throw new UsageError(`capture_conditions.viewports が重複している: ${key}`);
    seen.add(key);
    return { width: v.width, height: v.height };
  });
}

/**
 * 測るページの宣言を読む。
 * @param {unknown} list
 * @returns {string[]}
 */
function readPages(list) {
  if (!isArray(list) || list.length === 0)
    throw new UsageError(
      "capture_conditions.pages が空か配列でない（suite で測るページを記録する）",
    );
  const seen = new Set();
  return list.map((p, i) => {
    if (!nonEmptyString(p) || !p.startsWith("/"))
      throw new UsageError(`capture_conditions.pages[${i}] が / で始まる path でない`);
    if (seen.has(p)) throw new UsageError(`capture_conditions.pages が重複している: ${p}`);
    seen.add(p);
    return p;
  });
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function positiveInt(v) {
  return isInteger(v) && v >= 1;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function nonNegativeInt(v) {
  return isInteger(v) && v >= 0;
}

/**
 * metadata.json から、測る組の宣言を読む。
 * @param {unknown} metadata
 * @returns {Declaration}
 */
export function readDeclaration(metadata) {
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json に slug が無い");
  if (metadata.style_policy !== "free")
    throw new UsageError(
      `metadata.json の style_policy が free でない（${String(metadata.style_policy)}。spec-parity の成果物ではない）`,
    );
  const cc = metadata.capture_conditions;
  if (!isPlainObject(cc)) throw new UsageError("metadata.json に capture_conditions が無い");
  return {
    slug: metadata.slug,
    pages: readPages(cc.pages),
    viewports: readViewports(cc.viewports),
  };
}

/**
 * 1 件の測定を読む。
 * @param {unknown} r
 * @param {number} i
 * @returns {MeasureRecord}
 */
function readRecord(r, i) {
  const where = `records[${i}]`;
  if (!isPlainObject(r)) throw new UsageError(`${where} がオブジェクトでない`);
  if (!nonEmptyString(r.page)) throw new UsageError(`${where} の page が無い`);
  const v = r.viewport;
  if (!isPlainObject(v) || !positiveInt(v.width) || !positiveInt(v.height))
    throw new UsageError(`${where} の viewport の width か height が 1 以上の整数でない`);
  const inner = r.inner_width;
  const client = r.client_width;
  const scroll = r.scroll_width;
  if (!nonNegativeInt(inner) || !nonNegativeInt(client) || !nonNegativeInt(scroll))
    throw new UsageError(
      `${where} の inner_width・client_width・scroll_width が 0 以上の整数でない`,
    );
  /** @type {MeasureRecord} */
  const rec = {
    page: r.page,
    viewport: { width: v.width, height: v.height },
    inner_width: inner,
    client_width: client,
    scroll_width: scroll,
  };
  // clientWidth はスクロールバーの分だけ innerWidth より狭くなるが、広くはならない。0 は描画されていないページ
  if (rec.client_width === 0 || rec.client_width > rec.inner_width)
    throw new UsageError(
      `${where} の client_width が 0 か inner_width より大きい（${rec.client_width} / ${rec.inner_width}）`,
    );
  return rec;
}

/**
 * 測定の記録（overflow のテストが書く JSON）を読む。
 * @param {unknown} doc
 * @param {{ slug: string, target: string, side?: "current" | "new" }} expect - side を省くと new
 * @returns {{ commit: string, records: MeasureRecord[] }}
 */
export function readMeasurements(doc, expect) {
  const side = expect.side ?? "new";
  if (!isPlainObject(doc)) throw new UsageError("測定の記録がオブジェクトでない");
  /** @type {[boolean, string][]} */
  const checks = [
    [
      doc.version !== MEASUREMENT_VERSION,
      `version が ${MEASUREMENT_VERSION} でない（${String(doc.version)}）`,
    ],
    [doc.side !== side, `side が ${side} でない（${String(doc.side)}）`],
    [doc.slug !== expect.slug, `slug が ${expect.slug} でない（${String(doc.slug)}）`],
    [doc.target !== expect.target, `target が ${expect.target} でない（${String(doc.target)}）`],
    [!nonEmptyString(doc.commit), "commit が無い（PARITY_COMMIT を渡して測る）"],
    [!isArray(doc.records), "records が配列でない"],
  ];
  const failed = checks.find(([bad]) => bad);
  if (failed) throw new UsageError(`測定の記録の ${failed[1]}`);
  const list = doc.records;
  if (!isArray(list)) throw new UsageError("測定の記録の records が配列でない");
  const records = list.map(readRecord);
  const seen = new Set();
  for (const r of records) {
    const key = keyOf(r.page, r.viewport);
    if (seen.has(key))
      throw new UsageError(
        `同じページと幅の測定が 2 つある: ${r.page} ${r.viewport.width}x${r.viewport.height}`,
      );
    seen.add(key);
  }
  return { commit: String(doc.commit), records };
}

/**
 * 宣言した組と測定を突き合わせる。
 * @param {Declaration} decl
 * @param {MeasureRecord[]} records
 */
export function judgeOverflow(decl, records) {
  /** @type {Map<string, MeasureRecord>} */
  const byKey = new Map(records.map((r) => [keyOf(r.page, r.viewport), r]));
  const expected = new Set();
  /** @type {{ page: string, viewport: Viewport }[]} */
  const missing = [];
  /** @type {MeasureRecord[]} */
  const widthMismatch = [];
  /** @type {MeasureRecord[]} */
  const overflowing = [];
  for (const page of decl.pages) {
    for (const viewport of decl.viewports) {
      const key = keyOf(page, viewport);
      expected.add(key);
      const r = byKey.get(key);
      if (!r) missing.push({ page, viewport });
      else if (r.inner_width !== viewport.width) widthMismatch.push(r);
      else if (r.scroll_width > r.client_width) overflowing.push(r);
    }
  }
  const extra = records.filter((r) => !expected.has(keyOf(r.page, r.viewport)));
  return {
    tool: "overflow-check",
    version: VERSION,
    judged: true,
    ok: missing.length + widthMismatch.length + overflowing.length + extra.length === 0,
    counts: {
      expected: expected.size,
      measured: records.length,
      overflowing: overflowing.length,
      missing: missing.length,
      width_mismatch: widthMismatch.length,
      extra: extra.length,
    },
    overflowing,
    missing,
    width_mismatch: widthMismatch,
    extra,
  };
}

const USAGE =
  "usage: overflow-check.mjs --metadata <metadata.json> --measurements <overflow.json> --target <target> [--side current|new] [--write <verify-metadata.json>]";

/**
 * 書き込み先の verify-metadata.json を読み、slug と target が一致することを確かめる。
 * @param {string} path
 * @param {{ slug: string, target: string }} expect
 * @param {import("./lib/read-json.mjs").JudgeIo} io
 * @returns {Record<string, unknown>}
 */
function readVerifyMetadata(path, expect, io) {
  const doc = readJsonFile(path, io);
  if (!isPlainObject(doc)) throw new UsageError("verify-metadata.json がオブジェクトでない");
  if (doc.slug !== expect.slug || doc.target !== expect.target)
    throw new UsageError(
      `verify-metadata.json の slug と target が ${expect.slug} / ${expect.target} でない（${String(doc.slug)} / ${String(doc.target)}）`,
    );
  return doc;
}

/**
 * 判定に通らなかった理由を並べる。
 * @param {ReturnType<typeof judgeOverflow>} result
 * @returns {string}
 */
function failureText(result) {
  const parts = [];
  const vp = (/** @type {Viewport} */ v) => `${v.width}x${v.height}`;
  for (const r of result.overflowing)
    parts.push(
      `はみ出し ${r.page} ${vp(r.viewport)}（scrollWidth ${r.scroll_width} > clientWidth ${r.client_width}）`,
    );
  for (const r of result.missing) parts.push(`未測定 ${r.page} ${vp(r.viewport)}`);
  for (const r of result.width_mismatch)
    parts.push(`幅の不一致 ${r.page} ${vp(r.viewport)}（innerWidth ${r.inner_width}）`);
  for (const r of result.extra) parts.push(`宣言に無い組 ${r.page} ${vp(r.viewport)}`);
  return parts.join(" / ");
}

/**
 * --side の値を読む。現行の測定（suite で幅を決めるとき）は、verify-metadata.json に書かない。
 * @param {string | undefined} value
 * @param {string | undefined} write
 * @returns {"current" | "new"}
 */
function sideOf(value, write) {
  if (value === undefined || value === "new") return "new";
  if (value !== "current") throw new UsageError(`--side は current か new（${value}）`);
  if (write !== undefined)
    throw new UsageError(
      "--side current の判定は verify-metadata.json に書かない（--write を外す）",
    );
  return "current";
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {Partial<import("./lib/read-json.mjs").JudgeIo>} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = judgeIo(deps);
  return runJudge({ io, usage: USAGE }, () => {
    const parsed = parseFlags(argv, {
      values: ["--metadata", "--measurements", "--target", "--side", "--write"],
    });
    if (parsed.error !== undefined) throw new UsageError(parsed.error);
    const opts = stripDashes(parsed.strings);
    for (const k of ["metadata", "measurements", "target"]) {
      if (!nonEmptyString(opts[k])) throw new UsageError(`--${k} が要る`);
    }
    const side = sideOf(opts.side, opts.write);
    const decl = readDeclaration(readJsonFile(opts.metadata, io));
    const expect = { slug: decl.slug, target: opts.target, side };
    const verifyDoc = opts.write ? readVerifyMetadata(opts.write, expect, io) : null;
    const { commit, records } = readMeasurements(readJsonFile(opts.measurements, io), expect);
    const result = { ...judgeOverflow(decl, records), commit, measurements: opts.measurements };
    // 書き込みに失敗しても判定の結果が残るよう、先に出力する
    io.stdout(jsonText(result));
    if (verifyDoc && opts.write) writeJsonFile(io, opts.write, { ...verifyDoc, overflow: result });
    if (result.ok) return 0;
    io.stderr(`error: 横のはみ出しの判定が通らない。${failureText(result)}\n`);
    return 1;
  });
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
