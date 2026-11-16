// `--progress` のときに、作業の進捗をセッションごとのファイルに書き（set）、statusline に表示する（statusline）。
// 原本はこのスキルの側にあり、スキルのディレクトリから直接実行する（プロジェクトへコピーしない）。
// 手順（いつ何を書くか・statusline の設定）は references/progress.md にある。
//
// set: エージェントが手順の変わり目に実行する。セッションの ID は --session か、エージェントがシェルに渡す環境変数
// （Claude Code の CLAUDE_CODE_SESSION_ID、Copilot CLI の COPILOT_AGENT_SESSION_ID）から取る。
// 終了コードは 0 ＝ 書いた、1 ＝ ファイルを書けない、2 ＝ 使い方の誤り（値の形・セッションの ID が無い）。
//
// statusline: Claude Code と Copilot CLI の statusLine の command として起動される。場所（user@host・ディレクトリ・branch）、
// セッション（モデル・effort・コンテキスト・費用と、stdin の JSON の session_id で選んだ進捗）、プランの利用枠（5 時間・7 日）を、
// 色を付けて最大 3 行に出す。表示は補助なので、入力が読めなくても読めた部分だけを出して exit 0 で終わる
// （statusline の失敗で作業を止めない）。
//
// 進捗のファイルの置き場所は ISSUE_START_PROGRESS_DIR、無ければ ${XDG_STATE_HOME:-~/.local/state}/issue-start/progress である。
// TypeScript 構文は使わない（型は JSDoc）。

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";

const USAGE = [
  "usage: node progress.mjs set --done <完了した数> --total <全体の数> --label <今の手順> [--session <ID>]",
  "       node progress.mjs statusline   （stdin に statusLine の JSON を渡す）",
].join("\n");

// Copilot CLI の COPILOT_AGENT_SESSION_ID は `copilot help environment` に載っている。
// Claude Code の CLAUDE_CODE_SESSION_ID は、Bash ツールの子プロセスの環境変数で実在を確かめた。
const SESSION_ENV = ["CLAUDE_CODE_SESSION_ID", "COPILOT_AGENT_SESSION_ID"];
// ファイル名に使うので、パスの区切りや `..` を含む値を受け付けない。
const SESSION_FORM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const LABEL_MAX = 40;
const BAR_CELLS = 10;
const GIT_TIMEOUT_MS = 1000;

/**
 * @typedef {{ done: number, total: number, label: string }} ProgressInput
 * @typedef {ProgressInput & { branch: string }} Progress branch は set を実行したときの branch（取れなければ空）
 * @typedef {{
 *   env?: Record<string, string | undefined>,
 *   stdin?: () => string,
 *   stdout?: (s: string) => void,
 *   stderr?: (s: string) => void,
 *   branchOf?: (cwd: string) => string,
 *   cwd?: string,
 *   who?: () => string,
 *   now?: () => number,
 * }} Deps
 */

/**
 * オブジェクト（null でない）か。キーで値を読む前に、型の表明の代わりにこれで絞る。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 進捗のファイルを置くディレクトリ。
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function progressDir(env) {
  if (env["ISSUE_START_PROGRESS_DIR"]) return env["ISSUE_START_PROGRESS_DIR"];
  const state = env["XDG_STATE_HOME"] || join(env["HOME"] || homedir(), ".local", "state");
  return join(state, "issue-start", "progress");
}

/**
 * C0・DEL・C1 の制御文字か。端末のエスケープ（ESC と CSI）もここに入る。
 * @param {string} c 1 文字
 * @returns {boolean}
 */
