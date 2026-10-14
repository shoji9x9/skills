// GitHub から、停止の分類とレビューの集計に使う情報を取る。すべて `gh api` で、リポジトリ単位の API だけを使う。
// ユーザーのイベントの API は使わない。30 日・300 件までで、反映に最大 6 時間かかり、SAML SSO の組織で欠けうるため。
//
// 取るもの（since 以降）:
//   更新された PR（search）と、その timeline     自分のレビュー・コメント（activity）・レビュー待ち（review-wait）・ボットのレビュー（review）。
//   GitHub Actions の実行（actions/runs）        CI の区間（ci）。
//   外部の CI（設定で有効なときだけ）            PR の head の commit ごとの check runs と commit status（ci）。
//   artifact（名前 agent-usage-review-*）        自分の Actions で実行したレビューの使用量（review）。
//   課金 API（人の設定で有効なときだけ）         premium request の日別の実額（billing）。
// 取得に失敗したら、その期間を coverage の行に failed として残す（report はその期間の停止を「判定不能」にする）。

import { spawnSync } from "node:child_process";
import { isArray } from "./is-array.mjs";
import { isRecord } from "./config.mjs";
import { parseCodexLog } from "./codex-log.mjs";
import {
  addTokens,
  costOf,
  normalizeModel,
  resolvePrice,
  resolveReviewPrice,
  zeroTokens,
} from "./pricing.mjs";
import { fmt } from "./rows.mjs";
import { issueOf } from "./session.mjs";
import { parseTime, toIso } from "./time.mjs";
import { unzip } from "./unzip.mjs";

/** @typedef {import("./rows.mjs").Row} Row */
/** @typedef {import("./config.mjs").RepoConfig} RepoConfig */
/** @typedef {import("./config.mjs").Price} Price */

/** 同梱の雛形が上げる artifact の名前。1 回の workflow の実行で両方の手順を使えるよう、ツールごとに分ける。 */
export const ARTIFACT_NAMES = ["agent-usage-review-claude", "agent-usage-review-codex"];

/** エージェントの操作とみなす、コマンドの時刻からの幅（コマンドより前・コマンドより後）。 */
const AGENT_BEFORE_MS = 60000;
const AGENT_AFTER_MS = 180000;
/** コミットは、Hook の collect（初回は数分かかる）が終わってから記録されるので、後ろの幅を長く取る。 */
const AGENT_COMMIT_AFTER_MS = 600000;

/**
 * gh api の呼び出し方。テストで差し替える。
 * @typedef {(args: readonly string[], opts: { binary?: boolean }) => Buffer} GhRunner
 */

/**
 * 環境変数の token（GH_TOKEN・GITHUB_TOKEN・GH_ENTERPRISE_TOKEN・GITHUB_ENTERPRISE_TOKEN）を除いた環境変数を返す。
 * gh は環境変数の token を、保存した token より優先して使う（gh 2.93.0 で実測）。
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function withoutEnvTokens(env) {
  const {
    GH_TOKEN: _a,
    GITHUB_TOKEN: _b,
    GH_ENTERPRISE_TOKEN: _c,
    GITHUB_ENTERPRISE_TOKEN: _d,
    ...rest
  } = env;
  return rest;
}

/**
 * gh api を実行する GhRunner を作る。github.com 以外（GitHub Enterprise Server）のリモートなら、GH_HOST でそのホストに向ける。
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [baseEnv] gh に渡す環境変数（デフォルトは process.env）
 * @returns {GhRunner}
 */
