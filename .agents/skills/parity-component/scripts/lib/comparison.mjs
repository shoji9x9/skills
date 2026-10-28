// 部品を比べる 2 つの CLI（behavior-compare.mjs・motion-compare.mjs）が共有する処理。
// 突き合わせ表の読み取りと検査、比べないことを選んだ行（disposition）の検査、CLI 本体を置く。
// 片方の CLI のファイルにこれらを置くと、その CLI を直したときにもう片方の判定と出力も変わり、版の管理が食い違う。

import { resolve } from "node:path";
import { loadBaseline } from "./baseline.mjs";
import { cliIo, parseFlagPairs, usageFailer, writeCheckResult } from "./check-cli.mjs";
import { field, filled, isPlainObject, nonEmptyString } from "./guards.mjs";
import { isArray } from "./is-array.mjs";

/** 突き合わせ表の行がとりうる扱いの語彙。null は「比べた」。 */
const DISPOSITIONS = ["accepted"];

/**
 * ISO 8601 の日付・日時として読めるか（承認日時の検査。プレースホルダや自由記述を通さない）。
 * **暦の上で実在する値だけを通す。** `Date.parse("2026-02-30")` は 3 月 2 日へ繰り上げて成功するので、
 * 解析の成否ではなく各欄の範囲と、年月日を UTC で組み直して同じ日に戻ることを確かめる。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isoDateTime(value) {
  if (typeof value !== "string") return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?)?$/.exec(
      value,
    );
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  /**
   * @param {string | undefined} part
   * @param {number} max
   */
  const within = (part, max) => part === undefined || Number(part) <= max;
  return (
    within(m[4], 23) && within(m[5], 59) && within(m[6], 59) && within(m[8], 23) && within(m[9], 59)
  );
}

/**
 * 操作 × インスタンスの鍵。区切り文字を持つ連結にせず JSON の配列にする
 * （`("a|b","c")` と `("a","b|c")` が同じ鍵に潰れない）。
 * @param {string} operation
 * @param {string} instance
 * @returns {string}
 */
export function cellKey(operation, instance) {
  return JSON.stringify([operation, instance]);
}

/**
 * 入力の値の型を、利用者に表示する名前で返す（オブジェクトでない採取物や表を報告するときに使う）。
 * @param {unknown} value
 * @returns {string}
 */
export function valueKind(value) {
  if (value === null) return "null";
  if (isArray(value)) return "配列";
  return typeof value;
}

/**
 * 突き合わせ表の target・component・rows を検査し、行の配列を返す。
 * @param {{ comparison: unknown, target: string, slug: unknown, findings: Record<string, unknown>[] }} arg
 * @returns {unknown[]}
 */
export function readComparisonRows({ comparison, target, slug, findings }) {
  // オブジェクトでない値は空の表として読む。どの欄も undefined になるので、直後の target の照合で不一致として報告する。
  // target を書き忘れた表と見分けられるよう、オブジェクトでないときは値の型を書く。
  const isTable = isPlainObject(comparison);
  /** @type {Record<string, unknown>} */
  const table = isTable ? comparison : {};
  if (table.target !== target) {
    findings.push({
      code: "comparison-target-mismatch",
      detail: isTable
        ? `突き合わせ表の target が ${JSON.stringify(table.target)}（判定対象は ${JSON.stringify(target)}）`
        : `突き合わせ表がオブジェクトでない（${valueKind(comparison)}）`,
    });
  }
  if (table.component !== slug) {
    findings.push({
      code: "comparison-component-mismatch",
      detail: isTable
        ? `突き合わせ表の component が ${JSON.stringify(table.component)}（採取は ${JSON.stringify(slug)}）`
        : `突き合わせ表がオブジェクトでない（${valueKind(comparison)}）`,
    });
  }
  if (!isArray(table.rows)) {
    findings.push({ code: "comparison-rows-invalid", detail: "rows が配列でない" });
    return [];
  }
  return table.rows;
}

