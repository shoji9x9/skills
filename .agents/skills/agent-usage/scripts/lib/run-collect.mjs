// collect の全体: ローカルのログ・人の commit・GitHub から行を作り、まだ記録していない行を records/ に書く。

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.mjs";
import { fileURLToPath } from "node:url";
import { isRecord, loadOrCreateUserConfig, loadRepoConfig } from "./config.mjs";
import { collectLocal } from "./collect.mjs";
import { collectGitHub, commitActivityRows, makeGh, withoutEnvTokens } from "./github.mjs";
import { loadBundledPricing, loadBundledReviewPricing } from "./pricing.mjs";
import { signature } from "./rows.mjs";
import {
  BRANCH_DIR,
  GITHUB_DIR,
  GITHUB_KINDS,
  appendBranchFile,
  branchFiles,
  branchLabel,
  changedRows,
  fileStamp,
  fileStampTime,
  latestByKey,
  readRecords,
  usageDir,
} from "./records.mjs";
import { defaultBranches, gitOrNull } from "./repo.mjs";
import { parseTime, toIso } from "./time.mjs";
import { rememberWorktrees } from "./worktrees.mjs";
import { join, relative, sep } from "node:path";

/** @typedef {import("./rows.mjs").Row} Row */
/** @typedef {import("./repo.mjs").RepoInfo} RepoInfo */
/** @typedef {import("./github.mjs").GhRunner} GhRunner */

/** 前回の取得の終わりから、さかのぼって再取得する幅（投稿や artifact の反映の遅れを拾うため）。重なった分は key で除く。 */
export const GITHUB_OVERLAP_MS = 86400000;

/** 初めての取得でさかのぼる上限（ローカルのログの最初の時刻がこれより古くても、ここまでにする）。 */
export const GITHUB_FIRST_LOOKBACK_MS = 60 * 86400000;

/**
 * collect が読む記録と、書く行の範囲。ファイル名の時刻と最後の行の observed_at がどちらもこれより古いファイルは、重複を除くときに読まない。
 * 読む行数を記録の総量に依らず一定にするため。GitHub を初めて取る範囲と揃え、前回の取得の期間（coverage）が範囲に入るようにする。
 * この人が範囲の中で collect していない（久しぶりの collect か初めての collect）ときは、ログに残る分をすべて書く。
 */
export const RECORD_WINDOW_MS = GITHUB_FIRST_LOOKBACK_MS;

/** ログから作る行の種類（ログが今もあるのに作らなくなったら、打ち消す）。 */
const RETRACTABLE_KINDS = ["usage", "run", "human-wait", "prompt"];

/**
 * この clone で人ごとに最後に collect した時刻の置き場所（git の共通のディレクトリ。clone ごとに別で、commit しない）。
 * @param {string} commonDir
 * @returns {string}
 */
export function lastCollectPath(commonDir) {
  return join(commonDir, "agent-usage", "last-collect.json");
}

/**
 * @param {string} path
 * @param {string} person
 * @param {number} now
 * @returns {number | null} 読めなければ null（範囲の中で collect していないとして扱い、行をすべて書く）
 */
