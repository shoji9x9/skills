// セッションの要約から、1 回の指示ごとの稼働の区間（run）を作る。
//
// 区切り: 人の指示と、人を待った区間（人への質問・人が判断した権限の確認）の終わりで新しい run を始める。
//         人を待ち始めたところで run を終える。
// 終わり: 次の区切りの前の、最後の応答の完了。
// 外部待ち: 応答の完了から自動の再開（バックグラウンドの処理の通知など）までは、run の中の外部待ちとして数える。
// 応答の途中の人の指示（処理中に追加で送った指示）は、run を区切らない。
// 応答の完了が 1 件も記録されていないログ（古いバージョン）は、各区切りの前の最後の応答の時刻を完了とみなす。

/** @typedef {import("./session.mjs").SessionSummary} SessionSummary */

/**
 * @typedef {object} Run
 * @property {number} start
 * @property {number} end
 * @property {number} waitMs run の中の外部待ちの合計
 * @property {boolean} open ログの終わりで、まだ応答が完了していない（実行中か、途中で終わった）
 * @property {"prompt" | "human-wait" | "auto"} trigger run を始めたもの
 */

/**
 * @typedef {{ t: number; order: number; type: "prompt" | "hwStart" | "hwEnd" | "turnEnd" | "auto" }} TimelineEvent
 */

/** 応答の途中の指示を、完了の記録が抜けたターンの後の指示とみなすまでの、直前の応答からの時間。 */
const STALE_TURN_MS = 30 * 60000;

/** 同じ時刻のイベントを処理する順。完了を先に、始まりを後にする。 */
const ORDER = { turnEnd: 0, hwStart: 1, hwEnd: 2, auto: 3, prompt: 4 };

/**
 * 応答の完了の記録が無いログで、完了の時刻を応答の時刻から作る。
 * @param {SessionSummary} s
 * @returns {number[]}
 */
export function inferTurnEnds(s) {
  const boundaries = [
    ...s.prompts,
    ...s.humanWaits.map((w) => w.start),
    Number.POSITIVE_INFINITY,
  ].sort((a, b) => a - b);
  const msgs = s.messages.map((m) => m.ts).sort((a, b) => a - b);
  /** @type {number[]} */
  const out = [];
  let i = 0;
  for (const b of boundaries) {
    let last = null;
    while (i < msgs.length && msgs[i] < b) {
      last = msgs[i];
      i += 1;
    }
    if (last !== null) out.push(last);
  }
  return out;
}

/**
 * 状態を 1 つのオブジェクトに持つ（関数をまたいで書き換える let は、型の絞り込みが追えないため）。
 * @typedef {object} RunState
 * @property {Run[]} runs
 * @property {Run | null} run
 * @property {boolean} working
 * @property {number | null} lastTurnEnd
 * @property {number} waitMs
 * @property {number} waiting
 * @property {number[]} msgTimes 応答の時刻（昇順）
 */

/**
 * 区切りと完了のイベントを、時刻と同じ時刻での処理の順に並べる。
 * @param {SessionSummary} s
 * @returns {TimelineEvent[]}
 */
