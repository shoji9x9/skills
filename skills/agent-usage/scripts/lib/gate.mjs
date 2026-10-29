// コミット前の確認（PreToolUse の Hook）。デフォルトブランチ以外の git commit で、そのブランチの判断がまだ無ければ止め、
// 記録するかを利用者に確かめるようエージェントに返す。判断が「記録する」なら collect を実行して明細を stage し、通す。
// 判断が無くても、人かリポジトリの設定に defaultDecision があれば、止めずにその判断として扱う（ブランチの判断は保存しない）。
// ただし人の設定（setup が作る人の ID）が無ければ、defaultDecision があっても、判断が「記録する」でも止めて setup を求める。
//
// 止めない場合: git commit でない・git のリポジトリでない・.agent-usage/ が無い（このリポジトリでは使っていない）・
//               detached HEAD・デフォルトブランチ・判断が「記録しない」・判断が無く defaultDecision がある。
//               最後の場合は、人の設定があるときに限る。
// 判断が「記録する」でも、ブランチが merge 済みなら collect も stage もせずに通す（決め方は merged.mjs）。
// デフォルトブランチが分からない（origin/HEAD が無い）ときは、main と master をデフォルトブランチとして扱う。

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultDecisionOf, hasPerson, isRecord, userConfigPath } from "./config.mjs";
import { decisionFor } from "./decisions.mjs";
import { branchMerged } from "./merged.mjs";
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
const SHELL_PREFIXES = ["if", "then", "elif", "else", "while", "until", "do", "{", "!"];

/**
 * @typedef {object} CommandWrapper
 * @property {readonly string[]} valueOptions 値を次の語に取るオプション。`--opt=value`・`-n5` の形は 1 語なので、ここに無くてよい
 * @property {number} operands オプションの後に取る引数の数（`timeout 60` の 60）
 * @property {readonly string[]} [chdirOptions] 後ろのコマンドの作業ディレクトリを変えるオプション（`env -C <dir>`）。valueOptions にも入れる
 * @property {readonly string[]} [longOptions] valueOptions に無い長いオプション（値を取らないもの）。
 *   省略形（`--chd`）を一意な前方一致で読むために、valueOptions の長いオプションと合わせて、そのコマンドの長いオプションをすべて挙げる
 */

/**
 * 後ろのコマンドを実行するコマンド（ラッパー）。`-` で始まる語と、valueOptions の値と、operands の数の引数を読み飛ばす。
 * 一覧は、Claude Code が `if` の照合の前に取り除くもの（timeout・time・nice・nohup・stdbuf・command・builtin。
 * https://code.claude.com/docs/en/permissions の Wrappers の節）に、sudo・env・xargs・exec を足したもの。
 * 7 つだけにすると `sudo git commit` を見逃す。kaizen の kaizen-precommit-gate.sh も同じラッパーの一覧を持つが、長いオプションの省略形は読まない。
 * longOptions は、GNU coreutils 9.7・sudo 1.9.16p2・findutils の xargs の `--help` と、GNU time のマニュアルから取った。
 * @type {ReadonlyMap<string, CommandWrapper>}
 */