function loadLastCollect(path, person, now) {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const t = isRecord(raw) && typeof raw[person] === "string" ? parseTime(raw[person]) : null;
    // 今より後の時刻（時計が進んでいたときに保存した値）は信じない
    return t !== null && t <= now ? t : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @param {string} person
 * @param {number} now
 */
function saveLastCollect(path, person, now) {
  /** @type {Record<string, unknown>} */
  let raw = {};
  if (existsSync(path)) {
    try {
      const v = JSON.parse(readFileSync(path, "utf8"));
      if (isRecord(v)) raw = v;
    } catch {
      // JSON として読めなければ作り直す（読めないときは、次の collect がすべての行を書くだけ）
    }
  }
  writeFileAtomic(path, `${JSON.stringify({ ...raw, [person]: toIso(now) }, null, 2)}\n`);
}

/**
 * 使用量の行のトークン数の合計（打ち消してよいかを、作り直した行と比べるのに使う）。
 * @param {readonly Row[]} rows
 * @returns {number}
 */
function tokenTotal(rows) {
  let n = 0;
  for (const r of rows)
    for (const c of /** @type {const} */ ([
      "input_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "output_tokens",
    ]))
      n += Number(r[c] ?? 0) || 0;
  return n;
}

/**
 * 作らなくなった記録済みの行（stale）のうち、打ち消してよい行を打ち消しの行にして返す。
 * run・human-wait・prompt はメインのログだけから作るので、開始時刻が書く範囲の中なら打ち消す。
 * cost-state の使用量の行（そのモデルが応答に現れると作らなくなる）も、key に時刻を持たず区切り方で変わらないので、同じに扱う。
 * usage はメインのセッションにまとめたサブエージェントのログも材料にし、区切り方が変わると key が変わる。
 * そこで、セッションとモデルごとに、次をすべて満たすときだけ、そのまとまりの記録済みの行を打ち消す。
 * 作り直した行がすべて書かれるか記録済みで（範囲の下限より古くて書かれない行が無い）、
 * 作り直した行の合計が記録済みの合計より少なくない（ログが欠けていない）こと。
 * 打ち消さないまとまりでは、作らなくなった行と時間が重なる新しい行を書かない（withheld）。両方を数えて二重にしないため。
 * @param {readonly Row[]} stale
 * @param {Map<string, Row>} existing
 * @param {Map<string, Row>} unique 今の collect で作った行（key ごと）
 * @param {{ person: string; lowerBound: number; canonical: (p: string | undefined) => string }} o
 * @returns {{ rows: Row[]; withheld: Set<string> }}
 */
export function retractableRows(stale, existing, unique, o) {
  /** @type {Row[]} */
  const rows = [];
  /** @type {Set<string>} */
  const withheld = new Set();
  const groupOf = (/** @type {Row} */ r) =>
    `${r.agent ?? ""}\u0000${r.session ?? ""}\u0000${r.model ?? ""}`;
  /** @type {Map<string, Row[]>} */
  const usageStale = new Map();
  for (const r of stale) {
    if (r.kind === "usage" && r.detail !== "cost-state") {
      const g = groupOf(r);
      usageStale.set(g, [...(usageStale.get(g) ?? []), r]);
      continue;
    }
    const start = parseTime(r.start);
    if (start !== null && start >= o.lowerBound) rows.push({ ...r, retracted: "1" });
  }
  for (const [g, old] of usageStale) {
    /** @param {Row} r */
    const inGroup = (r) => r.kind === "usage" && r.detail !== "cost-state" && groupOf(r) === g;
    const rebuilt = [...unique.values()].filter(inGroup);
    const recorded = [...existing.values()].filter(
      (r) => inGroup(r) && r.retracted !== "1" && o.canonical(r.person) === o.person,
    );
    const written = rebuilt.every(
      (r) => existing.has(r.key ?? "") || (parseTime(r.start) ?? 0) >= o.lowerBound,
    );
    if (written && tokenTotal(rebuilt) >= tokenTotal(recorded)) {
      for (const r of old) rows.push({ ...r, retracted: "1" });
      continue;
    }
    for (const r of rebuilt) {
      if (existing.has(r.key ?? "")) continue;
      const s = parseTime(r.start);
      const e = parseTime(r.end);
      if (s === null || e === null) continue;
      const overlaps = old.some((x) => {
        const xs = parseTime(x.start);
        const xe = parseTime(x.end);
        return xs !== null && xe !== null && s < xe && xs < e;
      });
      if (overlaps) withheld.add(r.key ?? "");
    }
  }
  return { rows, withheld };
}

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
 * @typedef {object} GitHubTarget
 * @property {string} reason GitHub として扱わない理由（扱うなら空）
 * @property {string} host
 * @property {string} slug `<owner>/<name>`
 * @property {boolean} viaLogin gh へのログインで GitHub と判定した（GH_ENTERPRISE_TOKEN を問い合わせに使わない）
 */

/**
 * origin を GitHub として扱うかを決める。
 * GitHub として扱うのは、`<ホスト>/<owner>/<name>` の形で、ホストが github.com・GH_HOST・gh にログインしたホストのどれかのとき。
 * GitHub Enterprise のホストは、`gh auth login --hostname <ホスト>` でログインしていれば、GH_HOST が無くても取得する。
 * @param {string} remote `<ホスト>/<パス>` の形の origin（無ければ空）
 * @param {NodeJS.ProcessEnv} env
 * @param {(host: string) => string} loginError ログインしていれば空、していなければその理由を返す
 * @returns {GitHubTarget}
 */
export function githubTarget(remote, env, loginError) {
  const parts = remote.split("/");
  const [host = "", owner = "", name = ""] = parts;
  const t = { reason: "", host, slug: `${owner}/${name}`, viaLogin: false };
  if (remote === "") return { ...t, reason: "origin が無い" };
  if (parts.length !== 3 || !host || !owner || !name)
    return { ...t, reason: `origin（${remote}）が <ホスト>/<owner>/<name> の形でない` };
  // 利用者が GH_HOST で指定したホストは、ポート付き（https の非標準ポートの GHES）でもそのまま扱う
  if (host === "github.com" || host === (env.GH_HOST ?? "").toLowerCase()) return t;
  // ポートを含むホスト（ssh://git@<ホスト>:7999/...）は SSH のポートでありうるので、gh のホストとしてログインを確かめない
  const err = loginError(host);
  if (err === "") return { ...t, viaLogin: true };
  // ポート付きのホストにログインしていなければ、SSH のポートでありうるので、ログインを勧めない
  if (host.includes(":"))
    return {
      ...t,
      reason: `origin のホスト ${host} はポートを含み、gh にログインしたホストでもないので取得しない（SSH のポートなら API のホストではない。https の非標準ポートで API を提供する GHES なら GH_HOST=${host} で取得する）`,
    };
  return {
    ...t,
    reason: `origin のホスト ${host} は、github.com でも GH_HOST でもなく、gh にログインしたホストでもない（${err}）。GitHub Enterprise のホストなら gh auth login --hostname ${host} か GH_HOST=${host} で取得する`,
  };
}

/**
 * gh がそのホストにログインしているか（`gh auth login --hostname` で保存した token があるか）を確かめ、していなければ理由を返す。
 * `gh auth token` はネットワークに問い合わせない。参考: https://cli.github.com/manual/gh_auth_token
 * 環境変数の token（GH_TOKEN・GITHUB_TOKEN・GH_ENTERPRISE_TOKEN・GITHUB_ENTERPRISE_TOKEN）は外して確かめる。
 * gh は GH_ENTERPRISE_TOKEN を github.com 以外のすべてのホストの token として返す（gh 2.93.0 で実測）。
 * 残すと GitLab などの origin も GitHub として扱い、その token を送ってしまう。
 * @param {string} host
 * @param {NodeJS.ProcessEnv} env GH_HOST の判定と同じ環境変数で確かめる
 * @returns {string}
 */
function ghLoginError(host, env) {
  const r = spawnSync("gh", ["auth", "token", "--hostname", host], {
    env: withoutEnvTokens(env),
    // ネットワークに問い合わせないので通常は数十 ms で終わる。keyring が応答しないときに、コミットを長く止めない
    timeout: 5000,
    // stdout は token なので読まない。stderr は失敗の理由として出す
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr = (r.stderr?.toString("utf8") ?? "").trim().split("\n")[0] ?? "";
  if (r.error && "code" in r.error && r.error.code === "ETIMEDOUT")
    return "gh auth token が 5 秒以内に終わらない（keyring の応答を確かめる）";
  if (r.error) return `gh を起動できない: ${r.error.message}`;
  if (/unknown command/i.test(stderr)) return `gh に auth token が無い（gh を更新する）: ${stderr}`;
  if (r.status !== 0) return `gh auth token が失敗した: ${stderr || `exit ${r.status}`}`;
  return "";
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
 * @property {string} githubSkipReason GitHub を取得しなかった理由（取得したなら空）
 * @property {number} keyConflicts 同じ key で内容の違う行の数（0 でなければ行の作り方の不具合）
 * @property {number} skippedFiles 範囲より古いので読まなかった記録のファイルの数
 * @property {number} olderRowsSkipped 開始時刻が範囲より古いので書かなかった行の数
 * @property {number} retractedRows 打ち消した行の数
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
  const recordsDir = join(dir, "records");
  const label = repo.branch ? branchLabel(repo.branch) : "detached";
  const personDir = join(recordsDir, person, BRANCH_DIR);
  const githubDir = join(recordsDir, GITHUB_DIR, person);
  const windowStart = now - RECORD_WINDOW_MS;
  // 書き足す先は、このブランチのファイルのうち最も新しいもの。ただし、デフォルトブランチ（origin）に既に入ったファイルには足さず、
  // 新しいファイルを作る。squash merge の後に同じブランチで作業を続けて足すと、デフォルトブランチを取り込むときに add/add で競合するため
  const defaults = defaultBranches(repo);
  // 今のブランチがデフォルトブランチ自身なら、足しても add/add の競合は起きないので、同じファイルに足し続ける
  const onDefault = defaults.includes(repo.branch);
  /** @param {string} f */
  const published = (f) =>
    !onDefault &&
    defaults.some(
      (b) =>
        gitOrNull(
          [
            "cat-file",
            "-e",
            `refs/remotes/origin/${b}:${relative(repo.root, f).split(sep).join("/")}`,
          ],
          repo.root,
        ) !== null,
    );
  const personFiles = branchFiles(personDir, label);
  const githubFiles = branchFiles(githubDir, label);
  // 範囲に関わらず読むのは、書き足す候補（このブランチの最後のファイル）だけ。前のファイルは範囲の判定に任せる
  /** @type {Set<string>} */
  const keep = new Set();
  for (const f of [personFiles.at(-1), githubFiles.at(-1)]) if (f !== undefined) keep.add(f);
  /**
   * 書き足す先。git を起動するので、書く行があるときだけ呼ぶ
   * @param {string} d
   * @param {readonly string[]} files
   */
  const appendTarget = (d, files) => {
    const last = files[files.length - 1];
    if (last !== undefined && !published(last)) return last;
    // 新しいファイルは、デフォルトブランチに入ったファイル（このブランチの最後のファイル）より後に並べる。
    // 他のマシンの時計が進んでいて、そのファイルの時刻が今より後でも、次の collect が新しいファイルを書き足す先に選ぶようにする
    const t = last === undefined ? now : Math.max(now, (fileStampTime(last) ?? now) + 1000);
    return join(d, `${fileStamp(t)}-${label}.csv`);
  };
  const lastPath = lastCollectPath(repo.commonDir);
  const last = loadLastCollect(lastPath, person, now);
  const collectedInWindow = last !== null && last >= windowStart;
  // 範囲の中で collect していなければ（この版にした後の最初の collect・新しい clone）、範囲より古い行もすべて書くので、
  // 記録も全体を読み、記録済みの行を重ねて書かない
  const read = collectedInWindow
    ? readRecords(recordsDir, { since: windowStart, keep })
    : readRecords(recordsDir);
  const existing = latestByKey(read.rows);
  // 範囲より古い行は、範囲の外のファイルにあって読んでいないので、書くと重複する。
  // この clone で範囲の中に collect していなければ、前回の collect から範囲の始まりまでの行を取りこぼさないよう、すべて書く
  // （重複は report が key でまとめる）。記録の行では決めない。別のマシン（clone）の行が範囲の中にあっても、
  // このマシンのログにある古い行はまだ書いていないことがあるため
  const lowerBound = collectedInWindow ? windowStart : Number.NEGATIVE_INFINITY;

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
  /** @type {GitHubTarget} */
  const target = o.github
    ? githubTarget(repo.remote, env, (h) => ghLoginError(h, env))
    : { reason: "--no-github", host: "", slug: "", viaLogin: false };
  const githubSkipReason = target.reason;
  const githubSkipped = githubSkipReason !== "";
  if (!githubSkipped) {
    // ログインで判定したホストには、保存した token で問い合わせ、環境変数の token（別のホスト用でありうる）を送らない
    const gh = o.gh ?? makeGh(target.host, target.viaLogin ? withoutEnvTokens(env) : env);
    const res = collectGitHub({
      slug: target.slug,
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
  // 打ち消し: ログが今もあるセッションの記録済みの行のうち、今の collect で作らなくなった行は、打ち消しの行（retracted=1）を書いて、
  // report が数えないようにする。ログが消えたセッションの行は、作れないだけなので打ち消さない。人の commit と GitHub の行は、ログから作らないので対象にしない。
  // サブエージェントとして記録した行は、サブエージェントのログだけが先に消えることがあるので打ち消さない。
  /** @param {string | undefined} p */
  const canonical = (p) => (p ? (repoConfig.aliases[p] ?? p) : "");
  /** @type {Row[]} */
  const stale = [];
  for (const r of existing.values()) {
    if (canonical(r.person) !== person || r.retracted === "1") continue;
    if (!RETRACTABLE_KINDS.includes(r.kind ?? "") || r.subagent === "1") continue;
    if (!local.presentSessions.has(`${r.agent ?? ""}:${r.session ?? ""}`)) continue;
    if (unique.has(r.key ?? "")) continue;
    stale.push(r);
  }
  const { rows: retractions, withheld } = retractableRows(stale, existing, unique, {
    person,
    lowerBound,
    canonical,
  });
  // 既に読んだ key の行は、前の内容と比べられるので、範囲より古くても内容が変わっていれば書く
  let olderRowsSkipped = 0;
  const fresh = changedRows([...unique.values()], existing).filter((r) => {
    if (existing.has(r.key ?? "")) return true;
    // 打ち消せない前の区切りの行と時間が重なる行は、書くと二重に数えるので書かない
    if (withheld.has(r.key ?? "")) return false;
    // GitHub の行は取得の範囲（since）で決まり、その前に始まった区間（実行中の CI・レビュー待ち）も意図して書く
    if (GITHUB_KINDS.includes(r.kind ?? "")) return true;
    const t = parseTime(r.start);
    if (t === null || t >= lowerBound) return true;
    olderRowsSkipped += 1;
    return false;
  });
  const observed = toIso(now);
  for (const r of fresh) r.observed_at = observed;
  // 打ち消しの行は、元の行より新しい observed_at にする（他のマシンの時計が進んでいて、元の行が今より後でも打ち消せるように）
  for (const r of retractions)
    r.observed_at = toIso(Math.max(now, (parseTime(r.observed_at) ?? now) + 1000));
  fresh.push(...retractions);
  const personRows = fresh.filter((r) => !GITHUB_KINDS.includes(r.kind ?? ""));
  const githubRows = fresh.filter((r) => GITHUB_KINDS.includes(r.kind ?? ""));
  /** @type {string[]} */
  const written = [];
  if (personRows.length > 0)
    written.push(appendBranchFile(appendTarget(personDir, personFiles), personRows));
  if (githubRows.length > 0)
    written.push(appendBranchFile(appendTarget(githubDir, githubFiles), githubRows));
  saveLastCollect(lastPath, person, now);
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
    githubSkipReason,
    keyConflicts: conflicts,
    skippedFiles: read.skipped,
    olderRowsSkipped,
    retractedRows: retractions.length,
  };
}
