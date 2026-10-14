// collect の全体: ローカルのログ・人の commit・GitHub から行を作り、まだ記録していない行を records/ に書く。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isRecord, loadOrCreateUserConfig, loadRepoConfig } from "./config.mjs";
import { collectLocal } from "./collect.mjs";
import { collectGitHub, commitActivityRows, makeGh } from "./github.mjs";
import { loadBundledPricing, loadBundledReviewPricing } from "./pricing.mjs";
import { signature } from "./rows.mjs";
import {
  GITHUB_DIR,
  GITHUB_KINDS,
  changedRows,
  fileStamp,
  latestByKey,
  readRecords,
  safeName,
  usageDir,
  writeNewFile,
} from "./records.mjs";
import { gitOrNull } from "./repo.mjs";
import { issueOf } from "./session.mjs";
import { parseTime, toIso } from "./time.mjs";
import { rememberWorktrees } from "./worktrees.mjs";
import { join } from "node:path";

/** @typedef {import("./rows.mjs").Row} Row */
/** @typedef {import("./repo.mjs").RepoInfo} RepoInfo */
/** @typedef {import("./github.mjs").GhRunner} GhRunner */

/** 前回の取得の終わりから、さかのぼって再取得する幅（投稿や artifact の反映の遅れを拾うため）。重なった分は key で除く。 */
export const GITHUB_OVERLAP_MS = 86400000;

/** 初めての取得でさかのぼる上限（ローカルのログの最初の時刻がこれより古くても、ここまでにする）。 */
export const GITHUB_FIRST_LOOKBACK_MS = 60 * 86400000;

/**
 * @returns {Record<string, string>}
 */