function isControl(c) {
  const code = c.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * 制御文字（端末のエスケープを含む）をコードポイントごとに空白にし、前後の空白を除く。
 * @param {string} text
 * @returns {string}
 */
export function sanitize(text) {
  return Array.from(text, (c) => (isControl(c) ? " " : c))
    .join("")
    .trim();
}

/**
 * 制御文字を外し（sanitize）、長すぎる部分を切り詰める。長さは書記素（絵文字などの見た目の 1 文字）で数える。
 * @param {string} text
 * @returns {string}
 */
export function cleanLabel(text) {
  const flat = sanitize(text);
  const chars = Array.from(new Intl.Segmenter().segment(flat), (s) => s.segment);
  return chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX - 1).join("")}…` : flat;
}

/**
 * 0 以上の整数の文字列だけを数にする。
 * @param {string | undefined} text
 * @returns {number | undefined}
 */
function wholeNumber(text) {
  return text !== undefined && /^\d{1,6}$/u.test(text) ? Number(text) : undefined;
}

/**
 * set の引数から進捗を作る。誤りなら理由を返す。
 * @param {Record<string, string>} strings
 * @returns {ProgressInput | { error: string }}
 */
export function progressFromFlags(strings) {
  const done = wholeNumber(strings["--done"]);
  const total = wholeNumber(strings["--total"]);
  const label = cleanLabel(strings["--label"] ?? "");
  if (total === undefined || total < 1) return { error: "--total は 1 以上の整数にする" };
  if (done === undefined || done > total)
    return { error: "--done は 0 以上 --total 以下の整数にする" };
  if (label === "") return { error: "--label が空である" };
  return { done, total, label };
}

/**
 * セッションの ID を、引数か環境変数から決める。形が違えば理由を返す。
 * @param {string | undefined} given
 * @param {Record<string, string | undefined>} env
 * @returns {{ session: string } | { error: string }}
 */
export function resolveSession(given, env) {
  const session = given ?? SESSION_ENV.map((name) => env[name]).find(Boolean);
  if (!session)
    return { error: `セッションの ID が無い（--session か ${SESSION_ENV.join("・")}）` };
  if (!SESSION_FORM.test(session)) return { error: "セッションの ID に、使えない文字がある" };
  return { session };
}

/**
 * 進捗をファイルに書く。書きかけのファイルを statusline が読まないよう、一時ファイルに書いてから置き換える。
 * @param {string} dir
 * @param {string} session
 * @param {Progress} progress
 */
function writeProgress(dir, session, progress) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${session}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(progress)}\n`);
  renameSync(temp, file);
}

/**
 * @param {readonly string[]} argv
 * @param {Deps} deps
 * @param {(message: string) => number} fail
 * @returns {number}
 */
