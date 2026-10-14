// コミット前の確認（PreToolUse の Hook）。デフォルトブランチ以外の git commit で、そのブランチの判断がまだ無ければ止め、
// 記録するかを利用者に確かめるようエージェントに返す。判断が「記録する」なら collect を実行して明細を stage し、通す。
//
// 止めない場合: git commit でない・git のリポジトリでない・.agent-usage/ が無い（このリポジトリでは使っていない）・
//               detached HEAD・デフォルトブランチ・判断が「記録しない」。
// デフォルトブランチが分からない（origin/HEAD が無い）ときは、main と master をデフォルトブランチとして扱う。

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isRecord } from "./config.mjs";
import { decisionFor } from "./decisions.mjs";
import { git, repoInfo } from "./repo.mjs";
import { usageDir } from "./records.mjs";
import { runCollect } from "./run-collect.mjs";
import { rememberWorktrees } from "./worktrees.mjs";

/**
 * @typedef {object} HookInput
 * @property {string} command
 * @property {string} cwd
 */

/**
 * Hook の JSON から、実行しようとしているコマンドと cwd を取る（Claude Code と Codex は tool_input.command）。
 * @param {string} text
 * @returns {HookInput}
 */
export function readHookInput(text) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { command: "", cwd: "" };
  }
  if (!isRecord(raw)) return { command: "", cwd: "" };
  const input = isRecord(raw.tool_input) ? raw.tool_input : {};
  const command = typeof input.command === "string" ? input.command : "";
  const cwd = typeof raw.cwd === "string" ? raw.cwd : "";
  return { command, cwd };
}

/** コマンドの前に来るシェルの予約語（`if x; then git commit; fi` の then など）。 */
const SHELL_PREFIXES = ["then", "do", "else", "elif", "{", "!", "time"];

/** 後ろのコマンドを実行するコマンド。値を取らないオプション（`-` で始まる語）だけを読み飛ばす。 */
const COMMAND_WRAPPERS = ["env", "command", "exec", "nohup", "nice", "sudo", "xargs"];

/** 値を次の語に取る git のグローバルのオプション（`git --help` の OPTIONS）。`--opt=value` の形は 1 語なので、ここに無くてよい。 */
const GIT_VALUE_OPTIONS = [
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--super-prefix",
];

/**
 * コマンドの文字列を、単純なコマンドごとの語の列に分ける。引用符・エスケープ・行の継続・コメントを扱い、
 * `;`・`&`・`|`・`(`・`)`・改行・`$(`・バッククォートでコマンドを区切る。閉じていない引用符があれば null。
 * @param {string} command
 * @returns {string[][] | null}
 */
export function splitCommands(command) {
  /** @type {string[][]} */
  const out = [];
  /** @type {string[]} */
  let words = [];
  /** @type {string | null} */
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === "\\") {
      if (command[i + 1] === "\n") {
        i += 1;
        continue;
      }
      if (command[i + 1] === "\r" && command[i + 2] === "\n") {
        i += 2;
        continue;
      }
      word = (word ?? "") + (command[i + 1] ?? "");
      i += 1;
    } else if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0) return null;
      word = (word ?? "") + command.slice(i + 1, close);
      i = close;
    } else if (ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < command.length) {
          text += command[j + 1];
          j += 2;
        } else {
          text += command[j];
          j += 1;
        }
      }
      if (j >= command.length) return null;
      word = (word ?? "") + text;
      i = j;
    } else if (ch === "#" && word === null) {
      const nl = command.indexOf("\n", i);
      i = nl < 0 ? command.length : nl - 1;
    } else if (ch === "$" && command[i + 1] === "(") {
      endCommand();
      i += 1;
    } else if (";&|()`\n".includes(ch)) {
      endCommand();
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      endWord();
    } else {
      word = (word ?? "") + ch;
    }
  }
  endCommand();
  return out;
}

/**
 * git commit を実行するコマンドか。単純なコマンドごとに、先頭の変数の代入を除き、
 * `git`（パス付きを含む）の後にグローバルのオプション（値を取るものはその値も）だけを挟んで `commit` が来るかを見る。
 * 前に来るシェルの予約語（SHELL_PREFIXES）と、後ろのコマンドを実行するコマンド（COMMAND_WRAPPERS）は読み飛ばす。
 * 次の場所の git commit は検出しない: エイリアス、変数、`sh -c` の中、スクリプトの中。
 * 値を取るラッパーのオプション（`sudo -u x` など）の後も検出しない。
 * 引用符が閉じていないなど語に分けられないときは、`git` と `commit` の語を含むかで判定する（止めすぎの側に寄せる）。
 * @param {string} command
 * @returns {boolean}
 */
export function isGitCommit(command) {
  const commands = splitCommands(command);
  if (commands === null) return /\bgit\b[\s\S]*\bcommit\b/.test(command);
  return commands.some((words) => commitDirsOf(words) !== null);
}

/**
 * 単純なコマンド（語の列）が git commit なら、`-C` で指定したディレクトリを指定の順に返す。git commit でなければ null。
 * @param {readonly string[]} words
 * @returns {string[] | null}
 */