/**
 * 比べないことを選んだ行（disposition あり）を検査し、件数を数える。語彙と承認を確かめる。
 * behavior-compare と motion-compare が使う。指摘の code の接頭辞（prefix）と、指摘に付ける位置（where）だけが違う。
 * @param {{
 *   row: unknown,
 *   disposition: unknown,
 *   prefix: "behavior" | "motion",
 *   where: Record<string, unknown>,
 *   ctx: { findings: Record<string, unknown>[], counts: { uncompared: number, accepted: number } },
 * }} arg
 */
export function judgeDisposition({ row, disposition, prefix, where, ctx }) {
  const { findings, counts } = ctx;
  // DISPOSITIONS は文字列だけなので、typeof は型を絞るためだけにある（判定は変わらない）。
  if (typeof disposition !== "string" || !DISPOSITIONS.includes(disposition)) {
    findings.push({
      code: `${prefix}-disposition-invalid`,
      ...where,
      detail: `disposition は null か ${DISPOSITIONS.join(" / ")}: ${JSON.stringify(disposition)}`,
    });
    counts.uncompared += 1;
    return;
  }
  if (
    !filled(field(row, "reason")) ||
    !filled(field(row, "approved_by")) ||
    !isoDateTime(field(row, "approved_at"))
  ) {
    findings.push({
      code: `${prefix}-acceptance-unapproved`,
      ...where,
      detail:
        "accepted には記入済みの reason / approved_by と ISO 8601 の approved_at が要る（テンプレートのプレースホルダは承認ではない）",
    });
    counts.uncompared += 1;
    return;
  }
  counts.accepted += 1;
}

/** behavior-compare と motion-compare が受け付ける引数。どれも必須。 */
const COMPARE_ARGS = ["--baseline", "--comparison", "--target"];

/**
 * 突き合わせ表を読む。無い・読めないのは「まだ突き合わせていない」と区別できないので、null を返して未突合として数える。
 * @param {(path: string) => string} readFile
 * @param {string} path
 * @returns {unknown}
 */
function readComparison(readFile, path) {
  try {
    return JSON.parse(readFile(path));
  } catch {
    return null;
  }
}

/**
 * behavior-compare と motion-compare の CLI 本体。読む採取物の名前（fileName）と判定（judge）だけが違う。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} io
 * @param {{ tool: string, version: string, usage: string, fileName: string, judge: (input: { metadata: unknown, byInstance: Record<string, unknown>, comparison: unknown, target: string }) => { structural: boolean, judged: boolean, findings: unknown[], counts: Record<string, number> } }} spec
 * @returns {number} 終了コード
 */
export function runCompareCli(argv, io, spec) {
  const { readFile, cwd, write, writeErr } = cliIo(io);
  // 引数・入力の誤りは判定結果ではないので stdout の JSON に混ぜず stderr へ知らせる（同梱スクリプト共通の CLI 規約）。
  const fail = usageFailer(writeErr, spec.usage);
  const parsed = parseFlagPairs(argv, COMPARE_ARGS);
  if (parsed.error !== undefined) return fail(parsed.error);
  const { args } = parsed;
  for (const key of COMPARE_ARGS) {
    // 空白だけの値を通さない。`--target " "` を受けると target の照合が別環境の記録を通す。
    if (!nonEmptyString(args[key])) return fail(`${key} は必須（空白だけの値も不可）`);
  }
  let loaded;
  try {
    loaded = loadBaseline(resolve(cwd, args["--baseline"]), spec.fileName);
  } catch (error) {
    return fail(`採取物を読めない: ${String(field(error, "message"))}`);
  }
  const result = spec.judge({
    metadata: loaded.metadata,
    byInstance: loaded.byInstance,
    comparison: readComparison(readFile, resolve(cwd, args["--comparison"])),
    target: args["--target"],
  });
  return writeCheckResult(write, result, {
    tool: spec.tool,
    version: spec.version,
    fields: { judged: result.judged },
  });
}
