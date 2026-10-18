// コミット前の確認（PreToolUse の Hook）。デフォルトブランチ以外の git commit で、そのブランチの判断がまだ無ければ止め、
// 記録するかを利用者に確かめるようエージェントに返す。判断が「記録する」なら collect を実行して明細を stage し、通す。
// 判断が無くても、人かリポジトリの設定に defaultDecision があれば、止めずにその判断として扱う（ブランチの判断は保存しない）。
// ただし人の設定（setup が作る人の ID）が無ければ、defaultDecision があっても、判断が「記録する」でも止めて setup を求める。
//
// 止めない場合: git commit でない・git のリポジトリでない・.agent-usage/ が無い（このリポジトリでは使っていない）・
//               detached HEAD・デフォルトブランチ・判断が「記録しない」・判断が無く defaultDecision がある。
//               最後の場合は、人の設定があるときに限る。
// デフォルトブランチが分からない（origin/HEAD が無い）ときは、main と master をデフォルトブランチとして扱う。

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultDecisionOf, hasPerson, isRecord, userConfigPath } from "./config.mjs";
import { decisionFor } from "./decisions.mjs";
import { git, isDecisionBranch, repoInfo } from "./repo.mjs";
import { usageDir } from "./records.mjs";
import { runCollect } from "./run-collect.mjs";
import { rememberWorktrees } from "./sources/worktrees.mjs";

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
const SHELL_PREFIXES = ["if", "then", "elif", "else", "while", "until", "do", "{", "!", "time"];

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
 * 二重引用符の中のコマンド置換（`"$(...)"`・`` "`...`" ``）は語の一部になるので、中身を substitutions に足す。
 * @param {string} command
 * @param {string[]} [substitutions]
 * @returns {string[][] | null}
 */
