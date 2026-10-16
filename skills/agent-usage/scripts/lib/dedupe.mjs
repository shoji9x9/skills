// セッションをまたいで同じ応答を二重に数えないための処理。
//
// Claude Code は、セッションを別のセッションに引き継ぐとき（バックグラウンドへの移行・fork など）に、
// 元のセッションの履歴の行を、そのまま（uuid・時刻・message id も同じで）新しいセッションのファイルの先頭にコピーする。
// 行の key はセッションを含むので、そのままでは同じ応答が 2 つのセッションの行として記録される。
//
// 決め方:
//   同じ応答（agent と message id の組）を持つセッションが複数あれば、1 つだけに数える。
//   残すのは、最初の時刻が早いセッション、同じなら最後の時刻が早いセッション（引き継いだ元は先に終わる）、同じなら ID の順。
//   決めた結果は git の共通のディレクトリの claims.json に残し、次からは同じセッションに数える。
//   元のセッションのログが後で消えても、コピーした側に数え直さない（記録済みの行と二重にならない）。
//   残さなかった側のセッションでは、コピーした範囲の人の指示・完了・待ちも外す。コピーした範囲は、
//   外した応答の最後の時刻の後の、最初の人の指示の手前まで（指示が無ければ、残す最初の応答の手前まで）とする。
//   コピーした行には、最後の応答の後の完了の記録なども含まれるので、応答の時刻では区切らない。
//   cost-state（costSnapshots）は変えない。引き継いだ側の cost-state は、引き継いだ後の自分の応答の費用だけを数える
//   （実ログで、コピーした側の cost-state が、コピーした応答を除いた自分の応答の単価表の計算値と同じ程度だった）。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.mjs";
import { isRecord } from "./config.mjs";

/** @typedef {import("./sources/session.mjs").SessionSummary} SessionSummary */

/**
 * @param {string} commonDir
 * @returns {string}
 */
export function claimsPath(commonDir) {
  return join(commonDir, "agent-usage", "claims.json");
}

/**
 * @param {string} path
 * @returns {Map<string, string>} 応答の key → それを数えるセッションの ID
 */
export function loadClaims(path) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!existsSync(path)) return out;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw)) throw new Error(`${path}: オブジェクトでない`);
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string" || v === "") throw new Error(`${path}: ${k} のセッションが不正`);
    out.set(k, v);
  }
  return out;
}

/**
 * @param {string} path
 * @param {Map<string, string>} claims
 */
export function saveClaims(path, claims) {
  const sorted = Object.fromEntries([...claims].sort(([a], [b]) => a.localeCompare(b)));
  writeFileAtomic(path, `${JSON.stringify(sorted)}\n`);
}

/**
 * @param {SessionSummary} a
 * @param {SessionSummary} b
 * @returns {number}
 */
function originFirst(a, b) {
  return a.firstTs - b.firstTs || a.lastTs - b.lastTs || a.sessionId.localeCompare(b.sessionId);
}

/**
 * セッションをまたいだ重複を除いた要約を返す（引数は変えない）。claims は書き換える。
 * @param {readonly SessionSummary[]} summaries
 * @param {Map<string, string>} claims
 * @returns {{ summaries: SessionSummary[]; dropped: number }}
 */
export function dedupeSessions(summaries, claims) {
  /** @type {Map<string, SessionSummary[]>} */
  const holders = new Map();
  for (const s of summaries) {
    for (const m of s.messages) {
      const k = `${s.agent}:${m.key}`;
      const list = holders.get(k) ?? [];
      if (!list.includes(s)) list.push(s);
      holders.set(k, list);
    }
  }
  /** @type {Map<SessionSummary, Set<string>>} 外す応答の key（セッションごと） */
  const drop = new Map();
  for (const [k, list] of holders) {
    let owner = claims.get(k);
    if (owner === undefined) {
      if (list.length === 1) continue;
      owner = [...list].sort(originFirst)[0].sessionId;
      claims.set(k, owner);
    }
    for (const s of list) {
      if (s.sessionId === owner) continue;
      const set = drop.get(s) ?? new Set();
      set.add(k);
      drop.set(s, set);
    }
  }
  let dropped = 0;
  const out = summaries.map((s) => {
    const keys = drop.get(s);
    if (!keys) return s;
    const lost = s.messages.filter((m) => keys.has(`${s.agent}:${m.key}`));
    dropped += lost.length;
    // 応答が多いセッションで引数の数の上限に当たらないよう、Math.max(...) を使わない
    const upTo = lost.reduce((a, m) => Math.max(a, m.ts), Number.NEGATIVE_INFINITY);
    const kept = s.messages.filter((m) => !keys.has(`${s.agent}:${m.key}`));
    const cut = [...s.prompts, ...kept.map((m) => m.ts)]
      .filter((t) => t > upTo)
      .reduce((a, t) => Math.min(a, t), Number.POSITIVE_INFINITY);
    /** @param {number} t */
    const own = (t) => t >= cut;
    return {
      ...s,
      messages: kept,
      prompts: s.prompts.filter(own),
      turnEnds: s.turnEnds.filter(own),
      interrupts: s.interrupts.filter(own),
      autoResumes: s.autoResumes.filter(own),
      humanWaits: s.humanWaits.filter((w) => own(w.start)),
      commands: s.commands.filter((c) => own(c.ts)),
    };
  });
  return { summaries: out, dropped };
}
