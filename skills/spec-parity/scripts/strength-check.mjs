// spec-parity suite の強度の確認（故障注入）の結果を判定し、metadata.json の strength に書く（suite の手順 6）。
//
// 何のためか: assertion を弱めたテストも、assertion の無いテストも通る。そのため、スイートが通ることは強さの証拠にならない。
// 現行に既知の故障（応答の書き換え・DOM の書き換え）を注入し、スイートの assertion が赤くなることを確かめる。
// 注入しない対照のテストが通ることも確かめる。対照が赤ければ、注入のテストが赤いのは注入のせいだと言えない。
//
// 期待する集合は、e2e の結果からではなく、強度の計画（strength-plan.json）の宣言から作る。
// 計画に挙げたテストが結果に無いときは、赤くなったとも緑だったとも数えない（未実行として合格にしない）。
// 赤くなったと数えるのは、最後の試行のエラーの code が ASSERTION_FAILED のときだけである。
// serial group のメンバーの試行は、results[].attempts ではなく run.serialGroups の記録から読む。
// 実行が止まった（timed-out・interrupted）・操作が失敗した・注入が届かなかった（テストが PARITY_INJECTION_NOT_APPLIED を含む
// エラーを投げた）ときは、検出として扱わない。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 対照がすべて通り、故障がすべて assertion で赤くなった、1 ＝ そうでない故障か対照がある、
// 2 ＝ 使い方の誤り・読めない入力・形の誤り（判定していない）。

import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags, stripDashes } from "./lib/flags.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
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

/** 強度の計画の形式のバージョン。雛形 assets/strength-plan-template.json と同じ値にする。 */
export const PLAN_VERSION = "1";

/** 注入が描画まで届かなかったことを、テストが投げるエラーの本文で示す印。 */
export const NOT_APPLIED_MARK = "PARITY_INJECTION_NOT_APPLIED";

/**
 * @typedef {{ id: string, class: string, test: string, observed: string }} Fault
 * @typedef {{ slug: string, controls: string[], faults: Fault[] }} Plan
 * @typedef {{ status: string, code: string | null, message: string }} Outcome
 */

/**
 * 計画の 1 件の故障を読む。
 * @param {unknown} f
 * @param {number} i
 * @returns {Fault}
 */
function readFault(f, i) {
  const where = `faults[${i}]`;
  if (!isPlainObject(f)) throw new UsageError(`${where} がオブジェクトでない`);
  for (const k of ["id", "class", "test", "observed"]) {
    if (!nonEmptyString(f[k]))
      throw new UsageError(
        k === "observed"
          ? `${where} の observed が無い（注入が描画まで届いたと言い切れる観測を書く）`
          : `${where} の ${k} が無い`,
      );
  }
  return {
    id: String(f.id),
    class: String(f.class),
    test: String(f.test),
    observed: String(f.observed),
  };
}

/**
 * 強度の計画を読む。
 * @param {unknown} doc
 * @returns {Plan}
 */
export function readPlan(doc) {
  if (!isPlainObject(doc)) throw new UsageError("強度の計画がオブジェクトでない");
  if (doc.version !== PLAN_VERSION)
    throw new UsageError(`強度の計画の version が ${PLAN_VERSION} でない`);
  if (!nonEmptyString(doc.slug)) throw new UsageError("強度の計画に slug が無い");
  if (!isArray(doc.controls) || doc.controls.length === 0 || !doc.controls.every(nonEmptyString))
    throw new UsageError(
      "強度の計画の controls が空か、テストの名前の配列でない（注入しない対照を 1 件以上置く）",
    );
  if (!isArray(doc.faults) || doc.faults.length === 0)
    throw new UsageError("強度の計画の faults が空か配列でない");
  const faults = doc.faults.map(readFault);
  const names = [...doc.controls.map(String), ...faults.map((f) => f.test)];
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup !== undefined) throw new UsageError(`強度の計画に同じテストが 2 回ある: ${dup}`);
  const ids = faults.map((f) => f.id);
  const dupId = ids.find((n, i) => ids.indexOf(n) !== i);
  if (dupId !== undefined)
    throw new UsageError(`強度の計画の faults の id が重複している: ${dupId}`);
  return { slug: doc.slug, controls: doc.controls.map(String), faults };
}

