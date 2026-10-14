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
  PERSON_ID_RE,
  loadOrCreateUserConfig,
  parseUserConfig,
  saveUserConfig,
  userConfigPath,
} from "./lib/config.mjs";
import { decisionFor, saveDecision } from "./lib/decisions.mjs";
import { gateDecision, readHookInput } from "./lib/gate.mjs";
import { git, repoInfo } from "./lib/repo.mjs";
import { usageDir } from "./lib/records.mjs";
import { runCollect } from "./lib/run-collect.mjs";
import { runReport } from "./lib/report.mjs";
import { isValidTimeZone, parseTime } from "./lib/time.mjs";

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
  if (r.duplicateMessages > 0)
    console.log(`別のセッションと重複したので数えなかった応答: ${r.duplicateMessages}`);
  if (r.keyConflicts > 0)
    console.log(`警告: 同じ key で内容の違う行が ${r.keyConflicts} 件あった（最初の行を記録した）`);
  if (r.githubSkipped)
    console.log("GitHub: 取得していない（--no-github か、origin が GitHub の形でない）");
  for (const f of r.githubFailures)
    console.log(`GitHub の取得に失敗（この期間の停止は「判定不能」になる）: ${f}`);
}

/**
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {number}
 */
export function main(argv, cwd = process.cwd()) {
  const [cmd, ...rest] = argv;
  const now = process.env.AGENT_USAGE_NOW ? parseTime(process.env.AGENT_USAGE_NOW) : Date.now();
  if (now === null) throw new UsageError("AGENT_USAGE_NOW が時刻でない");
  switch (cmd) {
    case "setup": {
      const a = parseArgs(rest, [], ["--person-id", "--time-zone", "--billing"]);
      const repo = repoInfo(cwd);
      const { config, created, path } = loadOrCreateUserConfig();
      const personId = a.options.get("--person-id") ?? config.personId;
      if (!PERSON_ID_RE.test(personId))
        throw new UsageError("--person-id は p- と 16 進数 8 桁の形にする");
      const timeZone = a.options.get("--time-zone") ?? config.timeZone;
      if (!isValidTimeZone(timeZone))
        throw new UsageError("--time-zone は IANA のタイムゾーンの名前にする");
      const billing = a.options.get("--billing") ?? config.billing;
      const next = parseUserConfig({ personId, timeZone, billing }, path);
      saveUserConfig(path, next);
      const dir = usageDir(repo.root);
      mkdirSync(join(dir, "records"), { recursive: true });
      const cfg = join(dir, "config.json");
      if (!existsSync(cfg)) writeFileSync(cfg, `${JSON.stringify({}, null, 2)}\n`);
      console.log(`${created ? "作った" : "更新した"}: ${path}`);
      console.log(
        `人の ID: ${next.personId} / タイムゾーン: ${next.timeZone} / 課金 API: ${next.billing}`,
      );
      console.log(`リポジトリの設定: ${cfg}`);
      console.log(`Hook のスクリプト: ${join(SCRIPT, "..", "precommit-gate.sh")}`);
      return 0;
    }
    case "collect": {
      const a = parseArgs(rest, ["--stage", "--no-github"], []);
      const repo = requireSetup(cwd);
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
        if (repo.branch !== "") saveDecision(repo.commonDir, repo.branch, "record", now);
      }
      return 0;
    }
    case "decline": {
      parseArgs(rest, [], []);
      const repo = requireSetup(cwd);
      if (repo.branch === "") throw new Error("ブランチの上にいない（detached HEAD）");
      saveDecision(repo.commonDir, repo.branch, "decline", now);
      console.log(`${repo.branch}: 記録しない（このブランチでは確認しない）`);
      return 0;
    }
    case "status": {
      parseArgs(rest, [], []);
      const repo = repoInfo(cwd);
      const set = existsSync(usageDir(repo.root));
      console.log(`セットアップ: ${set ? "済み" : "未"}（${usageDir(repo.root)}）`);
      console.log(
        `ブランチ: ${repo.branch || "(detached)"} / デフォルトブランチ: ${repo.defaultBranch ?? "(不明)"}`,
      );
      console.log(
        `このブランチの判断: ${repo.branch ? (decisionFor(repo.commonDir, repo.branch) ?? "未決定") : "-"}`,
      );
      const path = userConfigPath();
      console.log(
        `人の設定: ${existsSync(path) ? readFileSync(path, "utf8").trim().replace(/\s+/g, " ") : "(無い)"}`,
      );
      return 0;
    }
    case "report": {
      const a = parseArgs(rest, [], ["--since", "--until", "--out"]);
      const repo = requireSetup(cwd);
      const out = runReport({
        root: repo.root,
        now,
        env: process.env,
        since: a.options.get("--since") ?? null,
        until: a.options.get("--until") ?? null,
        out: a.options.get("--out") ?? null,
      });
      for (const f of out.files) console.log(`書いた: ${f}`);
      console.log(`行: ${out.rows}（重複を除いた後） / 期間: ${out.period}`);
      return 0;
    }
    case "gate": {
      const a = parseArgs(rest, [], ["--agent"]);
      const agent = a.options.get("--agent") ?? "claude-code";
      const input = readHookInput(readFileSync(0, "utf8"));
      const verdict = gateDecision(input, cwd, now, SCRIPT, agent);
      if (verdict.message) process.stderr.write(`${verdict.message}\n`);
      return verdict.exit;
    }
    default:
      throw new UsageError(`知らないコマンド: ${cmd ?? "(無し)"}`);
  }
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
    if (e instanceof UsageError) process.stderr.write(`${USAGE}\n`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}
