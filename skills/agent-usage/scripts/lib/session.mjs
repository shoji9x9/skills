// エージェントごとのログの解析結果を、共通の形（セッションの要約）にそろえる。
// 解析の処理（claude-log.mjs・codex-log.mjs）がこの形を作り、collect はこの形だけを読む。
// 要約は JSON にしてキャッシュするので、関数や Map を持たせない。

/** @typedef {import("./pricing.mjs").Tokens} Tokens */

/**
 * 1 回の API の応答の使用量。key は重複を除くためのキー（Claude Code は message id、Codex は response id）。
 * @typedef {object} MessageUsage
 * @property {string} key
 * @property {number} ts
 * @property {string} model
 * @property {Tokens} tokens
 */

/**
 * Claude Code が記録したセッションの累計の費用（cost-state）。ts は、その行より前で最後に時刻を持つ行の時刻。
 * models はモデル名（normalizeModel を当てた後）ごとの累計の費用（USD）と、そのモデルの累計の出力トークン数。
 * @typedef {object} CostSnapshot
 * @property {number} ts
 * @property {Record<string, { costUSD: number; tokens: Tokens }>} models
 */

/**
 * 人を待った区間（人に質問するツールと、人が判断した権限の確認）。
 * @typedef {object} HumanWait
 * @property {number} start
 * @property {number} end
 * @property {string} reason
 */

/**
 * @typedef {object} SessionSummary
 * @property {"claude-code" | "codex"} agent
 * @property {string} sessionId
 * @property {boolean} subagent ファイル全体がサブエージェントのものか（使用量だけを数え、稼働の区間は作らない）
 * @property {string[]} cwds
 * @property {string} repoUrl Codex の session_meta が持つリモートの URL（無ければ空）
 * @property {{ ts: number; branch: string }[]} branches 時刻とその時点のブランチ（時刻の昇順）
 * @property {MessageUsage[]} messages
 * @property {CostSnapshot[]} costSnapshots
 * @property {number[]} prompts 人の指示の時刻
 * @property {number[]} turnEnds 応答の完了の時刻
 * @property {number[]} autoResumes 自動の再開（バックグラウンドの処理の通知・予約した再開・他のセッションからの連絡）の時刻
 * @property {HumanWait[]} humanWaits
 * @property {{ ts: number; text: string }[]} commands エージェントが実行したコマンド（git commit と gh の判定に使う）
 * @property {number} firstTs
 * @property {number} lastTs
 * @property {number} invalidLines JSON として読めなかった行の数
 */

/**
 * @param {"claude-code" | "codex"} agent
 * @param {string} sessionId
 * @returns {SessionSummary}
 */
export function emptySummary(agent, sessionId) {
  return {
    agent,
    sessionId,
    subagent: false,
    cwds: [],
    repoUrl: "",
    branches: [],
    messages: [],
    costSnapshots: [],
    prompts: [],
    turnEnds: [],
    autoResumes: [],
    humanWaits: [],
    commands: [],
    firstTs: Number.POSITIVE_INFINITY,
    lastTs: Number.NEGATIVE_INFINITY,
    invalidLines: 0,
  };
}

/**
 * @param {SessionSummary} s
 * @param {number} ts
 */
export function touch(s, ts) {
  if (ts < s.firstTs) s.firstTs = ts;
  if (ts > s.lastTs) s.lastTs = ts;
}

/**
 * 時刻 ts の時点のブランチ（それ以前で最後に記録されたもの。無ければ最初のもの）。
 * @param {SessionSummary} s
 * @param {number} ts
 * @returns {string}
 */
export function branchAt(s, ts) {
  let found = s.branches.length > 0 ? s.branches[0].branch : "";
  for (const b of s.branches) {
    if (b.ts > ts) break;
    found = b.branch;
  }
  return found;
}

/**
 * ブランチの名前から Issue の番号を取る（`feature/602-...` の 602）。取れなければ空。
 * @param {string} branch
 * @returns {string}
 */
export function issueOf(branch) {
  const m = /(?:^|\/)(\d+)-/.exec(branch);
  return m ? m[1] : "";
}
