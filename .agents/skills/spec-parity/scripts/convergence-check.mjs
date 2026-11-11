// spec-parity verify の収束を判定する（手順 7）。結果は verify-metadata.json の converged と convergence に書く。
//
// 何のためか: style_policy が free のリプレイスでは、現行と新側の画面を比べないので、「差分が 0 件」という終わり方が無い。
// 代わりに、次の 7 つがそろったときだけ収束とする。どれもツールの出力か利用者の承認の記録で決め、モデルの主観を根拠にしない。
//   1. スイート: 現行で通ったテスト（suite が保存した e2e の結果）が、新側の結果ですべて passed である
//   2. 横のはみ出し: overflow-check.mjs の判定を、測定の記録から計算し直して通る
//   3. 操作中のエラー: runtime-errors.mjs compare の結果を、分類から判定し直して通る（現側が記録しなかった機能は未検証に挙げる）
//   4. デザインの点検: 指摘がすべて「受け入れる」で、利用者の承認がある（「直す」が残れば差し戻す）
//   5. 人による確認: 利用者が新側の画面を承認した記録がある（却下なら差し戻す）
//   6. 判断待ち: 未解決の保留（pending_decisions）が無い
//   7. 未測定: metadata.json の unmeasured に blocking（承認の無い accepted を含む）が残っていない（parity-diff の収束の判定と同じ扱い）
// あわせて、未検証の一覧（unverified）に、spec-parity が確かめない性能（performance）が理由付きで載っていることを確かめる。
// 1・2・4・5 の記録は、verify-metadata.json の new.commit と同じバージョンのものでなければ、古い記録として数える。
// 前提として、verify-metadata.json の new.commit が none（新側が git で管理されていない）でないことを確かめる。none では、どの記録のバージョンも特定できない。
// verify-metadata.json の new.dirty も false であることを確かめる。commit していない変更を含む新側で採った記録は、new.commit のバージョンの記録と言えない。
// parity-replace が新側を green にした記録（replace-metadata.json）も、dirty: false であることを確かめる。
// あわせて、記録の slug・new.target・new.commit が、metadata.json の slug・--target・verify-metadata.json の new.commit と同じことを確かめる。
// 前提の強度の確認も、metadata.json の strength.validated を信じず、strength-plan.json と strength-report.json から判定し直す。
//
// 保存された ok や件数は信じず、元の記録から判定し直す（手で書き換えた記録で収束させない）。
// 判定できない入力（前提の成果物が無い・形の誤り・結果が 0 件）は合格にせず exit 2 にする。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 収束、1 ＝ 収束していない（理由は reasons。category が send-back なら parity-replace へ差し戻す）、
// 2 ＝ 使い方の誤り・前提の欠落・読めない入力（判定していない）。