/**
 * serial group（`describe(..., { serial: true })`）のメンバーの試行を、group の id → testId → 最後の記録にする。
 * e2e は、メンバーの試行を results[].attempts ではなく run.serialGroups[].attempts[].members[] に書く。
 * results[].attempts は空になる（e2e 0.23.0 で確かめた）。リトライがメンバーに届かなかったときは、
 * そのメンバーを実行した最後の試行の記録が残る（https://e2e.com/docs/reference/test#serial）。
 * @param {unknown} groups
 * @returns {Map<string, Map<string, Record<string, unknown>>>}
 */
function readSerialMembers(groups) {
  /** @type {Map<string, Map<string, Record<string, unknown>>>} */
  const byGroup = new Map();
  if (groups === undefined) return byGroup;
  if (!isArray(groups)) throw new UsageError("強度の実行の結果の run.serialGroups が配列でない");
  for (const [i, g] of groups.entries()) {
    if (!isPlainObject(g) || !nonEmptyString(g.id) || !isArray(g.attempts))
      throw new UsageError(`serialGroups[${i}] に id か attempts が無い`);
    if (byGroup.has(g.id)) throw new UsageError(`serialGroups の id が重複している: ${g.id}`);
    byGroup.set(g.id, readGroupMembers(g.attempts, i));
  }
  return byGroup;
}

/**
 * serial group の 1 件の試行を、testId → 最後の記録にする。後の試行の記録が前の記録を上書きする。
 * @param {unknown[]} attempts
 * @param {number} i serialGroups の中の位置（エラーの文言に使う）
 * @returns {Map<string, Record<string, unknown>>}
 */
function readGroupMembers(attempts, i) {
  /** @type {Map<string, Record<string, unknown>>} */
  const members = new Map();
  for (const a of attempts) {
    if (!isPlainObject(a) || !isArray(a.members))
      throw new UsageError(`serialGroups[${i}] の attempts に members が無い`);
    for (const m of a.members) {
      if (!isPlainObject(m) || !nonEmptyString(m.testId))
        throw new UsageError(`serialGroups[${i}] の members に testId が無い`);
      members.set(m.testId, m);
    }
  }
  return members;
}

/**
 * serial group のメンバーの最後の記録を取り出す。
 * @param {Record<string, unknown>} r
 * @param {Map<string, Map<string, Record<string, unknown>>>} serial
 * @param {number} i
 * @returns {Record<string, unknown> | null}
 */
function serialMember(r, serial, i) {
  if (!nonEmptyString(r.serialGroupId) || !nonEmptyString(r.testId))
    throw new UsageError(`results[${i}] の serialGroupId か testId が文字列でない`);
  const members = serial.get(r.serialGroupId);
  if (!members)
    throw new UsageError(
      `results[${i}] の serialGroupId が serialGroups に無い: ${r.serialGroupId}`,
    );
  // メンバーの記録が無いのは、group の試行がメンバーに届かなかったとき（エラーが無いので検出にならない）
  return members.get(r.testId) ?? null;
}

/**
 * serial group に属さないテストの、最後の試行を取り出す。
 * @param {Record<string, unknown>} r
 * @returns {unknown}
 */
function lastAttempt(r) {
  const attempts = isArray(r.attempts) ? r.attempts : [];
  const last = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  return last;
}

/**
 * e2e の結果の 1 件から、最後の試行の状態とエラーを取り出す。
 * serial group のメンバーは、group の試行の記録から取り出す。
 * @param {Record<string, unknown>} r
 * @param {Map<string, Map<string, Record<string, unknown>>>} serial
 * @param {number} i
 * @returns {Outcome}
 */
function outcomeOf(r, serial, i) {
  const last = r.serialGroupId !== undefined ? serialMember(r, serial, i) : lastAttempt(r);
  const error = isPlainObject(last) && isPlainObject(last.error) ? last.error : null;
  return {
    status: String(r.status),
    code: error && nonEmptyString(error.code) ? error.code : null,
    message: error && typeof error.message === "string" ? error.message : "",
  };
}

/**
 * e2e の結果から、現行（target current）で選ばれたテストを、名前 → 結果にする。
 * @param {unknown} report
 * @returns {Map<string, Outcome>}
 */