function loadBundledTools() {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../assets/review-tools.json", import.meta.url)), "utf8"),
  );
  /** @type {Record<string, string>} */
  const out = {};
  if (isRecord(raw) && isRecord(raw.tools)) {
    for (const [k, v] of Object.entries(raw.tools)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * GitHub から取り始める時刻。この人の取得に成功した期間の最後から GITHUB_OVERLAP_MS さかのぼる。記録が無ければ、ローカルの行の最初の時刻。
 * 他の人の取得（_github/ の coverage）は数えない。この時刻は、この人の commit と GitHub での操作（activity）を取る範囲にも使うので、
 * 他の人が最近取得していると、しばらく collect していなかった人の activity が取れなくなる。
 * @param {Map<string, Row>} existing
 * @param {readonly Row[]} localRows
 * @param {number} now
 * @param {string} person
 * @returns {number}
 */
export function githubSince(existing, localRows, now, person) {
  let lastOk = Number.NEGATIVE_INFINITY;
  for (const r of existing.values()) {
    if (r.kind !== "coverage" || r.detail !== "ok" || r.person !== person) continue;
    const end = parseTime(r.end);
    if (end !== null && end > lastOk) lastOk = end;
  }
  if (Number.isFinite(lastOk))
    return Math.max(lastOk - GITHUB_OVERLAP_MS, now - GITHUB_FIRST_LOOKBACK_MS);
  let first = now;
  for (const r of localRows) {
    const t = parseTime(r.start);
    if (t !== null && t < first) first = t;
  }
  return Math.max(first, now - GITHUB_FIRST_LOOKBACK_MS);
}

/**
 * 停止の分類に使う段の失敗だけを返す。課金 API と artifact の失敗は費用の行が欠けるだけなので、
 * その期間を判定不能（coverage が ok でない）にしない。
 * @param {readonly string[]} failures
 * @returns {string[]}
 */
export function classifyingFailuresOf(failures) {
  return failures.filter((f) => !f.startsWith("billing") && !f.startsWith("artifacts"));
}

/**
 * @typedef {object} CollectOptions
 * @property {RepoInfo} repo
 * @property {number} now
 * @property {NodeJS.ProcessEnv} env
 * @property {boolean} github
 * @property {GhRunner | null} gh テストで差し替える（null なら gh を使う）
 */

/**
 * @typedef {object} CollectReport
 * @property {string} person
 * @property {boolean} personCreated
 * @property {string[]} written 書いたファイル
 * @property {number} newRows
 * @property {number} sessions
 * @property {number} parsed
 * @property {number} invalidLines
 * @property {number} duplicateMessages 別のセッションと重複したので数えなかった応答の数
 * @property {string[]} githubFailures
 * @property {boolean} githubSkipped
 * @property {number} keyConflicts 同じ key で内容の違う行の数（0 でなければ行の作り方の不具合）
 */

/**
 * @param {CollectOptions} o
 * @returns {CollectReport}
 */
export function runCollect(o) {
  const { repo, now, env } = o;
  const dir = usageDir(repo.root);
  const repoConfig = loadRepoConfig(join(dir, "config.json"));
  const user = loadOrCreateUserConfig(env);
  const person = repoConfig.aliases[user.config.personId] ?? user.config.personId;
  const tz = user.config.timeZone;
  const bundledPricing = loadBundledPricing();
  const ctx = { person, tz, repoPricing: repoConfig.pricing, bundledPricing };

  const local = collectLocal({
    roots: rememberWorktrees(repo.commonDir, repo.worktrees),
    remote: repo.remote,
    commonDir: repo.commonDir,
    env,
    ctx,
    useCache: true,
  });
  const existing = latestByKey(readRecords(join(dir, "records")).rows);

  /** @type {Row[]} */
  const candidates = [...local.rows];
  const since = githubSince(existing, local.rows, now, person);

  const reflog =
    gitOrNull(
      ["log", "-g", "--all", "--date=iso-strict", "--format=%H%x00%gd%x00%gs%x1e"],
      repo.root,
    ) ?? "";
  candidates.push(...commitActivityRows(reflog, local.commands, { person, tz, since }));

  /** @type {string[]} */
  let githubFailures = [];
  const [host, owner, name] = repo.remote.split("/");
  // github.com（か、GH_HOST で指定した GitHub Enterprise のホスト）の owner/name の形だけを GitHub として扱う
  const ghHosts = ["github.com", (env.GH_HOST ?? "").toLowerCase()].filter((h) => h !== "");
  const githubSkipped =
    !o.github || !owner || !name || repo.remote.split("/").length !== 3 || !ghHosts.includes(host);
  if (!githubSkipped) {
    const gh = o.gh ?? makeGh(host);
    const res = collectGitHub({
      slug: `${owner}/${name}`,
      since,
      now,
      person,
      tz,
      config: repoConfig,
      bundledTools: loadBundledTools(),
      bundledPricing,
      bundledReviewPricing: loadBundledReviewPricing(),
      knownArtifacts: new Set(
        [...existing.keys()].flatMap((k) => {
          const m = /^review-artifact:(\d+):/.exec(k);
          return m ? [Number(m[1])] : [];
        }),
      ),
      commands: local.commands,
      billing: user.config.billing,
      gh,
    });
    candidates.push(...res.rows);
    githubFailures = res.failures;
    const classifyingFailures = classifyingFailuresOf(res.failures);
    candidates.push({
      key: `coverage:github:${toIso(since)}:${toIso(now)}`,
      kind: "coverage",
      person,
      tz,
      start: toIso(since),
      end: toIso(now),
      // 停止の分類に使う段（PR・Actions の run・外部の CI・自分の login）が取れていれば ok にする。
      // 課金 API と artifact の失敗は費用の行が欠けるだけなので、その期間を判定不能にしない（失敗は collect の出力に出る）
      detail:
        classifyingFailures.length === 0
          ? "ok"
          : `failed:${classifyingFailures.join(" | ").slice(0, 500)}`,
    });
  }

  // 同じ key の行が 1 回の collect の中で食い違うのは、行の作り方の不具合である（key が一意でない）。
  // 後の collect のたびに書き直し続けるのを避けるため最初の行を残し、件数を報告する
  /** @type {Map<string, Row>} */
  const unique = new Map();
  let conflicts = 0;
  for (const r of candidates) {
    const prev = unique.get(r.key ?? "");
    if (!prev) unique.set(r.key ?? "", r);
    else if (signature(prev) !== signature(r)) conflicts += 1;
  }
  const fresh = changedRows([...unique.values()], existing);
  const observed = toIso(now);
  for (const r of fresh) r.observed_at = observed;
  const personRows = fresh.filter((r) => !GITHUB_KINDS.includes(r.kind ?? ""));
  const githubRows = fresh.filter((r) => GITHUB_KINDS.includes(r.kind ?? ""));
  const stamp = fileStamp(now);
  const label = issueOf(repo.branch) || safeName(repo.branch || "detached");
  /** @type {string[]} */
  const written = [];
  if (personRows.length > 0)
    written.push(writeNewFile(join(dir, "records", person), `${stamp}-${label}`, personRows));
  if (githubRows.length > 0)
    written.push(writeNewFile(join(dir, "records", GITHUB_DIR), `${stamp}-${person}`, githubRows));
  return {
    person,
    personCreated: user.created,
    written,
    newRows: fresh.length,
    sessions: local.sessions,
    parsed: local.parsed,
    invalidLines: local.invalidLines,
    duplicateMessages: local.duplicateMessages,
    githubFailures,
    githubSkipped,
    keyConflicts: conflicts,
  };
}