const COMMAND_WRAPPERS = new Map([
  ["builtin", { valueOptions: [], operands: 0 }],
  ["command", { valueOptions: [], operands: 0 }],
  [
    "env",
    {
      valueOptions: ["-u", "--unset", "-C", "--chdir", "-a", "--argv0", "-S", "--split-string"],
      operands: 0,
      chdirOptions: ["-C", "--chdir"],
      longOptions: [
        "--block-signal",
        "--debug",
        "--default-signal",
        "--help",
        "--ignore-environment",
        "--ignore-signal",
        "--list-signal-handling",
        "--null",
        "--version",
      ],
    },
  ],
  ["exec", { valueOptions: ["-a"], operands: 0 }],
  [
    "nice",
    { valueOptions: ["-n", "--adjustment"], operands: 0, longOptions: ["--help", "--version"] },
  ],
  ["nohup", { valueOptions: [], operands: 0, longOptions: ["--help", "--version"] }],
  [
    "stdbuf",
    {
      valueOptions: ["-i", "-o", "-e", "--input", "--output", "--error"],
      operands: 0,
      longOptions: ["--help", "--version"],
    },
  ],
  [
    "sudo",
    {
      valueOptions: [
        "-u",
        "--user",
        "-g",
        "--group",
        "-C",
        "--close-from",
        "-D",
        "--chdir",
        "-p",
        "--prompt",
        "-r",
        "--role",
        "-t",
        "--type",
        "-U",
        "--other-user",
        "-T",
        "--command-timeout",
        "-R",
        "--chroot",
        "-h",
        "--host",
        "-a",
        "--auth-type",
        "-c",
        "--login-class",
      ],
      operands: 0,
      chdirOptions: ["-D", "--chdir"],
      longOptions: [
        "--askpass",
        "--background",
        "--bell",
        "--edit",
        "--help",
        "--list",
        "--login",
        "--non-interactive",
        "--preserve-env",
        "--preserve-groups",
        "--remove-timestamp",
        "--reset-timestamp",
        "--set-home",
        "--shell",
        "--stdin",
        "--validate",
        "--version",
      ],
    },
  ],
  [
    "time",
    {
      valueOptions: ["-f", "--format", "-o", "--output"],
      operands: 0,
      longOptions: ["--append", "--help", "--portability", "--quiet", "--verbose", "--version"],
    },
  ],
  [
    "timeout",
    {
      valueOptions: ["-s", "--signal", "-k", "--kill-after"],
      operands: 1,
      longOptions: ["--foreground", "--help", "--preserve-status", "--verbose", "--version"],
    },
  ],
  [
    "xargs",
    {
      valueOptions: [
        "-a",
        "--arg-file",
        "-d",
        "--delimiter",
        "-E",
        "-I",
        "-L",
        "-n",
        "--max-args",
        "-P",
        "--max-procs",
        "-s",
        "--max-chars",
        "--process-slot-var",
      ],
      operands: 0,
      longOptions: [
        "--eof",
        "--exit",
        "--help",
        "--interactive",
        "--max-lines",
        "--no-run-if-empty",
        "--null",
        "--open-tty",
        "--replace",
        "--show-limits",
        "--verbose",
        "--version",
      ],
    },
  ],
]);

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
 * splitCommands が読み進める間の状態。
 * @typedef {object} SplitState
 * @property {string[][]} out 読み終えたコマンドの語の列
 * @property {string[]} words 読んでいるコマンドの語
 * @property {string | null} word 読んでいる語（語の途中でなければ null）
 * @property {string[]} substitutions 二重引用符の中のコマンド置換の中身を足していく配列
 */

/**
 * コマンドの文字列を、単純なコマンドごとの語の列に分ける。引用符・エスケープ・行の継続・コメントを扱い、
 * `;`・`&`・`|`・`(`・`)`・改行・`$(`・バッククォートでコマンドを区切る。閉じていない引用符があれば null。
 * 二重引用符の中のコマンド置換（`"$(...)"`・`` "`...`" ``）は語の一部になるので、中身を substitutions に足す。
 * @param {string} command
 * @param {string[]} [substitutions]
 * @returns {string[][] | null}
 */
export function splitCommands(command, substitutions = []) {
  /** @type {SplitState} */
  const state = { out: [], words: [], word: null, substitutions };
  for (let i = 0; i < command.length; i += 1) {
    const last = readToken(command, i, state);
    if (last === null) return null;
    i = last;
  }
  endCommand(state);
  return state.out;
}

/**
 * @param {SplitState} state
 */
function endWord(state) {
  if (state.word !== null) state.words.push(state.word);
  state.word = null;
}

/**
 * @param {SplitState} state
 */