export function splitCommands(command, substitutions = []) {
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
        const inner = substitutionAt(command, j);
        if (inner !== null) {
          substitutions.push(inner.text);
          text += command.slice(j, inner.end);
          j = inner.end;
        } else if (command[j] === "\\" && j + 1 < command.length) {
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
 * pos から始まるコマンド置換（`$(...)` か `` `...` ``）の中身と、閉じた直後の位置。置換でないか閉じていなければ null。
 * `$(...)` は括弧の深さで閉じる位置を決める（中の引用符の中の括弧は数える。誤っても検出が増える側になる）。
 * @param {string} command
 * @param {number} pos
 * @returns {{ text: string; end: number } | null}
 */
function substitutionAt(command, pos) {
  if (command[pos] === "`") {
    const close = command.indexOf("`", pos + 1);
    return close < 0 ? null : { text: command.slice(pos + 1, close), end: close + 1 };
  }
  if (command[pos] !== "$" || command[pos + 1] !== "(") return null;
  let depth = 0;
  for (let k = pos + 1; k < command.length; k += 1) {
    if (command[k] === "(") depth += 1;
    else if (command[k] === ")") {
      depth -= 1;
      if (depth === 0) return { text: command.slice(pos + 2, k), end: k + 1 };
    }
  }
  return null;
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
  /** @type {string[]} */
  const substitutions = [];
  const commands = splitCommands(command, substitutions);
  if (commands === null) return /\bgit\b[\s\S]*\bcommit\b/.test(command);
  if (commands.some((words) => commitDirsOf(words) !== null)) return true;
  // 二重引用符の中のコマンド置換は 1 つの語として読まれるので、中身を別に調べる（単一引用符の中は展開されないので調べない）
  return substitutions.some((inner) => isGitCommit(inner));
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
 * その前の `cd <dir>`（同じ呼び出しの中で git commit より前のもの）も順に当てる。語に分けられないときは cwd。
 * 区切り（`&&`・`;`・`||`・サブシェル）は区別しないので、`(cd x) && git commit` の cd も当てる。
 * @param {string} command
 * @param {string} cwd
 * @returns {string}
 */
export function commitCwd(command, cwd) {
  const commands = splitCommands(command);
  if (commands === null) return cwd;
  let dir = cwd;
  /** @type {string[]} */
  const stack = [];
  for (const words of commands) {
    if (words[0] === "popd") {
      dir = stack.pop() ?? cwd;
      continue;
    }
    if (words[0] === "cd" || words[0] === "pushd") {
      if (words[0] === "pushd") stack.push(dir);
      // 展開が要る引数（$・バッククォート・~）と、pushd のスタックの指定（+N・-N）は解決できないので当てず、
      // Hook の cwd で判断する側に寄せる
      const arg = words.length === 2 ? words[1] : "";
      dir =
        arg === "" || /^[-+]/.test(arg) || /[$`]/.test(arg) || arg.startsWith("~")
          ? cwd
          : resolve(dir, arg);
      continue;
    }
    const dirs = commitDirsOf(words);
    if (dirs !== null) return dirs.reduce((acc, d) => resolve(acc, d), dir);
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
    // 人の設定が無いまま collect を実行すると新しい ID を作るので、既存の ID を持つ人には setup を先に案内する
    ...(hasPerson(process.env)
      ? []
      : [
          `人の設定（${userConfigPath(process.env)}）がまだ無いので、記録すると collect が新しい人の ID を作ります。利用者が別のマシンや前の設定で人の ID を持っているなら、先に node "${script}" setup --person-id <その ID> を実行します。`,
        ]),
    "確認はブランチごとに 1 回です。利用者に確認できない（無人の実行）ときは、記録しない側を選ばず、止まった理由を報告してください。",
    "無人の実行で止めたくないときは、利用者が前もって、agent-usage.jsonc（人ごとの設定か、リポジトリの .config/skills/shoji9x9/ の設定）に defaultDecision（record か decline）を置きます。リポジトリの設定の値は、人の設定（setup が作る人の ID）がある人にだけ当たります。エージェントはこの値を自分で書き足さないでください。",
    `（agent: ${agent}）`,
  ].join("\n");
}

/**
 * 人の設定が無いので止めるときの案内。
 * @param {string} agent
 * @param {string} script
 * @returns {string}
 */
function setupMessage(agent, script) {
  return [
    `agent-usage: 人の設定（${userConfigPath(process.env)}）が無いので、コミットは止めました。コミットの前の確認は、人の ID を作りません。`,
    `利用者に、node "${script}" setup を実行して人の ID を作るかを確認してください。このブランチで記録しないなら、node "${script}" decline を実行してから、もう一度コミットします。`,
    "利用者が別のマシンや前の設定で人の ID を持っているなら、setup に --person-id <その ID> を付けます。付けないと新しい ID を作り、人別の集計が分かれます。",
    "利用者に確認できない（無人の実行）ときは、setup を実行せず、人の設定も自分で書かずに、止まった理由を報告してください。",
    "使い捨ての環境（CI のジョブやクラウドのエージェント）では、利用者が環境の起動の処理で人の設定を書いておきます（このスキルの references/setup.md）。",
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
  const base = input.cwd !== "" ? input.cwd : fallbackCwd;
  const cwd = commitCwd(input.command, base);
  /** @type {import("./repo.mjs").RepoInfo} */
  let repo;
  try {
    repo = repoInfo(cwd);
  } catch {
    // コマンドから求めたディレクトリが無い（展開を含む -C など）ときは、Hook の cwd のリポジトリで判断する
    try {
      repo = repoInfo(base);
    } catch {
      return { exit: 0, message: "" };
    }
  }
  if (!existsSync(usageDir(repo.root))) return { exit: 0, message: "" };
  try {
    // 後で削除される worktree のログを collect が探せるよう、パスを覚える。失敗してもコミットは止めない
    rememberWorktrees(repo.commonDir, repo.worktrees);
  } catch {
    // 次の collect で、読めない理由がエラーとして出る
  }
  if (!isDecisionBranch(repo)) return { exit: 0, message: "" };
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
  let note = "";
  if (decision === null) {
    /** @type {{ decision: import("./config.mjs").DefaultDecision; source: string } | null} */
    let fallback;
    try {
      fallback = defaultDecisionOf(repo.root, process.env);
    } catch (e) {
      return configErrorResult(e, script);
    }
    if (fallback === null) return { exit: 2, message: askMessage(agent, script) };
    // リポジトリの defaultDecision は、人の設定（setup が作る人の ID）がある人にだけ当てる。
    // 無い人に当てると、使い捨ての環境では実行のたびに別の ID で記録され、HOME に書けない環境では毎回止まる
    const person = personOf(script);
    if (person !== true)
      return person === false ? { exit: 2, message: setupMessage(agent, script) } : person;
    decision = fallback.decision;
    note = `（このブランチの判断は無いので、${fallback.source} の defaultDecision: ${fallback.decision} に従った）`;
  }
  if (decision === "decline")
    return { exit: 0, message: note === "" ? "" : `agent-usage: 記録しない${note}` };
  // Hook からは人の ID を作らない（collect は人の設定が無いと ID を作るので、その前に止める）
  const person = personOf(script);
  if (person !== true)
    return person === false ? { exit: 2, message: setupMessage(agent, script) } : person;
  try {
    const r = runCollect({ repo, now, env: process.env, github: true, gh: null });
    // 今回書いたファイルに加えて、前回書いて stage されなかった（index.lock などで失敗した、手動の collect で書いた）記録も入れる
    git(["add", "--", ".agent-usage/records"], repo.root);
    const notes =
      r.githubFailures.length > 0
        ? `（GitHub の取得に失敗した段: ${r.githubFailures.length}。その期間の停止は「判定不能」になる）`
        : r.githubSkipped
          ? `（GitHub は取得していない: ${r.githubSkipReason}）`
          : "";
    return {
      exit: 0,
      message: `agent-usage: 利用実績を記録した（新しい行 ${r.newRows}、stage したファイル ${r.written.length}）${notes}${note}`,
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

/**
 * 人の設定があるか。人ごとの設定を読めない（知らないキー・型の誤り・SHOJI9X9_SKILLS_IGNORE_USER_CONFIG の誤り）ときは、
 * コミットを止める結果を返す。例外のまま返すと、呼び出し側の Hook がコミットを通してしまう。
 * @param {string} script
 * @returns {boolean | { exit: number; message: string }}
 */
function personOf(script) {
  try {
    return hasPerson(process.env);
  } catch (e) {
    return configErrorResult(e, script);
  }
}

/**
 * 設定を読めないときに、コミットを止める結果。
 * @param {unknown} e
 * @param {string} script
 * @returns {{ exit: number; message: string }}
 */
function configErrorResult(e, script) {
  return {
    exit: 2,
    message: [
      `agent-usage: 設定を読めない: ${e instanceof Error ? e.message : String(e)}`,
      `設定を直してからもう一度コミットするか、このブランチで記録しないなら node "${script}" decline を実行してからコミットしてください。`,
    ].join("\n"),
  };
}