function commitDirsOf(words) {
  let i = 0;
  for (;;) {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
    if (i < words.length && SHELL_PREFIXES.includes(words[i])) {
      i += 1;
      continue;
    }
    if (i < words.length && COMMAND_WRAPPERS.includes(words[i])) {
      i += 1;
      while (i < words.length && words[i].startsWith("-")) i += 1;
      continue;
    }
    break;
  }
  if (i >= words.length || words[i].split("/").pop() !== "git") return null;
  i += 1;
  /** @type {string[]} */
  const dirs = [];
  while (i < words.length && words[i].startsWith("-")) {
    if (words[i] === "-C" && i + 1 < words.length) dirs.push(words[i + 1]);
    i += GIT_VALUE_OPTIONS.includes(words[i]) ? 2 : 1;
  }
  return words[i] === "commit" ? dirs : null;
}

/**
 * git commit を実行する作業ディレクトリ。最初の git commit の `-C` を、git と同じく cwd から順に解決する（相対パスは前の -C に続ける）。
 * 語に分けられないときと、-C が無いときは cwd。`cd <dir> && git commit` の cd は追わない。
 * @param {string} command
 * @param {string} cwd
 * @returns {string}
 */
export function commitCwd(command, cwd) {
  const commands = splitCommands(command);
  if (commands === null) return cwd;
  for (const words of commands) {
    const dirs = commitDirsOf(words);
    if (dirs !== null) return dirs.reduce((acc, d) => resolve(acc, d), cwd);
  }
  return cwd;
}

/**
 * @param {string} agent
 * @param {string} script
 * @returns {string}
 */
function askMessage(agent, script) {
  return [
    "agent-usage: このブランチで、エージェントの利用実績を記録するかがまだ決まっていません。コミットは止めました。",
    "利用者に「このブランチの作業の利用実績（トークン数・費用・稼働時間）を .agent-usage/records/ に記録してコミットするか」を確認してください。",
    `- 記録する: node "${script}" collect --stage を実行してから、もう一度コミットする`,
    `- 記録しない: node "${script}" decline を実行してから、もう一度コミットする`,
    "確認はブランチごとに 1 回です。利用者に確認できない（無人の実行）ときは、記録しない側を選ばず、止まった理由を報告してください。",
    `（agent: ${agent}）`,
  ].join("\n");
}

/**
 * @param {HookInput} input
 * @param {string} fallbackCwd
 * @param {number} now
 * @param {string} script agent-usage.mjs のパス（案内に書く）
 * @param {string} agent
 * @returns {{ exit: number; message: string }}
 */
export function gateDecision(input, fallbackCwd, now, script, agent) {
  if (!isGitCommit(input.command)) return { exit: 0, message: "" };
  // `git -C <dir> commit` は <dir> のリポジトリにコミットするので、Hook の cwd ではなくそこで判断・記録する
  const cwd = commitCwd(input.command, input.cwd !== "" ? input.cwd : fallbackCwd);
  /** @type {import("./repo.mjs").RepoInfo} */
  let repo;
  try {
    repo = repoInfo(cwd);
  } catch {
    return { exit: 0, message: "" };
  }
  if (!existsSync(usageDir(repo.root))) return { exit: 0, message: "" };
  try {
    // 後で削除される worktree のログを collect が探せるよう、パスを覚える。失敗してもコミットは止めない
    rememberWorktrees(repo.commonDir, repo.worktrees);
  } catch {
    // 次の collect で、読めない理由がエラーとして出る
  }
  if (repo.branch === "") return { exit: 0, message: "" };
  const defaults = repo.defaultBranch ? [repo.defaultBranch] : ["main", "master"];
  if (defaults.includes(repo.branch)) return { exit: 0, message: "" };
  /** @type {import("./decisions.mjs").Decision | null} */
  let decision;
  try {
    decision = decisionFor(repo.commonDir, repo.branch);
  } catch (e) {
    return {
      exit: 2,
      message: `agent-usage: 判断の記録を読めない: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (decision === null) return { exit: 2, message: askMessage(agent, script) };
  if (decision === "decline") return { exit: 0, message: "" };
  try {
    const r = runCollect({ repo, now, env: process.env, github: true, gh: null });
    if (r.written.length > 0) git(["add", "--", ...r.written], repo.root);
    const notes =
      r.githubFailures.length > 0
        ? `（GitHub の取得に失敗した段: ${r.githubFailures.length}。その期間の停止は「判定不能」になる）`
        : "";
    return {
      exit: 0,
      message: `agent-usage: 利用実績を記録した（新しい行 ${r.newRows}、stage したファイル ${r.written.length}）${notes}`,
    };
  } catch (e) {
    return {
      exit: 2,
      message: [
        `agent-usage: 利用実績の記録に失敗したので、コミットを止めました: ${e instanceof Error ? e.message : String(e)}`,
        `原因を直して node "${script}" collect --stage を実行するか、このブランチで記録しないなら node "${script}" decline を実行してから、もう一度コミットしてください。`,
      ].join("\n"),
    };
  }
}