function endCommand(state) {
  endWord(state);
  if (state.words.length > 0) state.out.push(state.words);
  state.words = [];
}

/**
 * command[i] から始まる字句を 1 つ読んで state に反映し、読んだ最後の文字の位置を返す。閉じていない引用符なら null。
 * @param {string} command
 * @param {number} i
 * @param {SplitState} state
 * @returns {number | null}
 */
function readToken(command, i, state) {
  const ch = command[i];
  if (ch === "\\") return readEscape(command, i, state);
  if (ch === "'") return readSingleQuoted(command, i, state);
  if (ch === '"') return readDoubleQuoted(command, i, state);
  if (ch === "#" && state.word === null) {
    const nl = command.indexOf("\n", i);
    return nl < 0 ? command.length : nl - 1;
  }
  if (ch === "$" && command[i + 1] === "(") {
    endCommand(state);
    return i + 1;
  }
  if (";&|()`\n".includes(ch)) {
    endCommand(state);
  } else if (ch === " " || ch === "\t" || ch === "\r") {
    endWord(state);
  } else {
    state.word = (state.word ?? "") + ch;
  }
  return i;
}

/**
 * command[i] のバックスラッシュを読む。行の継続（`\` と改行）は読み飛ばし、それ以外は次の文字を語に足す。
 * @param {string} command
 * @param {number} i
 * @param {SplitState} state
 * @returns {number}
 */
function readEscape(command, i, state) {
  if (command[i + 1] === "\n") return i + 1;
  if (command[i + 1] === "\r" && command[i + 2] === "\n") return i + 2;
  state.word = (state.word ?? "") + (command[i + 1] ?? "");
  return i + 1;
}

/**
 * command[i] から始まる単一引用符を読む。閉じていなければ null。
 * @param {string} command
 * @param {number} i
 * @param {SplitState} state
 * @returns {number | null}
 */
function readSingleQuoted(command, i, state) {
  const close = command.indexOf("'", i + 1);
  if (close < 0) return null;
  state.word = (state.word ?? "") + command.slice(i + 1, close);
  return close;
}

/**
 * command[i] から始まる二重引用符を読む。中のコマンド置換は語の一部にし、中身を state.substitutions に足す。閉じていなければ null。
 * @param {string} command
 * @param {number} i
 * @param {SplitState} state
 * @returns {number | null}
 */
