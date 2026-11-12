// 自律実行の保留（pending_decisions[]）1 件の状態（open・decided・settled）を決める部品。
// 状態の定義の原本は replace-strategy の references/autonomy.md「保留の状態」で、判定はこのファイルで定義する。
// このファイルは replace-strategy と spec-parity が同じ中身で持つ（identical-copies の組で確かめる）。
// replace-strategy の pending-decisions-check.mjs（前提の判定）と spec-parity の convergence-check.mjs（収束の判定）が使う。
// 片方だけを直すと、前提の判定と収束の判定で、同じ保留の数え方が食い違う。

import { isArray } from "./is-array.mjs";
import { isPlainObject, nonEmptyString } from "./guards.mjs";

/**
 * 回答として書いてあるか。雛形のプレースホルダ（`<...>`）のままの値は、書いていないものとして扱う。
 * @param {unknown} v
 * @returns {boolean}
 */
function answered(v) {
  return nonEmptyString(v) && !/^<[\s\S]*>$/.test(String(v).trim());
}

/**
 * 保留 1 件の状態を決める。
 *   - open: resolution が無い（null・欠落）か、回答として読めない
 *   - decided: 回答はあるが、blocks の工程を実施した記録も残作業の置き場も無い
 *   - settled: 回答があり、blocks が空か、実施の記録か置き場のどちらかがある
 * @param {unknown} element
 * @returns {{ state: "open" | "decided" | "settled", reason: string, tracked_in?: string }}
 */
export function classifyDecision(element) {
  if (!isPlainObject(element)) return { state: "open", reason: "要素がオブジェクトでない" };
  const resolution = element.resolution;
  if (resolution === null || resolution === undefined) {
    return { state: "open", reason: "resolution が無い" };
  }
  // 回答として読めない resolution を「解決済み」として扱わない（`true` や空オブジェクト・雛形の値のままで通さない）。
  if (!isPlainObject(resolution) || !answered(resolution.answer)) {
    return { state: "open", reason: "resolution に answer が無い" };
  }
  if (!answered(resolution.answered_at)) {
    return { state: "open", reason: "resolution に answered_at が無い" };
  }
  const blocks = element.blocks;
  // blocks の欠落・型崩れは「止めた工程が無い」ではなく「分からない」なので、工程があるものとして扱う。
  if (!isArray(blocks)) {
    return settledOrDecided(resolution, "blocks が配列でない（止めた工程を読めない）");
  }
  if (blocks.length === 0) return { state: "settled", reason: "止めた工程が無い" };
  return settledOrDecided(
    resolution,
    "blocks の工程を実施した記録（resumed）も残作業の置き場（follow_up.tracked_in）も無い",
  );
}

/**
 * 止めた工程がある（または読めない）保留を、実施の記録か置き場で済んだと数えるか。
 * @param {Record<string, unknown>} resolution
 * @param {string} missingReason
 * @returns {{ state: "decided" | "settled", reason: string, tracked_in?: string }}
 */
function settledOrDecided(resolution, missingReason) {
  const resumed = resolution.resumed;
  // 実施の記録は日時と証拠の両方を要る。日時だけだと「再開した」と書けば通る。
  if (
    isPlainObject(resumed) &&
    answered(resumed.at) &&
    isArray(resumed.evidence) &&
    resumed.evidence.some(answered)
  ) {
    return { state: "settled", reason: "blocks の工程を実施した記録がある" };
  }
  const followUp = resolution.follow_up;
  // 置き場は残作業（what）と追跡先（tracked_in）の両方を要る。追跡先だけでは何を追っているか分からない。
  const trackedIn = isPlainObject(followUp) ? followUp.tracked_in : undefined;
  // nonEmptyString が真なら文字列なので、typeof は型を絞るためだけにある（判定は変わらない）。
  if (
    isPlainObject(followUp) &&
    answered(followUp.what) &&
    typeof trackedIn === "string" &&
    answered(trackedIn)
  ) {
    return {
      state: "settled",
      reason: "残作業を別の置き場で追跡している",
      tracked_in: trackedIn,
    };
  }
  return { state: "decided", reason: missingReason };
}
