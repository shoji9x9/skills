#!/usr/bin/env node
// agent-usage のコマンドの起点。スキルのディレクトリに置いたまま実行する（利用者のプロジェクトへコピーしない）。
//
// 使い方:
//   agent-usage.mjs setup [--person-id <p-xxxxxxxx>] [--time-zone <IANA 名>] [--billing none|user]。
//   agent-usage.mjs collect [--stage] [--no-github]。
//   agent-usage.mjs decline。
//   agent-usage.mjs report [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--out <dir>]。
//   agent-usage.mjs status。
//   agent-usage.mjs gate --agent <claude-code|codex>      （PreToolUse の Hook から呼ぶ。stdin に Hook の JSON）。
//
// 終了コード: 0 = 成功（gate は「通す」）、1 = 失敗、2 = 引数の誤り（stderr に usage を出す）か、gate が止める。

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_NAME,
  PERSON_ID_RE,
  defaultDecisionOf,
  hasPerson,
  loadUserConfig,
  newPersonId,
  saveUserConfig,
  userConfigPath,
  userLayerTimeZone,
} from "./lib/config.mjs";
import { configPaths } from "./skill-config/skill-config.mjs";
import { decisionFor, saveDecision } from "./lib/decisions.mjs";
import { gateDecision, readHookInput } from "./lib/gate.mjs";
import { branchMerged } from "./lib/merged.mjs";
import { git, isDecisionBranch, repoInfo } from "./lib/repo.mjs";
import { usageDir } from "./lib/records.mjs";
import { runCollect } from "./lib/run-collect.mjs";
import { runReport } from "./lib/report/report.mjs";
import { isValidTimeZone, parseTime, systemTimeZone } from "./lib/time.mjs";

const SCRIPT = fileURLToPath(import.meta.url);

/** 引数の誤りのときに stderr に出す使い方。 */
const USAGE = [
  "usage: agent-usage.mjs setup [--person-id <p-xxxxxxxx>] [--time-zone <IANA 名>] [--billing none|user]",
  "       agent-usage.mjs collect [--stage] [--no-github]",
  "       agent-usage.mjs decline",
  "       agent-usage.mjs report [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--out <dir>]",
  "       agent-usage.mjs status",
  "       agent-usage.mjs gate --agent <claude-code|codex>",
].join("\n");

/**
 * @param {string[]} args
 * @param {readonly string[]} flags 値を取らない引数
 * @param {readonly string[]} options 値を取る引数
 * @returns {{ flags: Set<string>; options: Map<string, string> }}
 */
function parseArgs(args, flags, options) {
  const out = { flags: new Set(), options: new Map() };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (flags.includes(a)) out.flags.add(a);
    else if (options.includes(a)) {
      const v = args[i + 1];
      if (v === undefined || v === "") throw new UsageError(`${a} に値が無い`);
      if (out.options.has(a)) throw new UsageError(`${a} が 2 回ある`);
      out.options.set(a, v);
      i += 1;
    } else throw new UsageError(`知らない引数: ${a}`);
  }
  return out;
}

class UsageError extends Error {}

/**
 * @param {string} cwd
 */
function requireSetup(cwd) {
  const repo = repoInfo(cwd);
  if (!existsSync(usageDir(repo.root))) {
    throw new Error(`${usageDir(repo.root)} が無い。先に setup を実行する`);
  }
  return repo;
}

/**
 * @param {import("./lib/run-collect.mjs").CollectReport} r
 */
function printCollect(r) {
  if (r.personCreated) console.log(`人の ID を作った: ${r.person}（${userConfigPath()}）`);
  console.log(
    `人: ${r.person} / セッション: ${r.sessions}（解析し直し ${r.parsed}） / 新しい行: ${r.newRows}`,
  );
  for (const f of r.written) console.log(`書いた: ${f}`);
  if (r.invalidLines > 0) console.log(`読めなかったログの行: ${r.invalidLines}`);
  if (r.skippedFiles > 0)
    console.log(`範囲より古いので読まなかった記録のファイル: ${r.skippedFiles}`);
  if (r.olderRowsSkipped > 0)
    console.log(`開始時刻が範囲より古いので書かなかった行: ${r.olderRowsSkipped}`);
  if (r.retractedRows > 0)
    console.log(`打ち消した行（ログはあるが、今は作らなくなった行）: ${r.retractedRows}`);
  if (r.duplicateMessages > 0)
    console.log(`別のセッションと重複したので数えなかった応答: ${r.duplicateMessages}`);
  if (r.keyConflicts > 0)
    console.log(`警告: 同じ key で内容の違う行が ${r.keyConflicts} 件あった（最初の行を記録した）`);
  if (r.githubSkipped) console.log(`GitHub: 取得していない（${r.githubSkipReason}）`);
  for (const f of r.githubFailures)
    console.log(`GitHub の取得に失敗（この期間の停止は「判定不能」になる）: ${f}`);
}