function timelineEvents(s) {
  // 完了の記録が無いログ（古いバージョン）は応答の時刻から推定する。中断はどちらの場合も完了に足す
  const turnEnds = [...(s.turnEnds.length > 0 ? s.turnEnds : inferTurnEnds(s)), ...s.interrupts];
  /** @type {TimelineEvent[]} */
  const events = [];
  for (const t of s.prompts) events.push({ t, order: ORDER.prompt, type: "prompt" });
  for (const t of turnEnds) events.push({ t, order: ORDER.turnEnd, type: "turnEnd" });
  for (const t of s.autoResumes) events.push({ t, order: ORDER.auto, type: "auto" });
  for (const w of s.humanWaits) {
    events.push({ t: w.start, order: ORDER.hwStart, type: "hwStart" });
    events.push({ t: w.end, order: ORDER.hwEnd, type: "hwEnd" });
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  return events;
}

/**
 * t より前で最後の応答の時刻（無ければ null）。
 * @param {readonly number[]} msgTimes
 * @param {number} t
 * @returns {number | null}
 */
function lastMessageBefore(msgTimes, t) {
  let found = null;
  for (const m of msgTimes) {
    if (m >= t) break;
    found = m;
  }
  return found;
}

/**
 * @param {RunState} st
 * @param {number} end
 */
function closeRun(st, end) {
  const r = st.run;
  if (r && end >= r.start) {
    r.end = end;
    r.waitMs = st.waitMs;
    st.runs.push(r);
  }
  st.run = null;
  st.waitMs = 0;
  st.lastTurnEnd = null;
}

/**
 * @param {RunState} st
 * @param {number} t
 * @param {Run["trigger"]} trigger
 */
function openRun(st, t, trigger) {
  st.run = { start: t, end: t, waitMs: 0, open: false, trigger };
  st.working = true;
  st.lastTurnEnd = null;
  st.waitMs = 0;
}

/**
 * @param {RunState} st
 * @param {TimelineEvent} e
 */
function onPrompt(st, e) {
  if (st.run && st.working) {
    // 応答の途中の指示は区切らない。ただし、直前の応答から STALE_TURN_MS より長く何も無ければ、
    // 完了の記録が抜けた（API のエラー・プロセスの終了など）とみなし、最後の応答で閉じる
    const lastMsg = lastMessageBefore(st.msgTimes, e.t);
    const since = lastMsg ?? st.run.start;
    if (e.t - since <= STALE_TURN_MS) return;
    closeRun(st, Math.max(st.run.start, since));
    openRun(st, e.t, "prompt");
    return;
  }
  if (st.run) closeRun(st, st.lastTurnEnd ?? e.t);
  openRun(st, e.t, "prompt");
}

/**
 * @param {RunState} st
 * @param {TimelineEvent} e
 */
function onAuto(st, e) {
  if (!st.run) {
    openRun(st, e.t, "auto");
    return;
  }
  if (!st.working && st.lastTurnEnd !== null) st.waitMs += e.t - st.lastTurnEnd;
  st.working = true;
}

/**
 * @param {RunState} st
 * @param {TimelineEvent} e
 */
function onTurnEnd(st, e) {
  if (!st.run) return;
  st.working = false;
  st.lastTurnEnd = e.t;
}

/**
 * @param {RunState} st
 * @param {TimelineEvent} e
 */
function onHumanWaitStart(st, e) {
  // 並列のツール呼び出しで人の待ちが重なることがあるので、重なりの深さで数える
  st.waiting += 1;
  if (st.run) closeRun(st, e.t);
  st.working = false;
}

/**
 * @param {RunState} st
 * @param {TimelineEvent} e
 */
function onHumanWaitEnd(st, e) {
  st.waiting = Math.max(0, st.waiting - 1);
  if (st.waiting > 0) return;
  if (st.run) closeRun(st, e.t);
  openRun(st, e.t, "human-wait");
}

/** イベントの種類ごとの処理。 */
const HANDLERS = {
  prompt: onPrompt,
  auto: onAuto,
  turnEnd: onTurnEnd,
  hwStart: onHumanWaitStart,
  hwEnd: onHumanWaitEnd,
};

/**
 * ログの終わりで、残った run を閉じる。
 * @param {RunState} st
 * @param {number} lastTs ログの最後の時刻
 */
function closeLastRun(st, lastTs) {
  const last = st.run;
  if (!last) return;
  if (st.working || st.lastTurnEnd === null) {
    last.open = true;
    closeRun(st, Math.max(last.start, lastTs));
  } else {
    closeRun(st, st.lastTurnEnd);
  }
}

/**
 * @param {SessionSummary} s
 * @returns {Run[]}
 */
export function buildRuns(s) {
  if (s.subagent) return [];
  const events = timelineEvents(s);
  /** @type {RunState} */
  const st = {
    runs: [],
    run: null,
    working: false,
    lastTurnEnd: null,
    waitMs: 0,
    waiting: 0,
    msgTimes: s.messages.map((m) => m.ts).sort((a, b) => a - b),
  };
  for (const e of events) HANDLERS[e.type](st, e);
  closeLastRun(st, s.lastTs);
  return st.runs;
}