export function makeGh(host, baseEnv = process.env) {
  // 利用者の環境の GH_HOST（GitHub Enterprise など）ではなく、リモートのホストに問い合わせる
  const env = { ...baseEnv, GH_HOST: host === "" ? "github.com" : host };
  return (args) => {
    const r = spawnSync("gh", ["api", ...args], {
      env,
      timeout: 120000,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.error) throw r.error;
    if (r.status !== 0)
      throw new Error(
        `gh api ${args.join(" ")}: ${r.stderr.toString("utf8").trim() || `exit ${r.status}`}`,
      );
    return r.stdout;
  };
}

/**
 * @param {GhRunner} gh
 * @param {string} path
 * @returns {unknown}
 */
function getJson(gh, path) {
  return JSON.parse(gh([path], {}).toString("utf8"));
}

/**
 * ページングして、各ページの配列（pick で取り出す）をつなげる。
 * @param {GhRunner} gh
 * @param {string} path
 * @param {(page: unknown) => unknown} pick
 * @returns {unknown[]}
 */
function getAll(gh, path, pick) {
  const pages = JSON.parse(gh(["--paginate", "--slurp", path], {}).toString("utf8"));
  if (!isArray(pages)) throw new Error(`${path}: ページの配列でない`);
  /** @type {unknown[]} */
  const out = [];
  for (const page of pages) {
    const items = pick(page);
    if (!isArray(items)) throw new Error(`${path}: 項目の配列が無い`);
    out.push(...items);
  }
  return out;
}

/**
 * GitHub の login を比べる形にする（末尾の [bot] を除き、小文字にする）。
 * @param {string} login
 * @returns {string}
 */
export function normalizeLogin(login) {
  const name = login.replace(/\[bot\]$/i, "").toLowerCase();
  // Copilot のレビュアーは、GraphQL では copilot-pull-request-reviewer、REST では Copilot になる
  return name === "copilot" ? "copilot-pull-request-reviewer" : name;
}

/**
 * @param {Record<string, string>} bundled
 * @param {Record<string, string>} repo
 * @param {string} login
 * @returns {string | null}
 */
export function toolOf(bundled, repo, login) {
  const n = normalizeLogin(login);
  for (const table of [repo, bundled]) {
    for (const [k, v] of Object.entries(table)) if (normalizeLogin(k) === n) return v;
  }
  return null;
}

/**
 * 時刻 t が、エージェントの該当するコマンドの直後か。
 * @param {number} t
 * @param {readonly { ts: number; text: string }[]} commands
 * @param {RegExp} pattern
 * @param {number} [afterMs] コマンドより後の幅
 * @returns {boolean}
 */
export function nearAgentCommand(t, commands, pattern, afterMs = AGENT_AFTER_MS) {
  return commands.some(
    (c) => pattern.test(c.text) && t >= c.ts - AGENT_BEFORE_MS && t <= c.ts + afterMs,
  );
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function str(v) {
  return typeof v === "string" ? v : "";
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * @param {unknown} user
 * @returns {string}
 */
function loginOf(user) {
  return isRecord(user) ? str(user.login) : "";
}

/** 更新された PR と、その timeline（レビュー・レビューの依頼・コメント）をまとめて取る GraphQL の問い合わせ。 */
export const PR_QUERY = `query($q: String!, $endCursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number headRefName headRefOid closedAt author { login }
        timelineItems(first: 100, itemTypes: [PULL_REQUEST_REVIEW, REVIEW_REQUESTED_EVENT, ISSUE_COMMENT]) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on PullRequestReview { databaseId author { login } submittedAt state }
            ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { name } } }
            ... on IssueComment { databaseId author { login } createdAt body }
          }
        }
      }
    }
  }
}`;

/**
 * timeline の項目（GraphQL と REST の違いをそろえた形）。
 * @typedef {{ type: "review"; id: number; login: string; at: number; state: string }
 *   | { type: "request"; login: string; at: number }
 *   | { type: "comment"; id: number; login: string; at: number; body: string }} TimelineItem
 */

/**
 * @param {unknown} n
 * @returns {TimelineItem[]}
 */
export function fromGraphqlItem(n) {
  if (!isRecord(n)) return [];
  if (n.__typename === "PullRequestReview") {
    const at = parseTime(n.submittedAt);
    return at === null
      ? []
      : [
          {
            type: "review",
            id: num(n.databaseId),
            login: loginOf(n.author),
            at,
            state: str(n.state).toLowerCase(),
          },
        ];
  }
  if (n.__typename === "ReviewRequestedEvent") {
    const at = parseTime(n.createdAt);
    const r = isRecord(n.requestedReviewer) ? n.requestedReviewer : {};
    const login = str(r.login) || str(r.name);
    return at === null || login === "" ? [] : [{ type: "request", login, at }];
  }
  if (n.__typename === "IssueComment") {
    const at = parseTime(n.createdAt);
    return at === null
      ? []
      : [
          {
            type: "comment",
            id: num(n.databaseId),
            login: loginOf(n.author),
            at,
            body: str(n.body),
          },
        ];
  }
  return [];
}

/**
 * @param {unknown} ev
 * @returns {TimelineItem[]}
 */
export function fromRestEvent(ev) {
  if (!isRecord(ev)) return [];
  const type = str(ev.event);
  if (type === "reviewed") {
    const at = parseTime(ev.submitted_at);
    return at === null
      ? []
      : [
          {
            type: "review",
            id: num(ev.id),
            login: loginOf(ev.user),
            at,
            state: str(ev.state).toLowerCase(),
          },
        ];
  }
  if (type === "review_requested") {
    const at = parseTime(ev.created_at);
    const login =
      loginOf(ev.requested_reviewer) ||
      (isRecord(ev.requested_team) ? str(ev.requested_team.name) : "");
    return at === null || login === "" ? [] : [{ type: "request", login, at }];
  }
  if (type === "commented") {
    const at = parseTime(ev.created_at);
    return at === null
      ? []
      : [{ type: "comment", id: num(ev.id), login: loginOf(ev.user), at, body: str(ev.body) }];
  }
  return [];
}

/**
 * 1 つの PR の timeline から、ボットのレビュー（review）・自分のレビューとコメント（activity）・レビュー待ち（review-wait）の行を作る。
 * レビュー待ちは、依頼（レビューの依頼か `@codex review` のコメント）から、同じレビュアー（同じツール）の次のレビューまで。
 * レビューが届かないまま PR が閉じた（merge を含む）ら、閉じた時刻で終える（チームへの依頼など、同じ login のレビューが届かない依頼もある）。
 * @param {{ number: number; branch: string; author: string; closedAt?: number | null }} pr
 * @param {readonly TimelineItem[]} items
 * @param {string} me
 * @param {GitHubOptions} o
 * @returns {Row[]}
 */
export function timelineRows(pr, items, me, o) {
  /** @type {Row[]} */
  const rows = [];
  const base = { person: o.person, tz: o.tz, branch: pr.branch, issue: issueOf(pr.branch) };
  const who = (/** @type {string} */ login) =>
    toolOf(o.bundledTools, o.config.reviewTools, login) ?? normalizeLogin(login);
  const mine = (/** @type {string} */ login) =>
    me !== "" && normalizeLogin(login) === normalizeLogin(me);
  /** @type {{ reviewer: string; start: number }[]} */
  const waits = [];
  /** @type {{ reviewer: string; at: number }[]} */
  const arrivals = [];
  for (const it of items) {
    if (it.type === "review") {
      arrivals.push({ reviewer: who(it.login), at: it.at });
      if (it.at < o.since) continue;
      const tool = toolOf(o.bundledTools, o.config.reviewTools, it.login);
      if (tool) {
        const { cost: price, source: priceSource } = resolveReviewPrice(
          tool,
          o.config.reviewPricing,
          o.bundledReviewPricing,
        );
        rows.push({
          key: `review:${it.id}`,
          kind: "review",
          ...base,
          agent: tool,
          start: toIso(it.at),
          end: toIso(it.at),
          cost_usd: price === null ? "" : fmt(price, true),
          cost_source: priceSource,
          detail: `pr=${pr.number};author=${pr.author};state=${it.state}`,
        });
      } else if (mine(it.login) && !nearAgentCommand(it.at, o.commands, /\bgh\b/)) {
        rows.push({
          key: `activity:gh-review:${it.id}`,
          kind: "activity",
          ...base,
          start: toIso(it.at),
          end: toIso(it.at),
          detail: "gh-review",
        });
      }
    } else if (it.type === "request") {
      waits.push({ reviewer: who(it.login), start: it.at });
    } else {
      if (/@codex\s+review\b/i.test(it.body)) waits.push({ reviewer: "codex-cloud", start: it.at });
      // レビューツールは、指摘が無いとレビューではなくコメントで結果を返すことがある
      const commentTool = toolOf(o.bundledTools, o.config.reviewTools, it.login);
      if (commentTool) arrivals.push({ reviewer: commentTool, at: it.at });
      if (it.at >= o.since && mine(it.login) && !nearAgentCommand(it.at, o.commands, /\bgh\b/)) {
        rows.push({
          key: `activity:gh-comment:${it.id}`,
          kind: "activity",
          ...base,
          start: toIso(it.at),
          end: toIso(it.at),
          detail: "gh-comment",
        });
      }
    }
  }
  for (const w of waits) {
    const done = arrivals
      .filter((a) => a.at >= w.start && a.reviewer === w.reviewer)
      .map((a) => a.at)
      .sort((a, b) => a - b)[0];
    const closed = pr.closedAt ?? null;
    const end = done ?? (closed !== null && closed >= w.start ? closed : o.now);
    if (end < o.since) continue;
    rows.push({
      key: `review-wait:${pr.number}:${w.reviewer}:${toIso(w.start)}`,
      kind: "review-wait",
      ...base,
      agent: w.reviewer,
      start: toIso(w.start),
      end: toIso(end),
      detail: `pr=${pr.number}${done === undefined && end === o.now ? ";open" : ""}`,
    });
  }
  return rows;
}

/** actions/runs が 1 回の問い合わせで返す上限（GitHub の仕様）。これに達したら期間を分けて再取得する。 */
export const RUNS_QUERY_LIMIT = 1000;

/**
 * GitHub Actions の実行の区間。期間の結果が上限に達したら、期間を半分に分けて再取得する（1 時間より短くはしない）。
 * @param {GitHubOptions} o
 * @param {number} from
 * @param {number} to
 * @returns {Row[]}
 */
export function actionRuns(o, from, to) {
  const range = `${toIso(from).replace(/\.\d{3}Z$/, "Z")}..${toIso(to).replace(/\.\d{3}Z$/, "Z")}`;
  const runs = getAll(
    o.gh,
    `repos/${o.slug}/actions/runs?created=${encodeURIComponent(range)}&per_page=100`,
    (p) => (isRecord(p) ? p.workflow_runs : null),
  );
  if (runs.length >= RUNS_QUERY_LIMIT) {
    if (to - from <= 3600000)
      throw new Error(
        `1 時間の実行が ${RUNS_QUERY_LIMIT} 件を超えて、すべてを取得できない: ${range}`,
      );
    const mid = Math.floor((from + to) / 2);
    return [...actionRuns(o, from, mid), ...actionRuns(o, mid + 1000, to)];
  }
  return runRows(runs, o);
}

/**
 * actions/runs の run を ci の行にする。
 * @param {readonly unknown[]} runs
 * @param {GitHubOptions} o
 * @returns {Row[]}
 */
export function runRows(runs, o) {
  /** @type {Row[]} */
  const rows = [];
  for (const r of runs) {
    if (!isRecord(r)) continue;
    const start = parseTime(r.run_started_at) ?? parseTime(r.created_at);
    if (start === null) continue;
    const completed = str(r.status) === "completed";
    const end = completed ? (parseTime(r.updated_at) ?? start) : o.now;
    const branch = str(r.head_branch);
    rows.push({
      key: `ci:${num(r.id)}:${num(r.run_attempt) || 1}`,
      kind: "ci",
      person: o.person,
      tz: o.tz,
      agent: "github-actions",
      start: toIso(start),
      end: toIso(end),
      branch,
      issue: issueOf(branch),
      detail: `${str(r.name)};${str(r.event)};${completed ? str(r.conclusion) : "open"}`,
    });
  }
  return rows;
}

/**
 * @typedef {object} GitHubOptions
 * @property {string} slug owner/repo
 * @property {number} since
 * @property {number} now
 * @property {string} person
 * @property {string} tz
 * @property {RepoConfig} config
 * @property {Record<string, string>} bundledTools
 * @property {Record<string, Price>} bundledPricing
 * @property {Record<string, number>} bundledReviewPricing 同梱のレビュー 1 回あたりの推定額
 * @property {readonly { ts: number; text: string }[]} commands エージェントが実行したコマンド
 * @property {"none" | "user"} billing
 * @property {GhRunner} gh
 * @property {ReadonlySet<number>} [knownArtifacts] 記録済みの artifact の id（ダウンロードしない）
 */

/**
 * @typedef {object} GitHubResult
 * @property {Row[]} rows
 * @property {string[]} failures 取得に失敗した段（空なら全部取れた）
 */

/**
 * @param {GitHubOptions} o
 * @returns {GitHubResult}
 */
export function collectGitHub(o) {
  /** @type {Row[]} */
  const rows = [];
  /** @type {string[]} */
  const failures = [];
  const base = { person: o.person, tz: o.tz };
  const sinceIso = toIso(o.since);
  const sinceDate = sinceIso.slice(0, 10);

  /**
   * @param {string} step
   * @param {() => void} fn
   */
  const attempt = (step, fn) => {
    try {
      fn();
    } catch (e) {
      failures.push(`${step}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  };

  let me = "";
  attempt("user", () => {
    const u = getJson(o.gh, "user");
    me = isRecord(u) ? str(u.login) : "";
    if (me === "") throw new Error("login を取得できない");
  });

  /** @type {{ number: number; branch: string; author: string; sha: string; closedAt: number | null }[]} */
  const prs = [];
  /** @type {Set<number>} */
  const seenPrs = new Set();
  // 更新されていない open な PR（レビューを待ち続けている）も取得し、待ちの終わりを今の時刻まで延ばす
  for (const q of [`repo:${o.slug} is:pr updated:>=${sinceDate}`, `repo:${o.slug} is:pr is:open`])
    attempt(q.includes("is:open") ? "pulls (open)" : "pulls", () => {
      const pages = JSON.parse(
        o
          .gh(["graphql", "--paginate", "--slurp", "-f", `query=${PR_QUERY}`, "-f", `q=${q}`], {})
          .toString("utf8"),
      );
      if (!isArray(pages)) throw new Error("GraphQL の応答がページの配列でない");
      for (const page of pages) {
        const search =
          isRecord(page) && isRecord(page.data) && isRecord(page.data.search)
            ? page.data.search
            : null;
        if (!search || !isArray(search.nodes))
          throw new Error("GraphQL の応答に search.nodes が無い");
        for (const node of search.nodes) {
          if (!isRecord(node) || typeof node.number !== "number") continue;
          if (seenPrs.has(node.number)) continue;
          seenPrs.add(node.number);
          const pr = {
            number: node.number,
            branch: str(node.headRefName),
            author: loginOf(node.author),
            sha: str(node.headRefOid),
            closedAt: parseTime(node.closedAt),
          };
          prs.push(pr);
          const tl = isRecord(node.timelineItems) ? node.timelineItems : {};
          const more = isRecord(tl.pageInfo) && tl.pageInfo.hasNextPage === true;
          // 100 件を超える timeline は、その PR だけ REST でページングして再取得する
          const items = more
            ? getAll(
                o.gh,
                `repos/${o.slug}/issues/${pr.number}/timeline?per_page=100`,
                (x) => x,
              ).flatMap(fromRestEvent)
            : isArray(tl.nodes)
              ? tl.nodes.flatMap(fromGraphqlItem)
              : [];
          rows.push(...timelineRows(pr, items, me, o));
        }
      }
    });

  attempt("actions/runs", () => {
    rows.push(...actionRuns(o, o.since, o.now));
    // since より前に始まって、まだ終わっていない run（end を今の時刻まで延ばす）
    for (const status of ["requested", "queued", "pending", "waiting", "in_progress"]) {
      const open = getAll(
        o.gh,
        `repos/${o.slug}/actions/runs?status=${status}&per_page=100`,
        (p) => (isRecord(p) ? p.workflow_runs : null),
      );
      rows.push(...runRows(open, o).filter((r) => (parseTime(r.start) ?? 0) < o.since));
    }
  });

  if (o.config.ci.external) {
    for (const pr of prs) {
      if (pr.sha === "") continue;
      attempt(`check-runs#${pr.number}`, () => {
        const checks = getAll(
          o.gh,
          `repos/${o.slug}/commits/${pr.sha}/check-runs?per_page=100`,
          (p) => (isRecord(p) ? p.check_runs : null),
        );
        for (const c of checks) {
          if (!isRecord(c)) continue;
          const app = isRecord(c.app) ? str(c.app.slug) : "";
          if (app === "github-actions") continue;
          // レビューツールの check run（copilot-pull-request-reviewer など）はレビュー待ちで数えるので、CI にしない
          if (
            toolOf(o.bundledTools, o.config.reviewTools, app) ||
            toolOf(o.bundledTools, o.config.reviewTools, str(c.name))
          )
            continue;
          const start = parseTime(c.started_at);
          if (start === null) continue;
          const end = parseTime(c.completed_at) ?? o.now;
          rows.push({
            key: `ci-ext:${num(c.id)}`,
            kind: "ci",
            ...base,
            agent: app || "external",
            start: toIso(start),
            end: toIso(end),
            branch: pr.branch,
            issue: issueOf(pr.branch),
            detail: `${str(c.name)};check-run`,
          });
        }
        const statuses = getAll(
          o.gh,
          `repos/${o.slug}/commits/${pr.sha}/statuses?per_page=100`,
          (p) => p,
        );
        /** @type {Map<string, { start: number; end: number | null }>} */
        const byContext = new Map();
        for (const s of statuses) {
          if (!isRecord(s)) continue;
          const at = parseTime(s.created_at);
          if (at === null) continue;
          const ctx = str(s.context);
          const cur = byContext.get(ctx) ?? { start: at, end: null };
          cur.start = Math.min(cur.start, at);
          if (str(s.state) !== "pending") cur.end = Math.max(cur.end ?? at, at);
          byContext.set(ctx, cur);
        }
        for (const [ctx, span] of byContext) {
          rows.push({
            key: `ci-status:${pr.sha}:${ctx}`,
            kind: "ci",
            ...base,
            agent: "external",
            start: toIso(span.start),
            end: toIso(span.end ?? o.now),
            branch: pr.branch,
            issue: issueOf(pr.branch),
            detail: `${ctx};status`,
          });
        }
      });
    }
  }

  attempt("artifacts", () => {
    const artifacts = ARTIFACT_NAMES.flatMap((name) =>
      getAll(o.gh, `repos/${o.slug}/actions/artifacts?name=${name}&per_page=100`, (p) =>
        isRecord(p) ? p.artifacts : null,
      ),
    );
    for (const a of artifacts) {
      if (!isRecord(a) || a.expired === true || typeof a.id !== "number") continue;
      const created = parseTime(a.created_at);
      if (created === null || created < o.since) continue;
      if (o.knownArtifacts?.has(a.id)) continue;
      const run = isRecord(a.workflow_run) ? a.workflow_run : {};
      const id = a.id;
      // 1 件が不正（zip や JSON が読めない）でも、残りの artifact は取得する
      attempt(`artifacts#${id}`, () => {
        const files = unzip(
          o.gh([`repos/${o.slug}/actions/artifacts/${id}/zip`], { binary: true }),
        );
        rows.push(
          ...artifactRows(
            files,
            { id, created, branch: str(run.head_branch), runId: num(run.id) },
            o,
          ),
        );
      });
    }
  });

  if (o.billing === "user" && me !== "") {
    for (let day = Date.parse(`${sinceDate}T00:00:00Z`); day <= o.now; day += 86400000) {
      const d = new Date(day);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const dd = d.getUTCDate();
      attempt(`billing ${toIso(day).slice(0, 10)}`, () => {
        const res = getJson(
          o.gh,
          `users/${me}/settings/billing/premium_request/usage?year=${y}&month=${m}&day=${dd}`,
        );
        const items = isRecord(res) && isArray(res.usageItems) ? res.usageItems : [];
        for (const it of items) {
          if (!isRecord(it)) continue;
          const date = toIso(day).slice(0, 10);
          rows.push({
            key: `billing:${o.person}:${date}:${str(it.product)}:${str(it.model)}:${str(it.sku)}`,
            kind: "billing",
            ...base,
            agent: str(it.product),
            model: str(it.model),
            start: `${date}T00:00:00.000Z`,
            end: `${date}T23:59:59.999Z`,
            cost_usd: fmt(num(it.netAmount), true),
            cost_source: "billing",
            detail: `sku=${str(it.sku)};quantity=${num(it.netQuantity)}`,
          });
        }
      });
    }
  }

  return { rows, failures };
}

/**
 * artifact の中身から、レビューの使用量の行を作る。中身の形は同梱の workflow の雛形が決める:
 *   meta.json                       { "tool": "...", "pr": 番号 }。
 *   claude-execution-output.json    Claude Code の Action の実行結果（SDK のメッセージの配列。最後の result が費用を持つ）。
 *   codex/**.jsonl                  Codex の Action のセッションのログ。
 * @param {Map<string, Buffer>} files
 * @param {{ id: number; created: number; branch: string; runId: number }} a
 * @param {GitHubOptions} o
 * @returns {Row[]}
 */
export function artifactRows(files, a, o) {
  const metaBuf = files.get("meta.json");
  const meta = metaBuf ? JSON.parse(metaBuf.toString("utf8")) : {};
  const tool = isRecord(meta) && typeof meta.tool === "string" ? meta.tool : "unknown";
  const pr = isRecord(meta) && typeof meta.pr === "number" ? meta.pr : 0;
  const base = {
    kind: "review",
    person: o.person,
    tz: o.tz,
    agent: tool,
    start: toIso(a.created),
    end: toIso(a.created),
    branch: a.branch,
    issue: issueOf(a.branch),
  };
  /** @type {Row[]} */
  const rows = [];
  const exec = files.get("claude-execution-output.json");
  if (exec) {
    const messages = JSON.parse(exec.toString("utf8"));
    const result = isArray(messages)
      ? messages.filter((m) => isRecord(m) && m.type === "result").pop()
      : null;
    if (isRecord(result) && isRecord(result.modelUsage)) {
      // 日付付きの名前と無い名前が同じモデルになるので、正規化した名前で合算する
      /** @type {Map<string, { input: number; cacheRead: number; cacheWrite: number; output: number; cost: number }>} */
      const byModel = new Map();
      for (const [model, u] of Object.entries(result.modelUsage)) {
        if (!isRecord(u)) continue;
        const name = normalizeModel(model);
        const cur = byModel.get(name) ?? {
          input: 0,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          cost: 0,
        };
        cur.input += num(u.inputTokens);
        cur.cacheRead += num(u.cacheReadInputTokens);
        cur.cacheWrite += num(u.cacheCreationInputTokens);
        cur.output += num(u.outputTokens);
        cur.cost += num(u.costUSD);
        byModel.set(name, cur);
      }
      for (const [model, u] of byModel) {
        rows.push({
          ...base,
          key: `review-artifact:${a.id}:${model}`,
          model,
          input_tokens: fmt(u.input),
          cache_read_tokens: fmt(u.cacheRead),
          cache_write_tokens: fmt(u.cacheWrite),
          output_tokens: fmt(u.output),
          cost_usd: fmt(u.cost, true),
          cost_source: "log",
          detail: `pr=${pr};source=artifact;run=${a.runId}`,
        });
      }
    }
  }
  for (const [name, buf] of files) {
    if (!name.startsWith("codex/") || !name.endsWith(".jsonl")) continue;
    const s = parseCodexLog(buf.toString("utf8"), name);
    /** @type {Map<string, { tokens: import("./pricing.mjs").Tokens; cost: number | null; source: string }>} */
    const byModel = new Map();
    for (const m of s.messages) {
      const { price, source } = resolvePrice(m.model, o.config.pricing, o.bundledPricing);
      const cur = byModel.get(m.model) ?? { tokens: zeroTokens(), cost: 0, source };
      addTokens(cur.tokens, m.tokens);
      cur.cost = price && cur.cost !== null ? cur.cost + costOf(m.tokens, price) : null;
      byModel.set(m.model, cur);
    }
    for (const [model, v] of byModel) {
      rows.push({
        ...base,
        key: `review-artifact:${a.id}:${name}:${model}`,
        model,
        input_tokens: fmt(v.tokens.input),
        cache_read_tokens: fmt(v.tokens.cacheRead),
        cache_write_tokens: fmt(v.tokens.cacheWrite5m + v.tokens.cacheWrite1h),
        output_tokens: fmt(v.tokens.output),
        reasoning_tokens: fmt(v.tokens.reasoning),
        cost_usd: v.cost === null ? "" : fmt(v.cost, true),
        cost_source: v.cost === null ? "unknown" : v.source,
        detail: `pr=${pr};source=artifact;run=${a.runId}`,
      });
    }
  }
  return rows;
}

/**
 * 人の commit の時刻（activity の行）。このマシンの reflog に残った commit の操作（`commit`・`commit (merge)` など）だけを数え、
 * エージェントの git の操作（commit・merge・rebase など）の直後のものは除く。
 * リモートから取った commit（他の環境のエージェントや GitHub の merge）は reflog の commit の操作にならないので、数えない。
 * @param {string} reflog `git log -g --all --date=iso-strict --format=%H%x00%gd%x00%gs%x1e` の出力
 * @param {readonly { ts: number; text: string }[]} commands
 * @param {{ person: string; tz: string; since: number }} o
 * @returns {Row[]}
 */
export function commitActivityRows(reflog, commands, o) {
  /** @type {Map<string, Row>} */
  const rows = new Map();
  for (const rec of reflog.split("\x1e")) {
    const [sha, selector, subject] = rec.trim().split("\x00");
    if (!sha || !selector || !subject) continue;
    if (!/^commit\b/.test(subject)) continue;
    const m = /@\{([^}]+)\}$/.exec(selector);
    const at = m ? parseTime(m[1]) : null;
    if (at === null || at < o.since) continue;
    if (
      nearAgentCommand(
        at,
        commands,
        /\bgit\b[^\n]*\b(?:commit|merge|rebase|cherry-pick|revert|pull|am)\b/,
        AGENT_COMMIT_AFTER_MS,
      )
    )
      continue;
    if (!rows.has(sha))
      rows.set(sha, {
        key: `activity:commit:${sha}`,
        kind: "activity",
        person: o.person,
        tz: o.tz,
        start: toIso(at),
        end: toIso(at),
        detail: "commit",
      });
  }
  return [...rows.values()];
}