/**
 * status に出すブランチの判断。判断が無ければ、コミットの前の確認が従う defaultDecision と、その出所を添える。
 * 設定を読めなくても、status の他の行は出したいので、理由を文字列にして返す。
 * 見る順（.agent-usage/ の有無、対象のブランチか、ブランチの判断、defaultDecisionOf）は、gate.mjs の gateDecision と同じにする。
 * @param {import("./lib/repo.mjs").RepoInfo} repo
 * @param {boolean} set
 * @returns {string}
 */
function branchDecisionText(repo, set) {
  if (!set) return "対象外（.agent-usage/ が無いので、コミットの前の確認は何もしない）";
  if (!isDecisionBranch(repo))
    return "対象外（デフォルトブランチなので、コミットの前の確認は何もしない）";
  /** @type {import("./lib/decisions.mjs").Decision | null} */
  let decided;
  try {
    decided = decisionFor(repo.commonDir, repo.branch);
  } catch (e) {
    return `判断の記録を読めない: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (decided === "record") {
    // gateDecision と同じく、判断が「記録する」でも人の設定が無ければ止め、人ごとの設定を読めなければその理由を出す
    try {
      if (!hasPerson())
        return "record（人の設定が無いので、コミットの前の確認は止めて setup を求める）";
    } catch (e) {
      return `record（設定を読めない: ${e instanceof Error ? e.message : String(e)}）`;
    }
    return `record${mergedNote(repo)}`;
  }
  if (decided !== null) return decided;
  try {
    const fallback = defaultDecisionOf(repo.root);
    if (fallback === null) return "未決定";
    // gateDecision と同じく、人の設定が無ければ defaultDecision を当てずに止める
    if (!hasPerson())
      return `未決定（defaultDecision: ${fallback.decision}、${fallback.source}。人の設定が無いので、コミットの前の確認は止めて setup を求める）`;
    const merged = fallback.decision === "record" ? mergedNote(repo) : "";
    return `未決定（defaultDecision: ${fallback.decision}、${fallback.source}）${merged}`;
  } catch (e) {
    return `未決定（設定を読めない: ${e instanceof Error ? e.message : String(e)}）`;
  }
}

/**
 * 記録する側のブランチが merge 済みなら、コミットの前の確認が記録しないことを添える（gateDecision と同じ判定）。
 * @param {import("./lib/repo.mjs").RepoInfo} repo
 * @returns {string}
 */
function mergedNote(repo) {
  const m = branchMerged(repo, process.env);
  return m.merged ? `（merge 済み（${m.how}）なので、コミットの前の確認は記録しない）` : "";
}

/**
 * コマンドに渡す、引数以外の値。
 * @typedef {object} CommandContext
 * @property {string} cwd
 * @property {number} now
 */

/**
 * @param {string[]} rest
 * @param {CommandContext} context
 * @returns {number}
 */
function setupCommand(rest, context) {
  const a = parseArgs(rest, [], ["--person-id", "--time-zone", "--billing"]);
  const repo = repoInfo(context.cwd);
  // 引数を確かめる前に人の設定を作らない。打ち間違いで止まったときに、乱数の ID の設定が残らないようにする
  const config = loadUserConfig(repo.root);
  const created = config === null;
  const personId = a.options.get("--person-id") ?? config?.personId ?? newPersonId();
  if (!PERSON_ID_RE.test(personId))
    throw new UsageError("--person-id は p- と 16 進数 8 桁の形にする");
  // config.timeZone は .local.jsonc の値のことがあるので使わない（人ごとの層へ書き写すと、他のリポジトリの記録の日付まで変わる）
  const timeZone = a.options.get("--time-zone") ?? userLayerTimeZone() ?? systemTimeZone();
  if (!isValidTimeZone(timeZone))
    throw new UsageError("--time-zone は IANA のタイムゾーンの名前にする");
  const billing = a.options.get("--billing") ?? config?.billing ?? "none";
  if (billing !== "none" && billing !== "user")
    throw new UsageError("--billing は none か user にする");
  // 書くのは人ごとの層の 3 つのキーだけで、defaultDecision など他のキーは変えない
  const path = saveUserConfig(repo.root, process.env, { personId, timeZone, billing });
  const dir = usageDir(repo.root);
  mkdirSync(join(dir, "records"), { recursive: true });
  // .agent-usage/ を commit できるよう、空のファイルを置く。.agent-usage/ があることがこのリポジトリでスキルを使う印なので、
  // commit されないと、clone した先や worktree では Hook が何もしない
  const keep = join(dir, "records", ".gitkeep");
  if (!existsSync(keep)) writeFileSync(keep, "");
  console.log(`${created ? "作った" : "更新した"}: ${path}`);
  console.log(`人の ID: ${personId} / タイムゾーン: ${timeZone} / 課金 API: ${billing}`);
  console.log(
    `リポジトリの設定: ${configPaths(repo.root, CONFIG_NAME, process.env).repo}（無ければデフォルト）`,
  );
  console.log(`Hook のスクリプト: ${join(SCRIPT, "..", "precommit-gate.sh")}`);
  return 0;
}

/**
 * @param {string[]} rest
 * @param {CommandContext} context
 * @returns {number}
 */
function collectCommand(rest, context) {
  const { now } = context;
  const a = parseArgs(rest, ["--stage", "--no-github"], []);
  const repo = requireSetup(context.cwd);
  const r = runCollect({
    repo,
    now,
    env: process.env,
    github: !a.flags.has("--no-github"),
    gh: null,
  });
  printCollect(r);
  if (a.flags.has("--stage")) {
    if (r.written.length > 0) git(["add", "--", ...r.written], repo.root);
    if (repo.branch !== "")
      saveDecision(repo.commonDir, { branch: repo.branch, decision: "record", now });
  }
  return 0;
}

/**
 * @param {string[]} rest
 * @param {CommandContext} context
 * @returns {number}
 */
function declineCommand(rest, context) {
  parseArgs(rest, [], []);
  const repo = requireSetup(context.cwd);
  if (repo.branch === "") throw new Error("ブランチの上にいない（detached HEAD）");
  saveDecision(repo.commonDir, { branch: repo.branch, decision: "decline", now: context.now });
  console.log(`${repo.branch}: 記録しない（このブランチでは確認しない）`);
  return 0;
}

/**
 * @param {string[]} rest
 * @param {CommandContext} context
 * @returns {number}
 */
function statusCommand(rest, context) {
  parseArgs(rest, [], []);
  const repo = repoInfo(context.cwd);
  const set = existsSync(usageDir(repo.root));
  console.log(`セットアップ: ${set ? "済み" : "未"}（${usageDir(repo.root)}）`);
  console.log(
    `ブランチ: ${repo.branch || "(detached)"} / デフォルトブランチ: ${repo.defaultBranch ?? "(不明)"}`,
  );
  console.log(`このブランチの判断: ${repo.branch ? branchDecisionText(repo, set) : "-"}`);
  const path = userConfigPath();
  console.log(
    `人の設定: ${existsSync(path) ? readFileSync(path, "utf8").trim().replace(/\s+/g, " ") : "(無い)"}`,
  );
  return 0;
}

/**
 * @param {string[]} rest
 * @param {CommandContext} context
 * @returns {number}
 */
function reportCommand(rest, context) {
  const a = parseArgs(rest, [], ["--since", "--until", "--out"]);
  const repo = requireSetup(context.cwd);
  const out = runReport({
    root: repo.root,
    now: context.now,
    env: process.env,
    since: a.options.get("--since") ?? null,
    until: a.options.get("--until") ?? null,
    out: a.options.get("--out") ?? null,
  });
  for (const f of out.files) console.log(`書いた: ${f}`);
  console.log(`行: ${out.rows}（重複を除いた後） / 期間: ${out.period}`);
  return 0;
}

/**
 * @param {string[]} rest
 * @param {CommandContext} context
 * @returns {number}
 */
function gateCommand(rest, context) {
  const a = parseArgs(rest, [], ["--agent"]);
  const agent = a.options.get("--agent") ?? "claude-code";
  const input = readHookInput(readFileSync(0, "utf8"));
  const verdict = gateDecision(input, {
    fallbackCwd: context.cwd,
    now: context.now,
    script: SCRIPT,
    agent,
  });
  if (verdict.message) process.stderr.write(`${verdict.message}\n`);
  return verdict.exit;
}

/** @type {ReadonlyMap<string, (rest: string[], context: CommandContext) => number>} */
const COMMANDS = new Map([
  ["setup", setupCommand],
  ["collect", collectCommand],
  ["decline", declineCommand],
  ["status", statusCommand],
  ["report", reportCommand],
  ["gate", gateCommand],
]);

/**
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {number}
 */
export function main(argv, cwd = process.cwd()) {
  const [cmd, ...rest] = argv;
  const now = process.env.AGENT_USAGE_NOW ? parseTime(process.env.AGENT_USAGE_NOW) : Date.now();
  if (now === null) throw new UsageError("AGENT_USAGE_NOW が時刻でない");
  const command = cmd === undefined ? undefined : COMMANDS.get(cmd);
  if (command === undefined) throw new UsageError(`知らないコマンド: ${cmd ?? "(無し)"}`);
  return command(rest, { cwd, now });
}

/**
 * 直接起動されたか。シンボリックリンク（.claude/skills/<name> など）から起動されても一致するよう、両辺の実体のパスで比べる。
 * @returns {boolean}
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`agent-usage: ${e instanceof Error ? e.message : String(e)}\n`);
    if (process.argv[2] === "gate") {
      // Hook の exit 2 は「止める」なので、確認の処理の誤り（環境の AGENT_USAGE_NOW など）ではコミットを止めない
      process.stderr.write("agent-usage: 確認の処理が失敗したので、確認をせずに通します\n");
      process.exitCode = 0;
    } else {
      if (e instanceof UsageError) process.stderr.write(`${USAGE}\n`);
      process.exitCode = e instanceof UsageError ? 2 : 1;
    }
  }
}