export function readStrengthReport(report) {
  if (!isPlainObject(report) || report.schemaVersion !== "report-1")
    throw new UsageError("強度の実行の結果が e2e の結果（schemaVersion: report-1）でない");
  const run = report.run;
  if (!isPlainObject(run) || !isArray(run.results))
    throw new UsageError("強度の実行の結果に run.results が無い");
  const serial = readSerialMembers(run.serialGroups);
  /** @type {Map<string, Outcome>} */
  const out = new Map();
  for (const [i, r] of run.results.entries()) {
    if (!isPlainObject(r)) throw new UsageError(`results[${i}] がオブジェクトでない`);
    if (r.targetId !== "current" || r.selected !== true) continue;
    if (!nonEmptyString(r.file) || !isArray(r.titlePath))
      throw new UsageError(`results[${i}] に file か titlePath が無い`);
    const name = [r.file, ...r.titlePath.map(String)].join(" › ");
    if (out.has(name))
      throw new UsageError(
        `同じテストの結果が 2 つある（repeat や agent を外して実行する）: ${name}`,
      );
    out.set(name, outcomeOf(r, serial, i));
  }
  return out;
}

/**
 * 故障の結果を分ける。
 * @param {Outcome | undefined} o
 * @returns {"red" | "not-run" | "green" | "not-applied" | "stopped"}
 */
export function faultVerdict(o) {
  if (!o) return "not-run";
  if (o.status === "passed" || o.status === "flaky") return "green";
  if (o.message.includes(NOT_APPLIED_MARK)) return "not-applied";
  if (o.status === "failed" && o.code === "ASSERTION_FAILED") return "red";
  return "stopped";
}

/**
 * 計画と結果を突き合わせる。
 * @param {Plan} plan
 * @param {Map<string, Outcome>} results
 */
export function judgeStrength(plan, results) {
  const controls = plan.controls.map((test) => {
    const o = results.get(test);
    return { test, status: o ? o.status : "not-run", ok: o?.status === "passed" };
  });
  const faults = plan.faults.map((f) => {
    const verdict = faultVerdict(results.get(f.test));
    return { ...f, verdict, code: results.get(f.test)?.code ?? null };
  });
  const red = faults.filter((f) => f.verdict === "red").length;
  const controlsOk = controls.every((c) => c.ok);
  return {
    tool: "strength-check",
    version: VERSION,
    judged: true,
    validated: controlsOk && red === faults.length,
    counts: {
      controls: controls.length,
      controls_green: controls.filter((c) => c.ok).length,
      faults: faults.length,
      red,
    },
    classes: [...new Set(faults.filter((f) => f.verdict === "red").map((f) => f.class))].sort(),
    controls,
    faults,
  };
}

const USAGE =
  "usage: strength-check.mjs --plan <strength-plan.json> --report <strength-report.json> [--write <metadata.json>]";

/**
 * 書き込み先の metadata.json を読み、計画と同じ slug かを確かめる。
 * @param {string} path
 * @param {string} slug
 * @param {import("./lib/read-json.mjs").JudgeIo} io
 * @returns {Record<string, unknown>}
 */
function readMetadataForWrite(path, slug, io) {
  const doc = readJsonFile(path, io);
  if (!isPlainObject(doc) || doc.slug !== slug)
    throw new UsageError(`metadata.json の slug が強度の計画の slug（${slug}）と違う`);
  return doc;
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {Partial<import("./lib/read-json.mjs").JudgeIo>} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = judgeIo(deps);
  return runJudge({ io, usage: USAGE }, () => {
    const parsed = parseFlags(argv, { values: ["--plan", "--report", "--write"] });
    if (parsed.error !== undefined) throw new UsageError(parsed.error);
    const opts = stripDashes(parsed.strings);
    if (!nonEmptyString(opts.plan) || !nonEmptyString(opts.report))
      throw new UsageError("--plan と --report が要る");
    const plan = readPlan(readJsonFile(opts.plan, io));
    const metadata = opts.write ? readMetadataForWrite(opts.write, plan.slug, io) : null;
    const result = {
      ...judgeStrength(plan, readStrengthReport(readJsonFile(opts.report, io))),
      plan: opts.plan,
      report: opts.report,
    };
    io.stdout(jsonText(result));
    if (metadata && opts.write) writeJsonFile(io, opts.write, { ...metadata, strength: result });
    if (result.validated) return 0;
    const bad = [
      ...result.controls
        .filter((c) => !c.ok)
        .map((c) => `対照が通らない: ${c.test}（${c.status}）`),
      ...result.faults
        .filter((f) => f.verdict !== "red")
        .map((f) => `${f.id} が ${f.verdict}: ${f.test}`),
    ];
    io.stderr(`error: 強度の確認が通らない。${bad.join(" / ")}\n`);
    return 1;
  });
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
