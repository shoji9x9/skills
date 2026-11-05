// ブランチを記録するかの判定（原本）。コミットの前の確認（gate.mjs）・status の表示（agent-usage.mjs）・
// 別の作業ツリーの行を外す判定（merged.mjs）が、同じ順で判定するためにこの関数を呼ぶ。
// 判定の順は、ブランチの判断、defaultDecision、人の設定の有無である。止める理由の文や表示の文は、呼び出し側が結果から作る。
// 設定や記録の読み方は呼び出し側で違う（status は読めない理由を表示する、merged.mjs は読んだ結果を使い回す）ので、読み取りを関数で受け取る。

/**
 * 判定に使う値の読み取り。どれも読めなければ例外を投げる。
 * @typedef {object} DecisionReaders
 * @property {() => import("./decisions.mjs").Decision | null} branch ブランチの判断。無ければ null
 * @property {() => { decision: import("./config.mjs").DefaultDecision; source: string } | null} fallback
 *   判断の無いブランチの扱い（defaultDecision）と、それを決めた設定のファイル。どの層にも無ければ null
 * @property {() => boolean} person 人の設定があるか
 */

/**
 * 判定の結果。
 * - unreadable: 読めない値があった。stage は、判断の記録（decisions）か設定（config）か。branch は、そこまでに読んだブランチの判断
 * - undecided: ブランチの判断も defaultDecision も無い
 * - no-person: 判断は決まったが、人の設定が無い（コミットの前の確認は止めて setup を求める）
 * - decided: 判断が決まった。source は defaultDecision を決めた設定のファイルで、ブランチの判断に従ったときは null
 * @typedef {{ kind: "unreadable", stage: "decisions", error: unknown, branch: undefined }
 *   | { kind: "unreadable", stage: "config", error: unknown, branch: "record" | null }
 *   | { kind: "undecided" }
 *   | { kind: "no-person", decision: import("./decisions.mjs").Decision, source: string | null }
 *   | { kind: "decided", decision: import("./decisions.mjs").Decision, source: string | null }} RecordDecision
 */

/**
 * ブランチを記録するかを判定する。
 * ブランチの判断が decline なら、人の設定を読まずに記録しないと決める。
 * defaultDecision は、人の設定（setup が作る人の ID）がある人にだけ当てる。
 * 無い人に当てると、使い捨ての環境では実行のたびに別の ID で記録され、HOME に書けない環境では毎回止まる。
 * @param {DecisionReaders} read
 * @returns {RecordDecision}
 */
export function recordDecision(read) {
  /** @type {import("./decisions.mjs").Decision | null} */
  let branch;
  try {
    branch = read.branch();
  } catch (error) {
    return { kind: "unreadable", stage: "decisions", error, branch: undefined };
  }
  if (branch === "decline") return { kind: "decided", decision: "decline", source: null };
  let fallback = null;
  if (branch === null) {
    try {
      fallback = read.fallback();
    } catch (error) {
      return { kind: "unreadable", stage: "config", error, branch };
    }
    if (fallback === null) return { kind: "undecided" };
  }
  let person;
  try {
    person = read.person();
  } catch (error) {
    return { kind: "unreadable", stage: "config", error, branch };
  }
  const decision = fallback === null ? "record" : fallback.decision;
  const source = fallback === null ? null : fallback.source;
  return { kind: person ? "decided" : "no-person", decision, source };
}

/**
 * 判定の結果が「記録する」か。
 * @param {RecordDecision} r
 * @returns {boolean}
 */
export function decidesToRecord(r) {
  return r.kind === "decided" && r.decision === "record";
}