function runSet(argv, deps, fail) {
  const parsed = parseFlags(argv, {
    values: ["--done", "--total", "--label", "--session"],
  });
  if (parsed.error !== undefined) return fail(parsed.error);
  const progress = progressFromFlags(parsed.strings);
  if ("error" in progress) return fail(progress.error);
  const env = deps.env ?? process.env;
  const resolved = resolveSession(parsed.strings["--session"], env);
  if ("error" in resolved) return fail(resolved.error);
  // statusline は、今の branch がこの branch と同じときだけ進捗を出す。同じセッションで別の作業に移ったときに、前の進捗を出さないためである。
  const branch = sanitize((deps.branchOf ?? gitBranch)(deps.cwd ?? process.cwd()));
  try {
    writeProgress(progressDir(env), resolved.session, { ...progress, branch });
  } catch (error) {
    (deps.stderr ?? ((s) => process.stderr.write(s)))(
      `進捗のファイルを書けない: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  return 0;
}

/**
 * 値が進捗の形か。done と total の関係も確かめ、形の違うファイルを表示しない。
 * @param {unknown} value
 * @returns {value is Progress}
 */
function isProgress(value) {
  if (!isRecord(value)) return false;
  const { done, total, label, branch } = value;
  const whole = (/** @type {unknown} */ n) => Number.isInteger(n) && Number(n) >= 0;
  return (
    whole(done) &&
    whole(total) &&
    Number(total) >= 1 &&
    Number(done) <= Number(total) &&
    typeof label === "string" &&
    typeof branch === "string"
  );
}

/**
 * セッションの進捗を読む。ファイルが無い・読めない・形が違うときは undefined を返す。
 * @param {string} dir
 * @param {unknown} session
 * @returns {Progress | undefined}
 */
function readProgress(dir, session) {
  if (typeof session !== "string" || !SESSION_FORM.test(session)) return undefined;
  try {
    const value = JSON.parse(readFileSync(join(dir, `${session}.json`), "utf8"));
    return isProgress(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 進捗を `[████░░░░░░] 40% 実装` の形にする。Issue の番号は branch の名前で分かるので出さない。
 * @param {ProgressInput} progress
 * @returns {string}
 */
export function formatProgress({ done, total, label }) {
  // 先に掛けてから割る。done / total を先に求めると、29 / 100 * 100 が 28.999… になり 28% と出る。
  const percent = Math.floor((done * 100) / total);
  const filled = Math.floor((done * BAR_CELLS) / total);
  const bar = "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
  return `[${bar}] ${percent}% ${cleanLabel(label)}`;
}

/**
 * 費用を表示の形にする。Claude Code は USD（cost.total_cost_usd）、Copilot CLI は premium requests の数（cost.total_premium_requests）を渡す。
 * Claude Code の stdin の形は https://code.claude.com/docs/en/statusline にある。Copilot CLI の stdin の形は公式の文書で確かめていないので、
 * 名前が違っても表示しないだけで止まらない形にしている。
 * @param {unknown} cost
 * @returns {string | undefined}
 */
export function formatCost(cost) {
  if (!isRecord(cost)) return undefined;
  const { total_cost_usd: usd, total_premium_requests: requests } = cost;
  if (typeof usd === "number" && Number.isFinite(usd)) return `$${usd.toFixed(2)}`;
  if (typeof requests === "number" && Number.isFinite(requests)) return `${requests} premium`;
  return undefined;
}

/**
 * 作業ディレクトリの branch の名前。git が無い・リポジトリでない・時間がかかるときは空にする。
 * @param {string} cwd
 * @returns {string}
 */
function gitBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * stdin の JSON を読む。読めなければ空のオブジェクトにする。
 * @param {() => string} read
 * @returns {Record<string, unknown>}
 */
function readInput(read) {
  try {
    const value = JSON.parse(read());
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * 項目ごとの色（SGR のパラメータ）。緑・黄・赤は状態（LEVELS）にだけ使い、ほかの項目には使わない。
 * 費用と進捗には色を付けない（多い・少ないを決める基準が無く、進捗の度合いはバーで読めるため）。
 */
const COLORS = {
  user: "90",
  dir: "1;34",
  branch: "1;35",
  model: "1;36",
  effort: "36",
  separator: "90",
  reset: "90",
};

/**
 * 使用率（コンテキスト・利用枠）の状態の色。50% 未満は緑、80% 未満は黄、それ以上は赤にする。
 * 項目ごとに閾値を変えると同じ色の意味が変わるので、すべての使用率で同じ閾値を使う。
 */
const LEVELS = [
  { below: 50, sgr: "32" },
  { below: 80, sgr: "33" },
  { below: Number.POSITIVE_INFINITY, sgr: "31" },
];

/**
 * 使用率の状態の色。
 * @param {number} percent
 * @returns {string}
 */
export function levelColor(percent) {
  return LEVELS.find((level) => percent < level.below)?.sgr ?? "31";
}

/**
 * 文字列に色を付ける。color が false なら、そのまま返す。
 * @param {string} text
 * @param {string} sgr
 * @param {boolean} color
 * @returns {string}
 */
function paint(text, sgr, color) {
  return color ? `\u001b[${sgr}m${text}\u001b[0m` : text;
}

/**
 * 色を付けるか。NO_COLOR（https://no-color.org/）が空でない値なら付けない。
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function useColor(env) {
  return !env["NO_COLOR"];
}

/**
 * 入れ子のオブジェクトから、キーの並びで値を取る。途中がオブジェクトでなければ undefined を返す。
 * @param {unknown} value
 * @param {readonly string[]} keys
 * @returns {unknown}
 */
function pick(value, keys) {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 文字列なら制御文字を外して返し、文字列でなければ空にする。
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  return typeof value === "string" ? sanitize(value) : "";
}

/**
 * 有限の数を四捨五入した百分率にする。数でなければ undefined を返す。
 * @param {unknown} value
 * @returns {number | undefined}
 */
function percentOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

/**
 * `<名前>:<使用率>%` を、使用率の状態の色で塗る。
 * @param {string} name
 * @param {number} percent
 * @param {boolean} color
 * @returns {string}
 */
function usage(name, percent, color) {
  return paint(`${name}:${percent}%`, levelColor(percent), color);
}

/**
 * ホームディレクトリの下のパスを `~` で始まる形にする。
 * @param {string} cwd
 * @param {string} home
 * @returns {string}
 */
export function shortenHome(cwd, home) {
  if (home === "" || home === "/") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

/**
 * 残りの分を `2d3h`・`2h10m`・`59m` の形にする。
 * @param {number} minutes 1 以上
 * @returns {string}
 */
function formatLeft(minutes) {
  if (minutes >= 24 * 60)
    return `${Math.floor(minutes / (24 * 60))}d${Math.floor(minutes / 60) % 24}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * 利用枠（5 時間・7 日）の使用量と、リセットまでの残り時間（`5h:30%(reset 2h10m)`）。resets_at は UNIX 時刻（秒）である。
 * 使用率を状態の色で、残り時間をグレーで塗る。使用率が無ければ、その枠を出さない（プランによって枠が無い）。
 * @param {string} name 表示する枠の名前（`5h`・`7d`）
 * @param {unknown} window
 * @param {{ nowMs: number, color: boolean }} at
 * @returns {string}
 */
export function formatLimit(name, window, { nowMs, color }) {
  const used = percentOf(pick(window, ["used_percentage"]));
  if (used === undefined) return "";
  const resetsAt = pick(window, ["resets_at"]);
  const minutes =
    typeof resetsAt === "number" && Number.isFinite(resetsAt)
      ? Math.floor((resetsAt * 1000 - nowMs) / 60_000)
      : 0;
  const reset = minutes > 0 ? paint(`(reset ${formatLeft(minutes)})`, COLORS.reset, color) : "";
  return `${usage(name, used, color)}${reset}`;
}

/**
 * 色を付け終えた項目のうち、空でないものをグレーの ` | ` でつなぐ。
 * @param {readonly string[]} parts
 * @param {boolean} color
 * @returns {string}
 */
function joinParts(parts, color) {
  return parts.filter(Boolean).join(` ${paint("|", COLORS.separator, color)} `);
}

/**
 * statusline を作るときに、stdin の外から取る値。
 * @typedef {{ dir: string, home: string, who: string, nowMs: number, branchOf: (cwd: string) => string, color: boolean }} LineContext
 */

/**
 * 1 行目: `user@host:~/dir (branch)`。cwd が無ければ user@host だけを出す。
 * @param {string} cwd
 * @param {string} branch
 * @param {LineContext} at
 * @returns {string}
 */
function locationLine(cwd, branch, at) {
  const who = at.who === "" ? "" : paint(at.who, COLORS.user, at.color);
  const dir = cwd === "" ? "" : paint(shortenHome(cwd, at.home), COLORS.dir, at.color);
  const place = [who, dir].filter(Boolean).join(":");
  return branch === "" ? place : `${place} ${paint(`(${branch})`, COLORS.branch, at.color)}`;
}

/**
 * モデルと effort を、区切らずに 1 つの項目（`Opus effort:high`）にする。どちらも無ければ空にする。
 * @param {Record<string, unknown>} input
 * @param {boolean} color
 * @returns {string}
 */
function modelPart(input, color) {
  const model = cleanLabel(textOf(pick(input, ["model", "display_name"])));
  const effort = textOf(pick(input, ["effort", "level"]));
  return [
    model && paint(model, COLORS.model, color),
    effort && paint(`effort:${effort}`, COLORS.effort, color),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 2 行目: このセッションの値（モデルと effort・コンテキストの使用率・費用・進捗）のうち、値のあるものを ` | ` でつなぐ。
 * コンテキストの使用率は、Claude Code の context_window.used_percentage（https://code.claude.com/docs/en/statusline）か、
 * Copilot CLI の context_window.current_context_used_percentage（公式の文書では確かめていない）を使う。
 * @param {Record<string, unknown>} input
 * @param {LineContext} at
 * @param {Progress | undefined} progress
 * @returns {string}
 */
function sessionLine(input, at, progress) {
  const context =
    percentOf(pick(input, ["context_window", "used_percentage"])) ??
    percentOf(pick(input, ["context_window", "current_context_used_percentage"]));
  const parts = [
    modelPart(input, at.color),
    context === undefined ? "" : usage("ctx", context, at.color),
    formatCost(input["cost"]) ?? "",
    progress ? formatProgress(progress) : "",
  ];
  return joinParts(parts, at.color);
}

/**
 * 3 行目: プランの利用枠（5 時間・7 日）。Claude Code が rate_limits を渡すとき（claude.ai の有料プランの利用者など）だけ出る。
 * @param {Record<string, unknown>} input
 * @param {LineContext} at
 * @returns {string}
 */
function limitsLine(input, at) {
  const limits = pick(input, ["rate_limits"]);
  return joinParts(
    [
      formatLimit("5h", pick(limits, ["five_hour"]), at),
      formatLimit("7d", pick(limits, ["seven_day"]), at),
    ],
    at.color,
  );
}

/**
 * statusline を作る。1 行目に場所（user@host・ディレクトリ・branch）、2 行目にこのセッションの値と進捗、
 * 3 行目にプランの利用枠を出す。値の無い行は出さない。進捗は、記録した branch が今の branch と同じときだけ出す。
 * @param {Record<string, unknown>} input
 * @param {LineContext} at
 * @returns {string}
 */
export function statusLine(input, at) {
  const cwd = textOf(input["cwd"]);
  const branch = cwd === "" ? "" : sanitize(at.branchOf(cwd));
  const saved = readProgress(at.dir, input["session_id"]);
  const progress = saved?.branch === branch ? saved : undefined;
  const lines = [
    locationLine(cwd, branch, at),
    sessionLine(input, at, progress),
    limitsLine(input, at),
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * `user@host`。取れなければ空にする。
 * @returns {string}
 */
function whoAmI() {
  try {
    return `${userInfo().username}@${hostname().split(".")[0]}`;
  } catch {
    return "";
  }
}

/**
 * statusline の stdin の外から取る値を、依存（テストでは偽物）と環境変数から決める。
 * @param {Deps} deps
 * @returns {LineContext}
 */
function lineContext(deps) {
  const env = deps.env ?? process.env;
  return {
    dir: progressDir(env),
    home: env["HOME"] ?? homedir(),
    who: (deps.who ?? whoAmI)(),
    nowMs: (deps.now ?? Date.now)(),
    branchOf: deps.branchOf ?? gitBranch,
    color: useColor(env),
  };
}

/**
 * @param {readonly string[]} argv
 * @param {Deps} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));
  const fail = (/** @type {string} */ message) => {
    stderr(`${message}\n${USAGE}\n`);
    return 2;
  };
  const [command, ...rest] = argv;
  if (command === "set") return runSet(rest, deps, fail);
  if (command === "statusline" && rest.length === 0) {
    const input = readInput(deps.stdin ?? (() => readFileSync(0, "utf8")));
    const line = statusLine(input, lineContext(deps));
    (deps.stdout ?? ((s) => process.stdout.write(s)))(`${line}\n`);
    return 0;
  }
  return fail(command === undefined ? "コマンドが無い" : `不明な引数: ${argv.join(" ")}`);
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