import { basename, join, resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags, stripDashes } from "./lib/flags.mjs";
import { isPlaceholder, isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import {
  UsageError,
  judgeIo,
  jsonText,
  readJsonFile,
  runJudge,
  writeJsonFile,
} from "./lib/read-json.mjs";
import { judgeOverflow, readDeclaration, readMeasurements } from "./overflow-check.mjs";
import { judgeStrength, readPlan, readStrengthReport } from "./strength-check.mjs";
import { VERSION as RUNTIME_ERRORS_VERSION, judgeClassification } from "./runtime-errors.mjs";

/** ツールのバージョン。判定規則と出力の形を変えたら上げる。 */
export const VERSION = "1";

/** e2e の結果の JSON の形式。e2e が形を変えると schemaVersion が変わる。 */
const REPORT_SCHEMA = "report-1";

/** 未検証の一覧に必ず載せる項目。性能は、比較の採取が Playwright を前提にしているので spec-parity では確かめない。 */
const ALWAYS_UNVERIFIED = ["performance"];

/**
 * 収束しない理由。category は次の 3 つである。
 *   send-back … 新側の実装に要対応が残る。parity-replace へ差し戻す
 *   remeasure … 記録が無い・古い・欠ける。verify の該当する手順をやり直す
 *   approval  … 利用者の承認・判断を待っている
 * @typedef {{ category: "send-back" | "remeasure" | "approval", check: string, message: string }} Reason
 */

/**
 * 収束しない理由を集める入れ物。
 * @typedef {{ list: Reason[], add: (category: Reason["category"], check: string, message: string) => void }} Reasons
 */

/** @returns {Reasons} */
function makeReasons() {
  /** @type {Reason[]} */
  const list = [];
  return { list, add: (category, check, message) => void list.push({ category, check, message }) };
}

/** @param {string} a @param {string} b */
function byText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * metadata.json（suite の成果物）が、spec-parity の feature の成果物で、suite が終わっていることを確かめる。
 * @param {unknown} metadata
 * @param {string} slugDir
 * @returns {Record<string, unknown>}
 */
export function checkSuiteMetadata(metadata, slugDir) {
  const decl = readDeclaration(metadata);
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  const m = metadata;
  if (basename(resolve(slugDir)) !== decl.slug)
    throw new UsageError(
      `metadata.json の slug（${decl.slug}）が、ディレクトリの名前と違う: ${slugDir}`,
    );
  const suite = isPlainObject(m.suite) ? m.suite : {};
  const strength = isPlainObject(m.strength) ? m.strength : {};
  /** @type {[boolean, string][]} */
  const checks = [
    [
      m.mode !== "feature",
      `mode が feature でない（${String(m.mode)}。横断 API とバッチは parity-suite と parity-diff が扱う）`,
    ],
    [suite.runner !== "e2e", `suite.runner が e2e でない（${String(suite.runner)}）`],
    [
      suite.current_green !== true,
      "suite.current_green が true でない（spec-parity suite を終えてから verify する）",
    ],
    [
      strength.validated !== true,
      "strength.validated が true でない（故障注入を通してから verify する）",
    ],
  ];
  const failed = checks.find(([bad]) => bad);
  if (failed) throw new UsageError(`metadata.json の ${failed[1]}`);
  const re = m.runtime_errors;
  if (
    !isPlainObject(re) ||
    (re.declared !== true && !(re.declared === false && nonEmptyString(re.reason)))
  )
    throw new UsageError(
      "metadata.json の runtime_errors が、declared: true か、declared: false と reason の組でない",
    );
  return m;
}

/**
 * e2e の結果の JSON から、指定した target で選ばれたテストを、テストの鍵 → 状態の一覧にする。
 * @param {unknown} report
 * @param {string} targetId - e2e の設定の target 名（current / new）
 * @param {string} where
 * @returns {Map<string, string[]>}
 */
export function readReport(report, targetId, where) {
  if (!isPlainObject(report) || report.schemaVersion !== REPORT_SCHEMA)
    throw new UsageError(`${where} が e2e の結果（schemaVersion: ${REPORT_SCHEMA}）でない`);
  const run = report.run;
  if (!isPlainObject(run) || !isArray(run.results))
    throw new UsageError(`${where} に run.results が無い`);
  /** @type {Map<string, string[]>} */
  const tests = new Map();
  for (const [i, r] of run.results.entries()) {
    if (!isPlainObject(r)) throw new UsageError(`${where} の results[${i}] がオブジェクトでない`);
    if (r.targetId !== targetId || r.selected !== true) continue;
    if (!nonEmptyString(r.file) || !isArray(r.titlePath) || !nonEmptyString(r.status))
      throw new UsageError(`${where} の results[${i}] に file・titlePath・status が無い`);
    const key = [r.file, ...r.titlePath.map(String)].join(" › ");
    tests.set(key, [...(tests.get(key) ?? []), r.status]);
  }
  if (tests.size === 0)
    throw new UsageError(
      `${where} に、target ${targetId} で選ばれたテストが 0 件（0 件を合格にしない）`,
    );
  return tests;
}

/**
 * 現行で通ったテストが、新側ですべて passed かを判定する。
 * flaky（リトライで通った）は、新側が安定して通ったとは言えないので passed として扱わない。
 * @param {Map<string, string[]>} current
 * @param {Map<string, string[]>} next
 * @param {Reasons} reasons
 */
export function judgeSuite(current, next, reasons) {
  const currentSkipped = [];
  for (const [test, statuses] of current) {
    if (statuses.every((s) => s === "skipped")) {
      currentSkipped.push(test);
      continue;
    }
    if (!statuses.every((s) => s === "passed"))
      throw new UsageError(
        `現行の結果で通っていないテスト: ${test}（${statuses.join(", ")}。suite をやり直す）`,
      );
    const n = next.get(test);
    if (!n) reasons.add("remeasure", "suite", `新側の結果に無いテスト: ${test}`);
    else if (!n.every((s) => s === "passed"))
      reasons.add("send-back", "suite", `新側で通らないテスト: ${test}（${n.join(", ")}）`);
  }
  // 現行のテストがすべてスキップなら、比べたテストが 0 件のまま収束してしまう（0 件を合格にしない）
  if (currentSkipped.length === current.size)
    throw new UsageError(
      "現行の結果のテストがすべてスキップで、比べるテストが 0 件（suite をやり直す）",
    );
  for (const test of next.keys()) {
    if (!current.has(test))
      reasons.add(
        "remeasure",
        "suite",
        `現行の結果に無いテスト: ${test}（スイートが変わったので suite を現行でやり直す）`,
      );
  }
  return { tests: current.size, current_skipped: currentSkipped.sort(byText) };
}

/**
 * 記録が、verify-metadata.json の new.commit と同じバージョンのものかを確かめる。
 * @param {Reasons} reasons
 * @param {string} check
 * @param {{ actual: unknown, expected: string }} pair
 */
function sameCommit(reasons, check, { actual: commit, expected }) {
  if (commit === expected) return true;
  reasons.add(
    "remeasure",
    check,
    `記録のバージョン（${String(commit)}）が new.commit（${expected}）と違う`,
  );
  return false;
}

/**
 * compare の結果が、同梱の runtime-errors.mjs の同じバージョンが書いたものかを確かめる。
 * @param {Record<string, unknown>} compared
 */
function checkCompared(compared) {
  if (
    compared.tool !== "runtime-errors" ||
    compared.version !== RUNTIME_ERRORS_VERSION ||
    compared.judged !== true
  )
    throw new UsageError(
      `verify-metadata.json の runtime_errors が runtime-errors.mjs ${RUNTIME_ERRORS_VERSION} の compare の結果でない`,
    );
}

/**
 * 現行に無かった署名を、分類から判定し直す。
 * @param {unknown[]} sigs
 * @param {Reasons} reasons
 */
function judgeSignatures(sigs, reasons) {
  for (const s of sigs) {
    const state = judgeClassification(isPlainObject(s) ? s : undefined).state;
    const name = isPlainObject(s)
      ? `${String(s.test)} の ${String(s.kind)}「${String(s.text)}」`
      : "読めない署名";
    if (state === "actionable")
      reasons.add("send-back", "runtime_errors", `要対応のエラー: ${name}`);
    else if (state === "unexplained")
      reasons.add("approval", "runtime_errors", `分類か承認の無い、現行に無かったエラー: ${name}`);
  }
}

/**
 * compare が挙げたテストの一覧（記録の欠け・通らなかった・基準に無い・新側でスキップした）を理由にする。
 * 新側でスキップしたテストは、そのテストのエラーを比べていないので、記録の欠けと同じく採り直す。
 * @param {Record<string, unknown>} compared
 * @param {Reasons} reasons
 */
function judgeCompareLists(compared, reasons) {
  for (const [key, category] of /** @type {const} */ ([
    ["missing_tests", "remeasure"],
    ["failed_tests", "send-back"],
    ["extra_tests", "remeasure"],
    ["skipped_tests", "remeasure"],
  ])) {
    const list = compared[key];
    if (!isArray(list))
      throw new UsageError(`verify-metadata.json の runtime_errors.${key} が配列でない`);
    for (const t of list) reasons.add(category, "runtime_errors", `${key}: ${String(t)}`);
  }
}

/**
 * 操作中のエラーの比較の結果を、分類から判定し直す。
 * @param {Record<string, unknown>} baseline - metadata.json の runtime_errors
 * @param {unknown} compared - verify-metadata.json の runtime_errors（compare --write が書いたもの）
 * @param {Reasons} reasons
 */
export function judgeRuntimeErrors(baseline, compared, reasons) {
  if (baseline.declared !== true) return { judged: false, reason: String(baseline.reason) };
  if (!isPlainObject(compared)) {
    reasons.add(
      "remeasure",
      "runtime_errors",
      "比較の結果が無い（runtime-errors.mjs compare --write を通す）",
    );
    return { judged: false };
  }
  checkCompared(compared);
  const sigs = compared.new_signatures;
  if (!isArray(sigs))
    throw new UsageError("verify-metadata.json の runtime_errors.new_signatures が配列でない");
  judgeSignatures(sigs, reasons);
  judgeCompareLists(compared, reasons);
  return { judged: true, new_signatures: sigs.length };
}

/**
 * 値が書いてあるか。雛形のプレースホルダ（`<...>`）のままの値は、書いていないものとして扱う。
 * @param {unknown} v
 * @returns {v is string}
 */
function filled(v) {
  return nonEmptyString(v) && !isPlaceholder(v);
}

/**
 * 承認の記録（承認した人・日時）が埋まっているか。
 * @param {unknown} a
 * @returns {boolean}
 */
function hasApproval(a) {
  return isPlainObject(a) && filled(a.approved_by) && filled(a.approved_at);
}

/**
 * デザインの点検の記録の形を確かめる。
 * @param {Record<string, unknown>} review
 * @returns {unknown[]}
 */
function reviewFindings(review) {
  if (review.source !== "web-design-guidelines" && review.source !== "bundled")
    throw new UsageError(
      `design_review.source が web-design-guidelines か bundled でない（${String(review.source)}）`,
    );
  if (!isArray(review.pages_reviewed) || review.pages_reviewed.length === 0)
    throw new UsageError("design_review.pages_reviewed が空か配列でない（点検したページを書く）");
  if (!isArray(review.findings)) throw new UsageError("design_review.findings が配列でない");
  return review.findings;
}

/**
 * デザインの指摘 1 件を判定する。
 * @param {Record<string, unknown> & { id: string }} f
 * @param {Reasons} reasons
 */
function judgeFinding(f, reasons) {
  const approval = isPlainObject(f.approval) ? f.approval : null;
  if (f.decision === "fix") reasons.add("send-back", "design_review", `直す指摘: ${f.id}`);
  else if (f.decision !== "accept")
    reasons.add("approval", "design_review", `「直す」か「受け入れる」に分けていない指摘: ${f.id}`);
  else if (!hasApproval(approval) || !filled(approval?.reason))
    reasons.add(
      "approval",
      "design_review",
      `受け入れる承認（承認した人・日時・理由）が無い指摘: ${f.id}`,
    );
}

/**
 * デザインの点検の記録を判定する。
 * @param {unknown} review
 * @param {string} commit
 * @param {Reasons} reasons
 */
export function judgeDesignReview(review, commit, reasons) {
  if (!isPlainObject(review) || !filled(review.completed_at)) {
    reasons.add("remeasure", "design_review", "デザインの点検の記録が無い（completed_at が無い）");
    return { judged: false };
  }
  const findings = reviewFindings(review);
  sameCommit(reasons, "design_review", { actual: review.commit, expected: commit });
  const ids = new Set();
  for (const [i, f] of findings.entries()) {
    if (!isPlainObject(f) || !nonEmptyString(f.id))
      throw new UsageError(`design_review.findings[${i}] に id が無い`);
    if (ids.has(f.id)) throw new UsageError(`design_review.findings の id が重複している: ${f.id}`);
    ids.add(f.id);
    judgeFinding({ ...f, id: f.id }, reasons);
  }
  return { judged: true, source: review.source, findings: findings.length };
}

/**
 * 人による確認の記録を判定する。
 * @param {unknown} review
 * @param {string} commit
 * @param {Reasons} reasons
 */
export function judgeHumanReview(review, commit, reasons) {
  if (!isPlainObject(review) || !isArray(review.screens) || review.screens.length === 0) {
    reasons.add("remeasure", "human_review", "人に見せた画面の記録（screens）が無い");
    return { judged: false };
  }
  sameCommit(reasons, "human_review", { actual: review.commit, expected: commit });
  const a = isPlainObject(review.approval) ? review.approval : null;
  if (a && a.verdict === "rejected" && hasApproval(a))
    reasons.add(
      "send-back",
      "human_review",
      `利用者が新側の画面を承認しなかった: ${typeof a.notes === "string" ? a.notes : ""}`,
    );
  else if (!a || a.verdict !== "approved" || !hasApproval(a))
    reasons.add(
      "approval",
      "human_review",
      "新側の画面を利用者が承認した記録（verdict: approved・承認した人・日時）が無い",
    );
  return { judged: true, screens: review.screens.length };
}

/**
 * 未検証の一覧に、必ず載せる項目が理由付きで載っているかを判定する。
 * @param {unknown} list
 * @param {string[]} required
 * @param {Reasons} reasons
 */
export function judgeUnverified(list, required, reasons) {
  if (!isArray(list)) throw new UsageError("verify-metadata.json の unverified が配列でない");
  const items = new Set();
  for (const [i, u] of list.entries()) {
    if (!isPlainObject(u) || !nonEmptyString(u.item) || !nonEmptyString(u.reason))
      throw new UsageError(`unverified[${i}] に item か reason が無い`);
    items.add(u.item);
  }
  for (const item of required) {
    if (!items.has(item))
      reasons.add(
        "remeasure",
        "unverified",
        `未検証の一覧に ${item} が無い（確かめていないことを理由と一緒に書く）`,
      );
  }
  return { items: [...items].sort(byText) };
}

/**
 * 保留が解決済み（replace-strategy の references/autonomy.md「保留の状態」の settled）かを判定する。
 * @param {unknown} p
 * @returns {boolean}
 */
export function isSettled(p) {
  if (!isPlainObject(p) || !isPlainObject(p.resolution)) return false;
  const r = p.resolution;
  if (!filled(r.answer) || !filled(r.answered_at)) return false;
  if (isArray(p.blocks) && p.blocks.length === 0) return true;
  const resumed = r.resumed;
  const followUp = r.follow_up;
  const resumedOk =
    isPlainObject(resumed) &&
    nonEmptyString(resumed.at) &&
    isArray(resumed.evidence) &&
    resumed.evidence.some(nonEmptyString);
  const followOk =
    isPlainObject(followUp) && nonEmptyString(followUp.what) && nonEmptyString(followUp.tracked_in);
  return resumedOk || followOk;
}

/**
 * 未解決の保留を数える。
 * @param {unknown} list
 * @param {Reasons} reasons
 */
export function judgePending(list, reasons) {
  if (!isArray(list))
    throw new UsageError(
      "verify-metadata.json の pending_decisions が配列でない（保留が無ければ [] を書く）",
    );
  const open = list.filter((p) => !isSettled(p));
  for (const p of open)
    reasons.add(
      "approval",
      "pending_decisions",
      `未解決の保留: ${isPlainObject(p) ? String(p.id) : "読めない要素"}`,
    );
  return { open: open.length };
}

/** 未測定の宣言の disposition の語彙。語彙の外の値は blocking として数える。 */
const UNMEASURED_DISPOSITIONS = ["blocking", "accepted"];

/**
 * 未測定の宣言 1 件を判定する。blocking（語彙の外・承認の記録が空の accepted を含む）は収束を止める。
 * @param {unknown} entry
 * @param {{ index: number, seen: Set<string> }} ctx - seen は既に読んだ item（重複の検出に使い、この関数が足す）
 * @param {Reasons} reasons
 * @returns {boolean} blocking として数えたか
 */
function judgeUnmeasuredEntry(entry, { index, seen }, reasons) {
  if (!isPlainObject(entry))
    throw new UsageError(`metadata.json の unmeasured.entries[${index}] がオブジェクトでない`);
  const item = nonEmptyString(entry.item) ? String(entry.item).trim() : null;
  /** @param {string} message */
  const invalid = (message) => {
    reasons.add("remeasure", "unmeasured", message);
    return true;
  };
  if (item === null) return invalid(`未測定の宣言 ${index} 件目の item が空（照合キーが無い）`);
  if (seen.has(item)) return invalid(`未測定の項目が重複している: ${item}`);
  seen.add(item);
  if (!nonEmptyString(entry.reason)) return invalid(`未測定の理由が空: ${item}`);
  const disposition = entry.disposition;
  if (typeof disposition !== "string" || !UNMEASURED_DISPOSITIONS.includes(disposition)) {
    return invalid(`未測定の disposition が blocking か accepted でない: ${item}`);
  }
  if (disposition === "blocking") {
    reasons.add("remeasure", "unmeasured", `未測定が残っている（disposition: blocking）: ${item}`);
    return true;
  }
  if (!filled(entry.approved_by) || !filled(entry.approved_at)) {
    reasons.add(
      "approval",
      "unmeasured",
      `accepted なのに承認した人・日時が無い（blocking として数える）: ${item}`,
    );
    return true;
  }
  return false;
}

/**
 * 未測定の宣言（metadata.json の unmeasured）を判定する。parity-diff の収束の判定（artifact-health-check.mjs --stage diff）と同じ扱いにする。
 * キーごと無い成果物（宣言の導入前）と declared: false は判定せず、理由を残す。
 * @param {Record<string, unknown>} metadata
 * @param {Reasons} reasons
 */
export function judgeUnmeasured(metadata, reasons) {
  if (!("unmeasured" in metadata))
    return { judged: false, reason: "unmeasured をキーごと持たない成果物のため判定しない" };
  const decl = metadata.unmeasured;
  if (!isPlainObject(decl))
    throw new UsageError("metadata.json の unmeasured がオブジェクトでない");
  if (typeof decl.declared !== "boolean")
    throw new UsageError("metadata.json の unmeasured.declared が真偽値でない");
  if (!decl.declared) {
    if (!nonEmptyString(decl.reason))
      throw new UsageError("metadata.json の unmeasured.declared: false なのに reason が空");
    return { judged: false, reason: String(decl.reason).trim() };
  }
  if (!isArray(decl.entries))
    throw new UsageError("metadata.json の unmeasured.entries が配列でない");
  const seen = new Set();
  let blocking = 0;
  for (const [index, entry] of decl.entries.entries())
    if (judgeUnmeasuredEntry(entry, { index, seen }, reasons)) blocking += 1;
  return { judged: true, entries: decl.entries.length, blocking };
}

/**
 * parity-replace が、verify するバージョンの新側を green にした記録（replace-metadata.json）があることを確かめる。
 * 記録を識別する鍵（slug・new.target・new.commit）を、metadata.json の slug・--target・verify-metadata.json の new.commit と 1 つずつ厳密に比べる。
 * 欠落・型の誤り・別の値は、どれも一致しないものとして扱う。
 * 鍵が違えば、verify の手順をやり直しても replace-metadata.json は変わらないので、やり直しの理由にせず前提の欠落にする。
 * @param {unknown} rm
 * @param {{ slug: string, target: string, commit: string }} want - verify の slug・--target・verify-metadata.json の new.commit（none でない）
 */
function checkNewGreen(rm, want) {
  const hint = `parity-replace で、--target ${want.target} の verify するバージョンの新側を green にしてから verify する`;
  if (!isPlainObject(rm) || !isPlainObject(rm.suite) || rm.suite.new_green !== true)
    throw new UsageError(`replace-metadata.json の suite.new_green が true でない（${hint}）`);
  const n = isPlainObject(rm.new) ? rm.new : {};
  // 鍵を dirty より先に比べる。別の機能・target の記録なら、commit しても直らないので、鍵の違いを先に示す
  /** @type {[string, unknown, string, string][]} */
  const keys = [
    ["slug", rm.slug, want.slug, "metadata.json の slug"],
    ["new.target", n.target, want.target, "--target"],
    ["new.commit", n.commit, want.commit, "verify-metadata.json の new.commit"],
  ];
  const bad = keys.filter(([, got, expected]) => got !== expected);
  if (bad.length > 0)
    throw new UsageError(
      `replace-metadata.json の ${bad.map(([k, got, expected, from]) => `${k}（${JSON.stringify(got)}）が ${from}（${expected}）と違う`).join("、")}（${hint}）`,
    );
  if (n.dirty !== false)
    throw new UsageError(
      `replace-metadata.json の new.dirty が false でない（commit していない変更で green にした記録は、バージョンを特定できない。新側を commit してから、${hint}）`,
    );
}

/**
 * 強度の計画と結果から、強度の確認を判定し直す。metadata.json の strength.validated を手で true にしても通さない。
 * @param {{ plan: unknown, report: unknown }} strength
 * @param {string} slug
 */
function checkStrength({ plan, report }, slug) {
  const p = readPlan(plan);
  if (p.slug !== slug)
    throw new UsageError(`strength-plan.json の slug（${p.slug}）が ${slug} でない`);
  const judged = judgeStrength(p, readStrengthReport(report));
  if (!judged.validated)
    throw new UsageError(
      `strength-plan.json と strength-report.json から判定し直すと、強度の確認が通らない（対照 ${judged.counts.controls_green}/${judged.counts.controls}・赤 ${judged.counts.red}/${judged.counts.faults}。strength-check.mjs で直してから verify する）`,
    );
}

/**
 * verify-metadata.json が対象の slug と target のもので、確かめる新側のバージョン（new.commit）を持ち、new.dirty が false であることを確かめる。
 * @param {unknown} v
 * @param {{ slug: string, target: string }} key
 * @returns {{ v: Record<string, unknown>, commit: string }}
 */
function readVerifyHead(v, { slug, target }) {
  if (!isPlainObject(v) || v.slug !== slug || v.target !== target)
    throw new UsageError(`verify-metadata.json の slug と target が ${slug} / ${target} でない`);
  const head = isPlainObject(v.new) ? v.new : {};
  const commit = head.commit;
  if (!filled(commit))
    throw new UsageError("verify-metadata.json の new.commit が無い（雛形の値のままを含む）");
  // none は新側が git で管理されていないことを表し、どの記録のバージョンも特定できない（none どうしの比較は常に一致する）
  if (commit === "none")
    throw new UsageError(
      "verify-metadata.json の new.commit が none（新側を git で管理し、commit したバージョンで verify する）",
    );
  // replace-metadata.json の new.dirty と同じ扱い。commit していない変更を含む新側で採った記録は、new.commit のバージョンの記録と言えない
  if (head.dirty !== false)
    throw new UsageError(
      "verify-metadata.json の new.dirty が false でない（commit していない変更を含む新側で確かめた記録は、バージョンを特定できない。新側を commit してから verify をやり直す）",
    );
  return { v, commit };
}

/**
 * 収束を判定する。
 * @param {{ slugDir: string, target: string, metadata: unknown, strengthPlan: unknown, strengthReport: unknown, replaceMetadata: unknown, verify: unknown, currentReport: unknown, newReport: unknown, measurements: unknown }} input
 */
export function judgeConvergence(input) {
  const metadata = checkSuiteMetadata(input.metadata, input.slugDir);
  const slug = String(metadata.slug);
  checkStrength({ plan: input.strengthPlan, report: input.strengthReport }, slug);
  const { v, commit } = readVerifyHead(input.verify, { slug, target: input.target });
  checkNewGreen(input.replaceMetadata, { slug, target: input.target, commit });
  const reasons = makeReasons();
  const suiteRecord = isPlainObject(v.suite) ? v.suite : {};
  sameCommit(reasons, "suite", { actual: suiteRecord.commit, expected: commit });
  const suite = judgeSuite(
    readReport(input.currentReport, "current", "現行の結果（suite-report.json）"),
    readReport(input.newReport, "new", `新側の結果（new/${input.target}/suite-report.json）`),
    reasons,
  );
  const overflow = judgeOverflowRecord({ metadata, input, commit }, reasons);
  const baseline = isPlainObject(metadata.runtime_errors) ? metadata.runtime_errors : {};
  const runtimeErrors = judgeRuntimeErrors(baseline, v.runtime_errors, reasons);
  const required =
    baseline.declared === true ? ALWAYS_UNVERIFIED : [...ALWAYS_UNVERIFIED, "runtime_errors"];
  const checks = {
    suite,
    overflow,
    runtime_errors: runtimeErrors,
    design_review: judgeDesignReview(v.design_review, commit, reasons),
    human_review: judgeHumanReview(v.human_review, commit, reasons),
    unverified: judgeUnverified(v.unverified, required, reasons),
    pending_decisions: judgePending(v.pending_decisions, reasons),
    unmeasured: judgeUnmeasured(metadata, reasons),
  };
  return {
    tool: "convergence-check",
    version: VERSION,
    slug,
    target: input.target,
    commit,
    converged: reasons.list.length === 0,
    send_back: reasons.list.some((r) => r.category === "send-back"),
    reasons: reasons.list,
    checks,
  };
}

/**
 * 横のはみ出しを、測定の記録から判定し直す。
 * @param {{ metadata: Record<string, unknown>, input: { target: string, measurements: unknown }, commit: string }} ctx
 * @param {Reasons} reasons
 */
function judgeOverflowRecord({ metadata, input, commit }, reasons) {
  if (input.measurements === null) {
    reasons.add("remeasure", "overflow", "測定の記録（overflow.json）が無い");
    return { judged: false };
  }
  const decl = readDeclaration(metadata);
  const m = readMeasurements(input.measurements, { slug: decl.slug, target: input.target });
  sameCommit(reasons, "overflow", { actual: m.commit, expected: commit });
  const result = judgeOverflow(decl, m.records);
  for (const r of result.overflowing)
    reasons.add(
      "send-back",
      "overflow",
      `はみ出し: ${r.page} ${r.viewport.width}x${r.viewport.height}`,
    );
  for (const r of result.missing)
    reasons.add(
      "remeasure",
      "overflow",
      `未測定: ${r.page} ${r.viewport.width}x${r.viewport.height}`,
    );
  for (const r of [...result.width_mismatch, ...result.extra])
    reasons.add(
      "remeasure",
      "overflow",
      `幅の不一致か宣言に無い組: ${r.page} ${r.viewport.width}x${r.viewport.height}`,
    );
  return { judged: true, counts: result.counts };
}

const USAGE =
  "usage: convergence-check.mjs --slug-dir .replace/parity/<slug> --target <新側の target> [--write]";

/**
 * 前提のファイルを読む。無ければ前提の欠落として UsageError を投げる。
 * @param {string} path
 * @param {string} hint
 * @param {import("./lib/read-json.mjs").JudgeIo} io
 */
function requireJson(path, hint, io) {
  if (!io.exists(resolve(io.cwd, path))) throw new UsageError(`${path} が無い（${hint}）`);
  return readJsonFile(path, io);
}

/**
 * 引数を読む。
 * @param {string[]} argv
 * @returns {{ dir: string, target: string, write: boolean }}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, { values: ["--slug-dir", "--target"], bools: ["--write"] });
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  const opts = stripDashes(parsed.strings);
  const dir = opts["slug-dir"];
  if (!nonEmptyString(dir)) throw new UsageError("--slug-dir が要る");
  if (!nonEmptyString(opts.target) || !/^[a-z0-9][a-z0-9-]*$/.test(opts.target))
    throw new UsageError("--target が要る（小文字の英数字とハイフン）");
  return { dir, target: opts.target, write: parsed.bools["--write"] === true };
}

/**
 * 判定に使うファイルを読む。verify-metadata.json は、読めたら先に onVerify へ渡す（判定できないときにも書き戻すため）。
 * @param {{ dir: string, target: string }} args
 * @param {import("./lib/read-json.mjs").JudgeIo} io
 * @param {(path: string, doc: unknown) => void} onVerify
 */
function loadInput({ dir, target }, io, onVerify) {
  const newDir = join(dir, "new", target);
  const verifyPath = join(newDir, "verify-metadata.json");
  const verify = requireJson(verifyPath, "assets/verify-metadata-template.json から作る", io);
  onVerify(verifyPath, verify);
  const measurementsPath = join(newDir, "overflow.json");
  return {
    slugDir: dir,
    target,
    verify,
    metadata: requireJson(join(dir, "metadata.json"), "spec-parity suite を先に終える", io),
    strengthPlan: requireJson(
      join(dir, "strength-plan.json"),
      "spec-parity suite で強度の計画を書く",
      io,
    ),
    strengthReport: requireJson(
      join(dir, "strength-report.json"),
      "spec-parity suite で強度の実行の結果を保存する",
      io,
    ),
    replaceMetadata: requireJson(
      join(newDir, "replace-metadata.json"),
      "parity-replace で新側を green にする",
      io,
    ),
    currentReport: requireJson(
      join(dir, "suite-report.json"),
      "suite で現行の e2e の結果を保存する",
      io,
    ),
    newReport: requireJson(
      join(newDir, "suite-report.json"),
      "verify で新側の e2e の結果を保存する",
      io,
    ),
    measurements: io.exists(resolve(io.cwd, measurementsPath))
      ? readJsonFile(measurementsPath, io)
      : null,
  };
}

/**
 * verify-metadata.json に converged と convergence を書く。
 * @param {{ path: string, doc: Record<string, unknown> }} target
 * @param {Record<string, unknown> & { converged: boolean }} convergence
 * @param {import("./lib/read-json.mjs").JudgeIo} io
 */
function writeConvergence(target, convergence, io) {
  target.doc.converged = convergence.converged;
  target.doc.convergence = convergence;
  writeJsonFile(io, target.path, target.doc);
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {Partial<import("./lib/read-json.mjs").JudgeIo>} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = judgeIo(deps);
  /** @type {{ path: string, doc: Record<string, unknown> }[]} */
  const writable = [];
  // 判定できなかったときは、前の実行が残した converged: true を残さない
  const onUsageError = (/** @type {Error} */ e) => {
    const failed = {
      tool: "convergence-check",
      version: VERSION,
      converged: false,
      judged: false,
      error: e.message,
    };
    for (const w of writable) writeConvergence(w, failed, io);
  };
  return runJudge({ io, usage: USAGE, onUsageError }, () => {
    const args = parseArgs(argv);
    const input = loadInput(args, io, (path, doc) => {
      if (args.write && isPlainObject(doc)) writable.push({ path, doc });
    });
    const result = judgeConvergence(input);
    io.stdout(jsonText(result));
    for (const w of writable) writeConvergence(w, result, io);
    if (result.converged) return 0;
    const text = result.reasons.map((r) => `[${r.category}] ${r.message}`).join(" / ");
    io.stderr(`error: 収束していない。${text}\n`);
    return 1;
  });
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