function readDoubleQuoted(command, i, state) {
  let j = i + 1;
  let text = "";
  while (j < command.length && command[j] !== '"') {
    const inner = substitutionAt(command, j);
    if (inner !== null) {
      state.substitutions.push(inner.text);
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
  state.word = (state.word ?? "") + text;
  return j;
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
 * 検出しない形の主な例（網羅はしていない）は、references/setup.md の「コミットと判定しない形と、コミットと判定する形」の表にある。
 * COMMAND_WRAPPERS の valueOptions に無い、値を次の語に取るラッパーのオプションの後も検出しない。
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
 * 単純なコマンドの先頭にある前置き（変数の代入・シェルの予約語・ラッパーとそのオプション）を読み飛ばし、
 * 実行するコマンドの名前の位置を返す。ラッパーが作業ディレクトリを変える指定は dirs に足す。
 * @param {readonly string[]} words
 * @param {string[]} dirs
 * @returns {number} ラッパーのオプションに一意に決まらない省略形があれば -1
 */
function skipCommandPrefixes(words, dirs) {
  let i = 0;
  for (;;) {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
    if (i < words.length && SHELL_PREFIXES.includes(words[i])) {
      i += 1;
      continue;
    }
    const wrapper = i < words.length ? COMMAND_WRAPPERS.get(words[i]) : undefined;
    if (wrapper !== undefined) {
      i = skipWrapperOptions(wrapper, words, { start: i + 1, dirs });
      if (i < 0) return -1;
      continue;
    }
    return i;
  }
}

/**
 * ラッパーの名前の次（start）から、ラッパーのオプションと被演算子を読み飛ばした位置を返す。
 * 作業ディレクトリを変えるオプションの値は dirs に足す。
 * @param {CommandWrapper} wrapper
 * @param {readonly string[]} words
 * @param {{ start: number; dirs: string[] }} at start はラッパーの名前の次の位置、dirs は作業ディレクトリを足す先
 * @returns {number} 一意に決まらない省略形の長いオプションがあれば -1
 */
function skipWrapperOptions(wrapper, words, at) {
  const { dirs } = at;
  let i = at.start;
  // `--`（オプションの終わり）も `-` で始まる語として読み飛ばす
  while (i < words.length && words[i].startsWith("-")) {
    // 作業ディレクトリを変えるオプション（`env -C <dir>`・`sudo -D <dir>`）は、git の -C より先に当たる
    const option = readWrapperOption(wrapper, words, i);
    // 一意に決まらない省略形は、次の語が値かコマンドかを決められないので、読むのをやめて呼び出し元に任せる
    if (option.ambiguous === true) return -1;
    if (option.dir !== null) dirs.push(option.dir);
    i += option.width;
  }
  i += wrapper.operands;
  return i;
}

/**
 * 単純なコマンド（語の列）が git commit なら、ラッパーの `env -C`・`sudo -D` と git の `-C` で指定したディレクトリを指定の順に返す。
 * git commit でなければ null。
 * @param {readonly string[]} words
 * @returns {string[] | null}
 */
function commitDirsOf(words) {
  /** @type {string[]} */
  const dirs = [];
  let i = skipCommandPrefixes(words, dirs);
  // ラッパーのオプションを読み切れないときは、git の語の後ろに commit の語があればコミットとして扱う（止める側に寄せる）。
  // 読み切れたラッパーの指定も、後ろが値かコマンドかを決められないので当てず、作業ディレクトリは変えない
  if (i < 0) {
    const git = words.findIndex((w) => w.split("/").pop() === "git");
    return git >= 0 && words.indexOf("commit", git + 1) > git ? [] : null;
  }
  if (i >= words.length || words[i].split("/").pop() !== "git") return null;
  i += 1;
  while (i < words.length && words[i].startsWith("-")) {
    if (words[i] === "-C" && i + 1 < words.length) dirs.push(words[i + 1]);
    i += GIT_VALUE_OPTIONS.includes(words[i]) ? 2 : 1;
  }
  return words[i] === "commit" ? dirs : null;
}

/**
 * ラッパーの長いオプション（`--` で始まる語）を、`--opt <value>`・`--opt=<value>` の形で読む。戻り値は readWrapperOption と同じ。
 * @param {CommandWrapper} wrapper
 * @param {string} word
 * @param {string | null} next
 * @returns {{ width: number, dir: string | null, ambiguous?: boolean }}
 */
function readLongWrapperOption(wrapper, word, next) {
  const chdir = wrapper.chdirOptions ?? [];
  const eq = word.indexOf("=");
  const name = resolveLongOption(wrapper, eq === -1 ? word : word.slice(0, eq));
  if (name === null) return { width: 1, dir: null, ambiguous: true };
  if (eq !== -1) return { width: 1, dir: chdir.includes(name) ? word.slice(eq + 1) : null };
  const takesValue = wrapper.valueOptions.includes(name);
  return { width: takesValue ? 2 : 1, dir: takesValue && chdir.includes(name) ? next : null };
}

/**
 * 長いオプションの名前を、getopt_long と同じく一意な前方一致で正式な名前にする（`env --chd` は `--chdir`）。
 * 名前がそのまま一覧にあれば（省略していなければ）それを返す。どれにも当たらない名前（`--` を含む）はそのまま返す。
 * 2 つ以上に当たる省略形は、値を取るかを決められないので null を返す。
 * @param {CommandWrapper} wrapper
 * @param {string} name `--` で始まる名前（`=` より前）
 * @returns {string | null}
 */
function resolveLongOption(wrapper, name) {
  const known = [
    ...wrapper.valueOptions.filter((o) => o.startsWith("--")),
    ...(wrapper.longOptions ?? []),
  ];
  if (name === "--" || known.includes(name)) return name;
  const hits = known.filter((o) => o.startsWith(name));
  if (hits.length === 0) return name;
  return hits.length === 1 ? hits[0] : null;
}

/**
 * ラッパーの words[i]（`-` で始まる語）を getopt と同じ規則で読み、読み飛ばす語の数（値を次の語に取るなら 2）と、
 * 作業ディレクトリを変えるオプション（chdirOptions）の値を返す。
 * 長いオプションは `--opt <value>`・`--opt=<value>` を読む。短いオプションは、他のオプションとまとめた形（`env -iC <dir>`）と、
 * 値を続けて書いた形（`-C<dir>`・`nice -n5`）を読む。まとめた形では、値を取る最初のオプションより後ろの文字をその値として読む。
 * @param {CommandWrapper} wrapper
 * @param {readonly string[]} words
 * @param {number} i
 * @returns {{ width: number, dir: string | null, ambiguous?: boolean }}
 */
function readWrapperOption(wrapper, words, i) {
  const word = words[i];
  const next = i + 1 < words.length ? words[i + 1] : null;
  if (word.startsWith("--")) return readLongWrapperOption(wrapper, word, next);
  const chdir = wrapper.chdirOptions ?? [];
  for (let k = 1; k < word.length; k += 1) {
    const name = `-${word[k]}`;
    if (!wrapper.valueOptions.includes(name)) continue;
    const rest = word.slice(k + 1);
    return {
      width: rest === "" ? 2 : 1,
      dir: chdir.includes(name) ? (rest === "" ? next : rest) : null,
    };
  }
  return { width: 1, dir: null };
}

/**
 * `cd <dir>`・`pushd <dir>`（words）を dir に当てた後の作業ディレクトリ。解決できない引数なら cwd を返す。
 * @param {readonly string[]} words
 * @param {string} dir
 * @param {string} cwd
 * @returns {string}
 */
function changedDir(words, dir, cwd) {
  // 展開が要る引数（$・バッククォート・~）と、pushd のスタックの指定（+N・-N）は解決できないので当てず、
  // Hook の cwd で判断する側に寄せる
  const arg = words.length === 2 ? words[1] : "";
  return arg === "" || /^[-+]/.test(arg) || /[$`]/.test(arg) || arg.startsWith("~")
    ? cwd
    : resolve(dir, arg);
}

/**
 * git commit を実行する作業ディレクトリ。最初の git commit のラッパーの `env -C`・`sudo -D` と git の `-C` を、
 * git と同じく cwd から順に解決する（相対パスは前の指定に続ける）。
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
      dir = changedDir(words, dir, cwd);
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
 * gateDecision の判断に使う、Hook の入力以外の値。
 * @typedef {object} GateContext
 * @property {string} fallbackCwd Hook の入力に cwd が無いときの作業ディレクトリ
 * @property {number} now
 * @property {string} script agent-usage.mjs のパス（案内に書く）
 * @property {string} agent
 */

/** @typedef {{ exit: number; message: string }} GateResult */

/**
 * ブランチの判断。person は人の設定があるかを読んだ結果（読むのは 1 回だけにする。まだ読んでいなければ undefined）。
 * @typedef {object} ResolvedDecision
 * @property {import("./decisions.mjs").Decision} decision
 * @property {string} note 案内に添える、判断の出所
 * @property {boolean | GateResult | undefined} person
 */

/**
 * @param {HookInput} input
 * @param {GateContext} context
 * @returns {GateResult}
 */
export function gateDecision(input, context) {
  const { script, agent } = context;
  if (!isGitCommit(input.command)) return { exit: 0, message: "" };
  const repo = commitRepo(input, context.fallbackCwd);
  if (repo === null || !existsSync(usageDir(repo.root))) return { exit: 0, message: "" };
  rememberWorktreesQuietly(repo);
  if (!isDecisionBranch(repo)) return { exit: 0, message: "" };
  const resolved = resolveDecision(repo, context);
  if (!("decision" in resolved)) return resolved;
  const { decision, note } = resolved;
  if (decision === "decline")
    return { exit: 0, message: note === "" ? "" : `agent-usage: 記録しない${note}` };
  // Hook からは人の ID を作らない（collect は人の設定が無いと ID を作るので、その前に止める）
  const person = resolved.person ?? personOf(script);
  if (person !== true)
    return person === false ? { exit: 2, message: setupMessage(agent, script) } : person;
  return recordCommit(repo, context, note);
}

/**
 * git commit を実行するリポジトリ。git のリポジトリでなければ null。
 * @param {HookInput} input
 * @param {string} fallbackCwd
 * @returns {import("./repo.mjs").RepoInfo | null}
 */
function commitRepo(input, fallbackCwd) {
  // `git -C <dir> commit` は <dir> のリポジトリにコミットするので、Hook の cwd ではなくそこで判断・記録する
  const base = input.cwd !== "" ? input.cwd : fallbackCwd;
  const cwd = commitCwd(input.command, base);
  try {
    return repoInfo(cwd);
  } catch {
    // コマンドから求めたディレクトリが無い（展開を含む -C など）ときは、Hook の cwd のリポジトリで判断する
    try {
      return repoInfo(base);
    } catch {
      return null;
    }
  }
}

/**
 * @param {import("./repo.mjs").RepoInfo} repo
 */
function rememberWorktreesQuietly(repo) {
  try {
    // 後で削除される worktree のログを collect が探せるよう、パスを覚える。失敗してもコミットは止めない
    rememberWorktrees(repo.commonDir, repo.worktrees);
  } catch {
    // 次の collect で、読めない理由がエラーとして出る
  }
}

/**
 * ブランチの判断を読む。判断が無ければ defaultDecision に従う。コミットを止めるなら、その結果を返す。
 * @param {import("./repo.mjs").RepoInfo} repo
 * @param {GateContext} context
 * @returns {ResolvedDecision | GateResult}
 */
function resolveDecision(repo, context) {
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
  if (decision !== null) return { decision, note: "", person: undefined };
  return defaultDecision(repo, context);
}

/**
 * ブランチの判断が無いときに、人かリポジトリの設定の defaultDecision を当てる。無ければ止めて、記録するかを確かめさせる。
 * @param {import("./repo.mjs").RepoInfo} repo
 * @param {GateContext} context
 * @returns {ResolvedDecision | GateResult}
 */
function defaultDecision(repo, context) {
  const { script, agent } = context;
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
  const note = `（このブランチの判断は無いので、${fallback.source} の defaultDecision: ${fallback.decision} に従った）`;
  return { decision: fallback.decision, note, person };
}

/**
 * 記録すると決めたブランチで collect を実行し、記録を stage する。merge 済みのブランチなら記録しない。
 * @param {import("./repo.mjs").RepoInfo} repo
 * @param {GateContext} context
 * @param {string} note
 * @returns {GateResult}
 */
function recordCommit(repo, context, note) {
  // merge 済みのブランチ（merge の後の worktree で commit を試みた、など）には記録を足さない。
  // 足すと、merge 済みのブランチの worktree に stage した記録が残り、どの PR にも入らない
  const merged = branchMerged(repo, process.env);
  if (merged.merged)
    return {
      exit: 0,
      message: `agent-usage: このブランチは merge 済み（${merged.how}）なので、記録しない${note}`,
    };
  try {
    const r = runCollect({ repo, now: context.now, env: process.env, github: true, gh: null });
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
        `原因を直して node "${context.script}" collect --stage を実行するか、このブランチで記録しないなら node "${context.script}" decline を実行してから、もう一度コミットしてください。`,
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
