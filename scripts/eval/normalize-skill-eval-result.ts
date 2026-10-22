#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../lib/errors.ts";
import { parseJsonAs } from "../lib/parse-as.ts";
import { isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";

const SCHEMA_VERSION = 1;

// The usage object an executor reports. Any field may be absent or not a number.
type RawUsage = {
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  cache_write_input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
};

export type NormalizedUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type SkillEvidence = {
  visibleSkills: string[] | null;
  invokedSkills: string[] | null;
  toolInputTexts: string[] | null;
  toolOutputTexts: string[] | null;
};

// A shell's directory; `null` = not known.
type Cwd = string | null;

type ShellAnalysis = { reads: string[]; cwdAfter: Cwd | undefined };

type ToolInput = { [field: string]: unknown };

// One block of a Claude message as the trace records it.
type ContentBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: ToolInput;
  tool_use_id?: unknown;
  content?: unknown;
  is_error?: unknown;
};

// One line of a Claude trace.
type ClaudeEvent = {
  type?: unknown;
  subtype?: unknown;
  skills?: unknown;
  cwd?: unknown;
  message?: { content?: ContentBlock[] };
  result?: unknown;
  usage?: RawUsage;
  num_turns?: unknown;
  is_error?: unknown;
};

type CodexItem = {
  type?: unknown;
  text?: unknown;
  aggregated_output?: unknown;
  command?: unknown;
  exit_code?: unknown;
};

// One line of a Codex trace.
type CodexEvent = { type?: unknown; usage?: RawUsage; item?: CodexItem | null };

type PendingEvidence = {
  texts: string[];
  invoked: string | null;
  cwdAfter: Cwd | undefined;
  concurrentMove: boolean;
  name: string;
  input: ToolInput | undefined;
};

export type ParsedTrace = {
  finalResponse: string;
  usage: NormalizedUsage;
  toolCalls: Record<string, number> | null;
  totalToolCalls: number | null;
  totalSteps: number;
  errors: number;
  fatalErrors: number;
  skillEvidence: SkillEvidence;
};

type SkillFile = { path: string; text: string };

// Candidate line -> the subject skill's files that contain it.
export type SkillContentIndex = Map<string, Set<string>>;

export type SkillUsage = {
  schema_version: number;
  config: string;
  skill: string;
  visible: boolean | null;
  invoked: boolean | null;
  files_read: string[] | null;
  content_seen: string[] | null;
  read: boolean | null;
  undeterminable: string[];
  invalid_run?: boolean | null;
  unexpected_read?: boolean | null;
};

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeUsage(executor: string, usage: RawUsage = {}): NormalizedUsage {
  if (executor === "codex") {
    const inputTokens = numberOrZero(usage.input_tokens);
    const cachedInputTokens = numberOrZero(usage.cached_input_tokens);
    const cacheWriteInputTokens = numberOrZero(usage.cache_write_input_tokens);
    const outputTokens = numberOrZero(usage.output_tokens);
    const reasoningOutputTokens = numberOrZero(usage.reasoning_output_tokens);
    return {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      cache_write_input_tokens: cacheWriteInputTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningOutputTokens,
      total_tokens:
        inputTokens +
        cachedInputTokens +
        cacheWriteInputTokens +
        outputTokens +
        reasoningOutputTokens,
    };
  }

  const inputTokens = numberOrZero(usage.input_tokens);
  const cacheCreationTokens = numberOrZero(usage.cache_creation_input_tokens);
  const cacheReadTokens = numberOrZero(usage.cache_read_input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cacheReadTokens,
    cache_write_input_tokens: cacheCreationTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: 0,
    total_tokens: inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens,
  };
}

// Evidence a run read the subject skill. `null` means the executor's trace cannot
// answer that question at all — never conflate it with a measured "no" (that is
// what made a 0-count read as "the agent did not do it"; see #377).
function emptySkillEvidence(): SkillEvidence {
  return { visibleSkills: null, invokedSkills: null, toolInputTexts: null, toolOutputTexts: null };
}

// Evidence is restricted to operations that RETURN a file's contents. Naming a path
// is not reading it: a baseline legitimately runs `test ! -e .claude/skills/<n>/SKILL.md`
// to confirm the skill is absent, and an agent can write the path into a report or
// `echo` it. Counting any mention would mark that baseline `unexpected_read` and let a
// with_skill run that only mentions the path escape `invalid_run` — corrupting the very
// comparison this records. So each tool contributes named fields, and a shell command
// contributes only when a content-reading utility is what runs.
const READ_TOOL_FIELDS = new Map([
  ["Read", ["file_path", "notebook_path"]],
  ["NotebookRead", ["notebook_path", "file_path"]],
  // Grep returns matching lines, so a hit is content. Glob returns names only and is
  // deliberately absent: locating a file is not opening it.
  ["Grep", ["path"]],
]);
const SHELL_TOOLS = new Set(["Bash", "BashOutput"]);

// Utilities whose normal output is the file's contents. The excluded side is the point:
// test / [ / ls / stat / find answer "does it exist", echo / printf only repeat the
// path, and rm / touch / mkdir / cp / mv act on it without showing it.
const READ_UTILITIES = new Set([
  "awk",
  "bat",
  "cat",
  "cut",
  "diff",
  "egrep",
  "fgrep",
  "grep",
  "head",
  "less",
  "more",
  "nl",
  "od",
  "rg",
  "sed",
  "strings",
  "tail",
  "view",
  "xxd",
]);

const SHELL_BINARIES = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

// Anything that makes one part's execution conditional on another's, or that can hide
// a separator inside a quoted word.
const SHELL_CONTROL_FLOW = /[|&;\n`()<>]|\$\(/u;

// Utilities none of whose options takes a value, so the word after a flag is an
// operand. Without this, `cat -n <skill path>` gave the path to `-n` (#572).
const FLAG_ONLY_UTILITIES = new Set(["cat"]);

// Options that print and exit without opening any operand: `cat --help <skill path>`
// succeeds having read nothing.
const TERMINAL_OPTIONS = new Set(["--help", "--version"]);

// How many leading non-flag operands are NOT files. `grep PATTERN file` and
// `sed SCRIPT file` name the skill path in that first operand without opening it,
// so the evidence is the operands after it, never the whole command.
const NON_FILE_LEADING_OPERANDS = new Map([
  ["awk", 1],
  ["egrep", 1],
  ["fgrep", 1],
  ["grep", 1],
  ["rg", 1],
  ["sed", 1],
]);

// The file operands of ONE plain invocation of a reading utility, or nothing. Anything
// that can hide or redirect part of the command (a pipe, a redirect, a substitution, a
// separator) disqualifies it: `cat X | head -5` exits with head's status, so a zero
// exit does not say cat succeeded. That under-counts a genuine piped read, which costs
// one run marked invalid_run — visible, and never a fabricated contamination.
// The last `/`-separated segment (the whole word when it has no `/`).
function lastPathSegment(word: string): string {
  const segments = word.split("/");
  // split() always returns at least one element.
  return segments[segments.length - 1];
}

/** 先頭の環境変数の代入と `sudo` のような前置きを飛ばし、実行するユーティリティの語の位置を返す。 */
function utilityIndex(words: string[]): number {
  // Skip leading env assignments and `sudo`-style prefixes to find the utility.
  let index = 0;
  while (index < words.length && (/^\w+=/u.test(words[index]) || words[index] === "sudo")) {
    index += 1;
  }
  return index;
}

/**
 * ユーティリティの後の語から、オプションとその値を除いた被演算子を返す。
 * consumedOptionValue は、オプションの直後の語を値として読み飛ばしたかを表す。
 */
function operandsAfterOptions(rest: string[], utility: string) {
  const operands: string[] = [];
  let endOfFlags = false;
  let consumedOptionValue = false;
  for (let cursor = 0; cursor < rest.length; cursor += 1) {
    const word = rest[cursor];
    if (!endOfFlags && word === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && word.startsWith("-") && word !== "-") {
      const next = rest[cursor + 1];
      if (
        !FLAG_ONLY_UTILITIES.has(utility) &&
        next !== undefined &&
        next !== "--" &&
        !next.startsWith("-")
      ) {
        cursor += 1;
        consumedOptionValue = true;
      }
      continue;
    }
    operands.push(stripQuotes(word));
  }
  return { operands, consumedOptionValue };
}

function readOperands(command: string): string[] {
  const trimmed = command.trim();
  const words = trimmed.split(/\s+/u).filter(Boolean);
  const index = utilityIndex(words);
  const utility = lastPathSegment(words[index] ?? "");
  if (!READ_UTILITIES.has(utility) || SHELL_CONTROL_FLOW.test(trimmed)) {
    return [];
  }
  const afterUtility = words.slice(index + 1);
  const endOfOptions = afterUtility.indexOf("--");
  const options = endOfOptions === -1 ? afterUtility : afterUtility.slice(0, endOfOptions);
  if (options.some((word) => TERMINAL_OPTIONS.has(word))) {
    return [];
  }

  // Only the file operands are evidence. An option's VALUE goes with the option:
  // `diff --label <skill path> a b` exits zero having read only a and b, and dropping
  // just the `--label` token would leave its value looking like a file. Knowing each
  // option's arity means shipping a table per utility, so the token after an option is
  // treated as its value — over-consuming there only ever drops evidence.
  const { operands, consumedOptionValue } = operandsAfterOptions(words.slice(index + 1), utility);
  // grep/sed/awk name their pattern or script in the first operand. When an option
  // already swallowed it, skipping again would eat the file itself.
  const leadingNonFile = NON_FILE_LEADING_OPERANDS.get(utility) ?? 0;
  return operands.slice(consumedOptionValue ? Math.max(leadingNonFile - 1, 0) : leadingNonFile);
}

// Split a script into the elements of a top-level `a && b && c` list, or return null
// when it is anything else. The one inference this allows is sound: a pure `&&` list
// that exited zero ran every element and every element exited zero, so a read inside
// it happened and a `cd` inside it took effect. Every other connector breaks that:
// `a || b` and `a; b` exit zero with `a` failed, `a & b` does not wait for `a`, and a
// comment or subshell changes what the text means. A separator inside quotes, `$( )`
// or backticks belongs to that inner word, not to the list. Whatever this scanner
// cannot place (an unbalanced quote or paren) rejects the whole script.
function splitAndList(script: string): string[] | null {
  const state: AndListScan = {
    elements: [],
    current: "",
    quote: null,
    substitutionDepth: 0,
    inBackticks: false,
  };
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index];
    const next = script[index + 1];
    const step =
      scanQuoteChar(state, char, next) ??
      scanNestedChar(state, char, next) ??
      scanTopLevelChar(state, script, index);
    if (step === "reject") {
      return null;
    }
    index += step;
  }
  if (state.quote !== null || state.inBackticks || state.substitutionDepth !== 0) {
    return null;
  }
  state.elements.push(state.current);
  return state.elements.every((element) => element.trim() !== "") ? state.elements : null;
}

// splitAndList が 1 文字ずつ進めながら持つ状態。current は組み立て中の要素。
type AndListScan = {
  elements: string[];
  current: string;
  quote: string | null;
  substitutionDepth: number;
  inBackticks: boolean;
};

// 1 文字の処理の結果。数は今の文字の後に読み進めた文字数、"reject" はスクリプト全体を拒否すること、
// undefined はその処理が受け持たない文字であることを表す。
type ScanStep = number | "reject" | undefined;

/** 引用符の中の文字・バックスラッシュ・引用符の開始を処理する。 */
function scanQuoteChar(state: AndListScan, char: string, next: string | undefined): ScanStep {
  if (state.quote === "'") {
    state.current += char;
    if (char === "'") {
      state.quote = null;
    }
    return 0;
  }
  if (char === "\\") {
    state.current += char + (next ?? "");
    return 1;
  }
  if (state.quote === '"') {
    // `"$(…)"` may nest quotes of its own; rather than track that, give up.
    if (char === "`" || (char === "$" && next === "(")) {
      return "reject";
    }
    state.current += char;
    if (char === '"') {
      state.quote = null;
    }
    return 0;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
    state.current += char;
    return 0;
  }
  return undefined;
}

/** バッククォートと `$( )` の中の文字と、その開始を処理する。 */
function scanNestedChar(state: AndListScan, char: string, next: string | undefined): ScanStep {
  if (state.inBackticks) {
    state.current += char;
    if (char === "`") {
      state.inBackticks = false;
    }
    return 0;
  }
  if (char === "`") {
    state.inBackticks = true;
    state.current += char;
    return 0;
  }
  if (char === "$" && next === "(") {
    state.substitutionDepth += 1;
    state.current += "$(";
    return 1;
  }
  if (state.substitutionDepth > 0) {
    if (char === "(") {
      state.substitutionDepth += 1;
    } else if (char === ")") {
      state.substitutionDepth -= 1;
    }
    state.current += char;
    return 0;
  }
  return undefined;
}

/** 引用符や置換の外の文字を処理する。`&&` で要素を区切り、`&&` 以外の区切りやコメントがあれば拒否する。 */
function scanTopLevelChar(state: AndListScan, script: string, index: number): number | "reject" {
  const char = script[index];
  const next = script[index + 1];
  if (char === "&" && next === "&") {
    state.elements.push(state.current);
    state.current = "";
    return 1;
  }
  // `2>&1`, `>&2` and `&>` are redirects, not a background `&`.
  const redirect = char === "&" && (/[<>]/u.test(script[index - 1] ?? "") || next === ">");
  const commentStart =
    char === "#" && (state.current === "" || /\s/u.test(state.current.slice(-1)));
  if (
    (char === "&" && !redirect) ||
    (char === "|" && next === "|") ||
    ";\n(){}".includes(char) ||
    commentStart
  ) {
    return "reject";
  }
  state.current += char;
  return 0;
}

// `cd <one literal directory>`. Anything the shell would expand first (`~`, `$VAR`,
// globs, `cd -`, no operand) has a destination the trace does not state.
function plainCdTarget(element: string): string | null {
  const match = /^cd\s+(\S+)$/u.exec(element.trim());
  if (match === null) {
    return null;
  }
  const quoted = /^(['"])([^'"]*)\1$/u.exec(match[1]);
  const target = quoted === null ? match[1] : quoted[2];
  if (target === "" || /^[-~]|[$`*?[\\'"]/u.test(target)) {
    return null;
  }
  return target;
}

// Whether a script may leave the shell in another directory. This is an allowlist,
// not a list of ways to move: every spelling a denylist missed (`\cd`, `c'd'`, `c$'d'`,
// `c$(printf d)`, `c? /x`, `eval "$MOVE"`, a line continuation inside `cd`) runs the
// builtin, and there is no end to them. So the directory is kept only when every
// command word in the script is a plain literal that is not itself a move or a way to
// run one; anything else leaves it unknown, which only ever drops evidence.
//
// Not covered: a function or alias from the user's shell profile (`z proj`) moves the
// directory under a plain literal name. The Bash tool does not carry functions between
// calls, so only profile-defined ones remain.
const CWD_WORDS = new Set([
  // Moves, and ways to run a command the text does not spell out.
  ".",
  "alias",
  "builtin",
  "cd",
  "command",
  "enable",
  "eval",
  "exec",
  "popd",
  "pushd",
  "shopt",
  "source",
  "trap",
  // Ends the shell, so an `&&` list exits zero without running what follows
  // (`exit 0 && cat X`).
  "exit",
  "logout",
  "return",
  "suspend",
  // Reserved words put the real command word after them (`if cd /x; then …`).
  "!",
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "time",
  "until",
  "while",
]);
const LITERAL_WORD = /^(?:[\w./+:@%^,-]+|\[{1,2})$/u;
const REDIRECT_WORD = /^\d*(?:[<>]|&>)/u;

// Blank what quotes protect, so a separator inside them does not start a command word.
// A substitution inside double quotes runs in a subshell, which cannot move the caller.
// The quote characters stay, so a word spelled with quotes (`c'd'`, `"cd"`) is still not
// a literal. A quote left open returns null.
function blankQuoted(text: string): string | null {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      out += text.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char !== "'" && char !== '"') {
      out += char;
      continue;
    }
    let close = index + 1;
    while (close < text.length && text[close] !== char) {
      close += char === '"' && text[close] === "\\" ? 2 : 1;
    }
    if (close >= text.length) {
      return null;
    }
    out += char + char;
    index = close;
  }
  return out;
}

function movesCwd(text: string): boolean {
  // A line continuation needs no joining: `c\<newline>d` leaves `c\` as a word, which
  // is not a literal.
  const blanked = blankQuoted(text);
  if (blanked === null) {
    return true;
  }
  for (const segment of blanked.split(/[;&|(){}`\n]/u)) {
    const words = segment.trim().split(/\s+/u).filter(Boolean);
    let index = 0;
    while (
      index < words.length &&
      (/^[A-Za-z_]\w*=/u.test(words[index]) || REDIRECT_WORD.test(words[index]))
    ) {
      // A bare operator (`2>`, `<`) takes the next word as its target.
      index += /^\d*(?:[<>]{1,2}|&>)$/u.test(words[index]) ? 2 : 1;
    }
    const word = words[index];
    if (word !== undefined && (!LITERAL_WORD.test(word) || CWD_WORDS.has(word))) {
      return true;
    }
  }
  return false;
}

// A read that climbs with `..` opens the physical parent, which differs from the
// textual one once any directory on the way was reached through a symlink — and the
// trace cannot show that. Leave such an operand as written. (A `cd ..` is different:
// bash's default logical cd does resolve it textually.)
//
// A symlink the cwd sits *under* is not handled: `cd ./.claude/skills/box/link && cat
// SKILL.md` counts as the skill exactly as `cat .claude/skills/box/link/SKILL.md` always
// has. The matcher takes a path spelled under the installed skill as the skill; the
// harness installs it with `cp -R` from skills/, which holds no symlinks, so one there
// is the run's own making. Refusing every relative read whose directory's symlinks
// cannot be verified would refuse them all.
function resolveRead(cwd: Cwd, path: string): string {
  return /(?:^|\/)\.\.(?:\/|$)/u.test(path) ? path : resolveAgainst(cwd, path);
}

function resolveAgainst(cwd: Cwd, path: string): string {
  return cwd === null || /^[/~$]/u.test(path) ? path : posix.resolve(cwd, path);
}

// What one shell command read, and where it left the shell's directory, given the
// directory it started in (`null` = not known). `cwdAfter` is `undefined` when the
// command cannot have moved it, `null` when it may have gone somewhere unknown.
function analyzeShellCommand(command: string, cwd: Cwd, depth = 0): ShellAnalysis {
  const trimmed = command.trim();
  // Codex runs every command as `/bin/bash -lc '<script>'` (measured), so without
  // unwrapping the inner script no codex run would ever count as a read. The inner
  // shell is a child, so nothing it does moves the caller's directory.
  // shellCScript accepts only a script that ends the command, so nothing of this
  // command runs in the caller's shell.
  const inner = shellCScript(trimmed);
  if (inner !== null) {
    if (depth >= 2) {
      return { reads: [], cwdAfter: undefined };
    }
    return { reads: analyzeShellCommand(inner, cwd, depth + 1).reads, cwdAfter: undefined };
  }

  const elements = splitAndList(trimmed);
  if (elements === null) {
    return { reads: [], cwdAfter: movesCwd(trimmed) ? null : undefined };
  }
  const reads: string[] = [];
  let current = cwd;
  let cwdAfter: Cwd | undefined;
  for (const element of elements) {
    const target = plainCdTarget(element);
    if (target !== null) {
      // A relative target other than `./…` / `../…` is looked up through CDPATH first.
      const direct = target.startsWith("/") || /^\.\.?(?:\/|$)/u.test(target);
      current =
        direct && (target.startsWith("/") || current !== null)
          ? resolveAgainst(current, target)
          : null;
      cwdAfter = current;
      continue;
    }
    // Anything the allowlist does not pass may also have ended the shell (`exit 0`,
    // `eval "$X"`), after which the list exits zero with nothing further run: no read
    // after it counts.
    if (movesCwd(element)) {
      current = null;
      cwdAfter = null;
      break;
    }
    if (shellCScript(element.trim()) !== null) {
      reads.push(...analyzeShellCommand(element, current, depth).reads);
      continue;
    }
    reads.push(...readOperands(element).map((path) => resolveRead(current, path)));
  }
  return { reads, cwdAfter };
}

function stripQuotes(word: string): string {
  return word.replaceAll(/^['"]|['"]$/gu, "");
}

// The script `bash -c` runs: the first non-option word after the options, one of which
// holds `c`. It must be a single quoted word that ends the command — text after it
// (`bash -c 'x' && cd y`, or positional arguments) runs elsewhere or means something
// else, and a quoted word later on the line (`bash -c echo 'cd x && cat y'`) is `$0`,
// not the script. Anything else returns null, so the command is read as a plain one.
function shellCScript(command: string): string | null {
  const match = /^(?:\w+=\S*\s+|sudo\s+)*(\S+)((?:\s+-{1,2}[A-Za-z-]+)+)\s+(['"])/u.exec(command);
  if (
    match === null ||
    !SHELL_BINARIES.has(lastPathSegment(match[1])) ||
    !match[2].trim().split(/\s+/u).some(isShellCFlag) ||
    command.length <= match[0].length ||
    command.at(-1) !== match[3]
  ) {
    return null;
  }
  const body = command.slice(match[0].length, -1);
  // A single-quoted word cannot hold `'`; a double-quoted one may hold only escaped `"`.
  const closesEarly = match[3] === "'" ? body.includes("'") : /(?:^|[^\\])(?:\\\\)*"/u.test(body);
  return closesEarly ? null : body;
}

function isShellCFlag(word: string): boolean {
  return /^-[a-z]*c[a-z]*$/u.test(word);
}

// Returns where a shell call may leave the directory (see analyzeShellCommand).
// toolName と input は呼び出し 1 件、sink は読んだ証拠を足す先、cwd は呼び出しの前の作業ディレクトリ。
function collectReadEvidence({
  toolName,
  input,
  sink,
  cwd,
}: {
  toolName: string;
  input: ToolInput | undefined;
  sink: string[];
  cwd: Cwd;
}): Cwd | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  for (const field of READ_TOOL_FIELDS.get(toolName) ?? []) {
    if (typeof input[field] === "string") {
      sink.push(input[field]);
    }
  }
  if (SHELL_TOOLS.has(toolName) && typeof input.command === "string") {
    const { reads, cwdAfter } = analyzeShellCommand(input.command, cwd);
    sink.push(...reads);
    // A background command's `cd` lands in a shell whose directory this cannot follow.
    return cwdAfter !== undefined && input.run_in_background === true ? null : cwdAfter;
  }
  return undefined;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!isArray(content)) {
    return "";
  }
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

// What a Claude stream has recorded so far, while parseClaudeTrace walks its events.
type ClaudeTraceState = {
  visibleSkills: string[] | null;
  invokedSkills: string[];
  toolInputTexts: string[];
  toolOutputTexts: string[];
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  // tool_use id -> evidence awaiting its result. Anything still here at the end was
  // issued but never completed, so it is dropped.
  pendingEvidence: Map<unknown, PendingEvidence>;
  // The Bash tool keeps one shell across calls, so `cd <skill dir>` followed by
  // `cat SKILL.md` reads the skill without its path ever appearing in one command.
  // `null` = not known: before init states it, after a call that may have moved it
  // anywhere, and after the tool reports resetting it. Unknown leaves relative
  // operands unresolved, which only ever loses evidence.
  cwd: Cwd;
};

/** まだ何も記録していない状態を作る。作業ディレクトリは init のイベントが示すまで分からない。 */
function emptyClaudeTraceState(): ClaudeTraceState {
  return {
    visibleSkills: null,
    invokedSkills: [],
    toolInputTexts: [],
    toolOutputTexts: [],
    toolCalls: {},
    totalToolCalls: 0,
    pendingEvidence: new Map(),
    cwd: null,
  };
}

/** トレースの各行を JSON のオブジェクトとして読む。読めない行があれば、その行番号を添えて throw する。 */
function parseClaudeEvents(rawText: string): ClaudeEvent[] {
  const lines = rawText.split(/\r?\n/u).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("Claude trace is empty");
  }

  return lines.map((line, index) => {
    let parsed: ClaudeEvent;
    try {
      parsed = parseJsonAs<ClaudeEvent>(line);
    } catch (error) {
      // Say WHICH line, like the Codex parser does: a stream has thousands of them
      // and "Unexpected token" alone cannot be traced back to one.
      throw new Error(`Claude trace line ${index + 1} is not JSON: ${errorMessage(error)}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`Claude trace line ${index + 1} must be a JSON object`);
    }
    return parsed;
  });
}

/** init のイベントから、提示されたスキルの一覧と開始時の作業ディレクトリを読む。 */
function applyInitEvent(state: ClaudeTraceState, event: ClaudeEvent): void {
  if (isArray(event.skills)) {
    state.visibleSkills = event.skills.filter((name) => typeof name === "string");
  }
  if (typeof event.cwd === "string" && event.cwd.startsWith("/")) {
    state.cwd = event.cwd;
  }
}

/**
 * tool_result の 1 件を、待っている tool_use の証拠と突き合わせる。
 * エラーなしで返った呼び出しだけを証拠に数え、作業ディレクトリを呼び出しの結果に合わせる。
 */
function applyToolResult(state: ClaudeTraceState, block: ContentBlock): void {
  // What a call printed counts whatever its status: `cat X; false` fails having
  // shown X (see skillContentSeen).
  state.toolOutputTexts.push(toolResultText(block.content));
  const pending = state.pendingEvidence.get(block.tool_use_id);
  if (pending === undefined) {
    return;
  }
  state.pendingEvidence.delete(block.tool_use_id);
  if (block.is_error !== true) {
    state.toolInputTexts.push(...pending.texts);
    if (pending.invoked !== null) {
      state.invokedSkills.push(pending.invoked);
    }
  }
  // A failed `cd X && …` may have stopped before or after the cd, and a move that
  // ran alongside another may have run either first or last.
  if (pending.cwdAfter !== undefined) {
    state.cwd = block.is_error === true || pending.concurrentMove ? null : pending.cwdAfter;
  }
  if (/^Shell cwd was reset to /mu.test(toolResultText(block.content))) {
    state.cwd = null;
  }
}

/**
 * ディレクトリを移しうる呼び出しが出たときに、まだ結果を待っている呼び出しの証拠を作り直す。
 * 待っている呼び出しにもディレクトリを移しうるものがあれば true を返す。
 */
function settleConcurrentMoves(state: ClaudeTraceState): boolean {
  // The order runs both ways: a call already out may run after this move, so its
  // relative reads lose the directory they were resolved against, and two moves out
  // together leave whichever ran last.
  let concurrentMove = false;
  for (const pending of state.pendingEvidence.values()) {
    if (pending.cwdAfter !== undefined) {
      pending.concurrentMove = true;
      concurrentMove = true;
    }
    const unresolved: string[] = [];
    collectReadEvidence({
      toolName: pending.name,
      input: pending.input,
      sink: unresolved,
      cwd: null,
    });
    pending.texts = unresolved;
  }
  return concurrentMove;
}

/** tool_use の 1 件を数え、読んだ証拠と呼び出したスキルを、結果を待つ一覧に入れる。 */
function applyToolUse(state: ClaudeTraceState, block: ContentBlock): void {
  const name = typeof block.name === "string" ? block.name : "unknown";
  state.totalToolCalls += 1;
  state.toolCalls[name] = (state.toolCalls[name] ?? 0) + 1;
  const candidate: string[] = [];
  let invoked: string | null = null;
  // An invocation that errored or never returned did not hand the skill over
  // either, so it waits on its result exactly like a file read does.
  if (name === "Skill" && typeof block.input?.skill === "string") {
    invoked = block.input.skill;
  }
  // Calls issued together may run in any order, so while one that may move the
  // directory is still out, where the others ran is not known.
  const movePending = [...state.pendingEvidence.values()].some(
    (pending) => pending.cwdAfter !== undefined,
  );
  const cwdAfter = collectReadEvidence({
    toolName: name,
    input: block.input,
    sink: candidate,
    cwd: movePending ? null : state.cwd,
  });
  const concurrentMove = cwdAfter !== undefined && settleConcurrentMoves(state);
  const shell = SHELL_TOOLS.has(name);
  if (candidate.length === 0 && invoked === null && !shell) {
    return;
  }
  // Without an id the result cannot be correlated, so the call never becomes
  // evidence — an uncorrelated call is exactly the case this guard exists for.
  // Every shell call waits too: its result is where a cwd reset is reported.
  if (typeof block.id === "string") {
    state.pendingEvidence.set(block.id, {
      texts: candidate,
      invoked,
      cwdAfter,
      concurrentMove,
      name,
      input: block.input,
    });
  } else if (cwdAfter !== undefined) {
    state.cwd = null;
  }
}

/** result 以外のイベント 1 件を、種類（init・tool_result・tool_use）に応じて記録に反映する。 */
function applyClaudeEvent(state: ClaudeTraceState, event: ClaudeEvent): void {
  if (event.type === "system" && event.subtype === "init") {
    applyInitEvent(state, event);
    return;
  }
  // A call's evidence counts only once its result comes back without an error.
  // `cat <absent path>` and `false && cat <path>` both name the path in a reading
  // segment but never return its contents, and crediting them marks a clean
  // baseline contaminated.
  if (event.type === "user" && isArray(event.message?.content)) {
    for (const block of event.message.content) {
      if (typeof block === "object" && block !== null && block.type === "tool_result") {
        applyToolResult(state, block);
      }
    }
    return;
  }
  if (event.type !== "assistant" || !isArray(event.message?.content)) {
    return;
  }
  for (const block of event.message.content) {
    if (typeof block === "object" && block !== null && block.type === "tool_use") {
      applyToolUse(state, block);
    }
  }
}

// `--output-format json` writes one object; `--output-format stream-json --verbose`
// writes one event per line and ends with the same `result` object. Both are accepted
// so traces captured before the stream-json switch still normalize.
export function parseClaudeTrace(rawText: string): ParsedTrace {
  const events = parseClaudeEvents(rawText);

  // `--output-format json` emits the very same `{"type":"result"}` object that ends a
  // stream, so the number of lines cannot tell the two apart. What separates them is
  // whether anything *besides* the result was recorded: with only the result object
  // there is no tool record, and the skill axes must stay undeterminable rather than
  // be computed as an empty list — an empty list would read as a measured "not read".
  let resultEvent: ClaudeEvent | null = null;
  const state = emptyClaudeTraceState();

  let sawNonResultEvent = false;
  for (const event of events) {
    if (event.type === "result") {
      resultEvent = event;
      continue;
    }
    sawNonResultEvent = true;
    applyClaudeEvent(state, event);
  }

  // Tolerate the pre-stream-json shape, which had no `type` at all.
  if (resultEvent === null && events.length === 1 && events[0].type === undefined) {
    resultEvent = events[0];
    sawNonResultEvent = false;
  }
  if (resultEvent === null) {
    throw new Error("Claude trace has no result event");
  }

  const { visibleSkills, invokedSkills, toolInputTexts, toolOutputTexts } = state;
  return {
    finalResponse: typeof resultEvent.result === "string" ? resultEvent.result : "",
    usage: normalizeUsage("claude-code", resultEvent.usage),
    toolCalls: sawNonResultEvent ? state.toolCalls : null,
    totalToolCalls: sawNonResultEvent ? state.totalToolCalls : null,
    totalSteps: numberOrZero(resultEvent.num_turns),
    errors: resultEvent.is_error === true ? 1 : 0,
    fatalErrors: resultEvent.is_error === true ? 1 : 0,
    // The init event lists what was offered, so an absent list is "not stated",
    // not "nothing was offered".
    skillEvidence: sawNonResultEvent
      ? { visibleSkills, invokedSkills, toolInputTexts, toolOutputTexts }
      : emptySkillEvidence(),
  };
}

// What a Codex stream has recorded so far, while parseCodexTrace walks its events.
type CodexTraceState = {
  finalResponse: string;
  usage: NormalizedUsage;
  toolCalls: Record<string, number>;
  toolInputTexts: string[];
  toolOutputTexts: string[];
  totalToolCalls: number;
  totalSteps: number;
  errors: number;
  fatalErrors: number;
};

/** command_execution の項目 1 件を数え、出力と、成功したコマンドが読んだ証拠を記録する。 */
function applyCommandExecution(state: CodexTraceState, item: CodexItem): void {
  state.totalToolCalls += 1;
  state.toolCalls.command_execution = (state.toolCalls.command_execution ?? 0) + 1;
  if (typeof item.aggregated_output === "string") {
    state.toolOutputTexts.push(item.aggregated_output);
  }
  // Codex emits item.started and item.completed for the same command; only the
  // completed side is counted here, so the command text is collected once too.
  // Same rule as the claude side, plus the same success requirement: only a
  // command that ran a content-reading utility AND exited zero is evidence.
  // `cat` of a path a baseline expects to be absent exits nonzero and must not
  // count as having read it.
  if (typeof item.command === "string" && item.exit_code === 0) {
    // Codex starts every command afresh in its workdir, so a `cd` carries only
    // through the rest of the same command, never into the next one.
    state.toolInputTexts.push(...analyzeShellCommand(item.command, null).reads);
  }
  if (typeof item.exit_code === "number" && item.exit_code !== 0) {
    state.errors += 1;
  }
}

/** イベント 1 件を、種類（turn の完了・失敗、項目の完了）に応じて記録に反映する。 */
function applyCodexEvent(state: CodexTraceState, event: CodexEvent): void {
  if (event.type === "turn.completed") {
    state.usage = normalizeUsage("codex", event.usage);
  }
  if (event.type === "turn.failed") {
    state.errors += 1;
    state.fatalErrors += 1;
  }
  if (event.type !== "item.completed" || typeof event.item !== "object" || event.item === null) {
    return;
  }
  state.totalSteps += 1;
  if (event.item.type === "error") {
    state.errors += 1;
    state.fatalErrors += 1;
    return;
  }
  if (event.item.type === "agent_message" && typeof event.item.text === "string") {
    state.finalResponse = event.item.text;
    return;
  }
  if (event.item.type === "command_execution") {
    applyCommandExecution(state, event.item);
  }
}

export function parseCodexTrace(rawText: string): ParsedTrace {
  const events = rawText
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index): CodexEvent => {
      try {
        return parseJsonAs<CodexEvent>(line);
      } catch (error) {
        throw new Error(`Codex trace line ${index + 1} is not JSON: ${errorMessage(error)}`);
      }
    });

  const state: CodexTraceState = {
    finalResponse: "",
    usage: normalizeUsage("codex"),
    toolCalls: {},
    toolInputTexts: [],
    toolOutputTexts: [],
    totalToolCalls: 0,
    totalSteps: 0,
    errors: 0,
    fatalErrors: 0,
  };
  for (const event of events) {
    applyCodexEvent(state, event);
  }

  const { toolInputTexts, toolOutputTexts } = state;
  return {
    finalResponse: state.finalResponse,
    usage: state.usage,
    toolCalls: state.toolCalls,
    totalToolCalls: state.totalToolCalls,
    totalSteps: state.totalSteps,
    errors: state.errors,
    fatalErrors: state.fatalErrors,
    // Codex has no init event listing offered skills and no skill-invocation tool;
    // it reads a skill through the shell. Those two axes stay undeterminable.
    // A trace with no events at all recorded nothing, so an empty command list there
    // is "not measured", not "ran no command" — the same distinction the claude side
    // draws with `sawNonResultEvent`.
    skillEvidence: {
      visibleSkills: null,
      invokedSkills: null,
      toolInputTexts: events.length > 0 ? toolInputTexts : null,
      toolOutputTexts: events.length > 0 ? toolOutputTexts : null,
    },
  };
}

// What the harness's contamination scan searches in a codex trace (#401). The raw
// trace is an event stream, so scanning all of it treats a marker the agent merely
// wrote or said as one it read: a baseline whose only command was
// `echo references/oauth-setup.md` would be discarded. Dropping raw/ entirely would
// shrink the surface codex has always had, so this drops only a closed set of events
// that cannot carry anything read from disk, and keeps every other line verbatim —
// including lines it cannot parse or classify, so an unknown shape stays scanned.
//
// Dropped, and why each cannot be a read:
// - agent_message / reasoning / todo_list: text the agent authored.
// - file_change: paths the agent wrote; their contents never appear in the trace.
// - command_execution of one plain `echo` / `printf`: it prints its own arguments.
//   A glob, substitution, redirect or second command can print what is on disk, so
//   any of those keeps the command (and its output) on the surface.
// `unknown`: an item type is whatever the trace holds.
const MENTION_ITEM_TYPES: ReadonlySet<unknown> = new Set([
  "agent_message",
  "reasoning",
  "todo_list",
  "file_change",
]);
const MENTION_UTILITIES = new Set(["echo", "printf"]);

function isMentionOnlyCommand(command: string, depth = 0): boolean {
  const trimmed = command.trim();
  // A substitution runs a command even inside double quotes, which blankQuoted hides.
  // Checked before unwrapping a -c script: shellCScript skips a `FOO=$(<file)` prefix,
  // which would read the file and hand it to the echo inside.
  if (trimmed.includes("`") || trimmed.includes("$(")) {
    return false;
  }
  // shellCScript also skips leading `VAR=value` / `sudo` words, which can make the
  // shell read a file before the echo runs (`BASH_ENV=<file> bash -c 'echo hi'`
  // sources it and prints its lines as errors). Those words are not part of a plain
  // echo, so any prefix keeps the command on the surface.
  if (/^(?:[A-Za-z_]\w*=|sudo(?:\s|$))/u.test(trimmed)) {
    return false;
  }
  const inner = shellCScript(trimmed);
  if (inner !== null) {
    return depth < 2 && isMentionOnlyCommand(inner, depth + 1);
  }
  const blanked = blankQuoted(trimmed);
  if (blanked === null || /[|&;\n(){}<>*?[]/u.test(blanked)) {
    return false;
  }
  return MENTION_UTILITIES.has(blanked.split(/\s+/u)[0]);
}

export function codexContaminationSurface(rawText: string): string {
  const kept: string[] = [];
  for (const line of rawText.split(/\r?\n/u)) {
    if (line.trim() === "") {
      continue;
    }
    let event: CodexEvent | null;
    try {
      event = parseJsonAs<CodexEvent | null>(line);
    } catch {
      kept.push(line);
      continue;
    }
    const item = event?.item;
    if (typeof item === "object" && item !== null) {
      if (MENTION_ITEM_TYPES.has(item.type)) {
        continue;
      }
      if (
        item.type === "command_execution" &&
        typeof item.command === "string" &&
        isMentionOnlyCommand(item.command)
      ) {
        continue;
      }
    }
    kept.push(line);
  }
  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

// The harness installs the subject skill under one of these, by executor
// (run-skill-eval.sh `skill_home`). Both are matched regardless of executor so a
// run that reaches for the other layout is still counted as having read it.
const SKILL_HOME_PATTERN = String.raw`(?:\.claude|\.agents)/skills/`;

function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

// `dir:name` and `plugin:name` are how a scoped skill is listed; the bare name is
// what the eval project installs.
function matchesSkillName(entry: string, skill: string): boolean {
  return entry === skill || entry.endsWith(`:${skill}`);
}

function collectSkillPaths(texts: string[], skill: string): string[] {
  // The name must be a whole directory segment: `/` or the end of the path has to
  // follow it. A lookahead that only rejects word characters still matches `box`
  // inside `box.old/` and `box@backup/`, because `.` and `@` are neither.
  const pathTail = "[^\\s\"'`,;:)\\]}]";
  const pattern = new RegExp(
    `${SKILL_HOME_PATTERN}${escapeForRegExp(skill)}(?:/${pathTail}*)?(?!${pathTail})`,
    "gu",
  );
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      // `.claude/skills/box/../other/SKILL.md` names the text of the subject skill but
      // opens another directory.
      if (!/\/\.\.(?:\/|$)/u.test(match[0])) {
        found.add(match[0]);
      }
    }
  }
  return [...found].sort();
}

// A second kind of evidence, for reads the command parser cannot credit: a skill line
// that shows up in what a tool printed. `cd <skill dir>; cat SKILL.md` and
// `grep … SKILL.md | head` are not `&&` lists, so their commands prove nothing, but
// their output holds the file's text, and the run cannot hold that text without
// having opened the file — provided every other way the text could reach the run is
// taken out of the candidate lines (#572):
// - the frontmatter, which the executor lists to the agent as the skill's description;
// - any text in another skill's files, which a run may legitimately read;
// - any text in the fixture or the prompt, which the run is given.
// Each is matched as a substring, so a line quoted inside a longer one (a JSON string,
// a table cell) is taken out too. What is left must also be prose a run would not
// write itself: at least MIN_CONTENT_LINE_LENGTH characters, with a non-ASCII
// character. An ASCII-only line is a name, a command or a config value
// (`max_pr_iterations: 5`, `if (!el) return false;`), which a run that never opened
// the skill can write and print back (an Edit result shows the file), and a file name
// that `find` or `ls` prints is one too. The skills here are written in Japanese, so
// this keeps their sentences; a skill with no such line only ever loses evidence.
// Only Markdown is indexed: a script's usage text is printed by running it, which is
// not reading it.
const MIN_CONTENT_LINE_LENGTH = 20;

function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(text);
  return match === null ? text : text.slice(match[0].length);
}

// `skillFiles` are the subject skill's Markdown files as { path, text } (path relative
// to the skill directory, SKILL.md with its frontmatter); `otherSkillTexts` every file
// of every other skill; `givenTexts` the fixture files and the prompt. Returns the
// candidate lines, each with the files that contain it.
export function buildSkillContentIndex({
  skillFiles,
  otherSkillTexts,
  givenTexts,
}: {
  skillFiles: SkillFile[];
  otherSkillTexts: string[];
  givenTexts: string[];
}): SkillContentIndex {
  const excluded = [...otherSkillTexts, ...givenTexts];
  const index: SkillContentIndex = new Map();
  for (const { path, text } of skillFiles) {
    const body = path === "SKILL.md" ? stripFrontmatter(text) : text;
    for (const raw of body.split(/\r?\n/u)) {
      const line = raw.trim();
      if (
        line.length < MIN_CONTENT_LINE_LENGTH ||
        !/[\u0080-\u{10ffff}]/u.test(line) ||
        excluded.some((text) => text.includes(line))
      ) {
        continue;
      }
      const paths = index.get(line);
      if (paths) paths.add(path);
      else index.set(line, new Set([path]));
    }
  }
  return index;
}

// The skill files at least one of whose candidate lines appears in a tool's output.
function skillContentSeen(outputs: string[], contentIndex: SkillContentIndex): string[] {
  const text = outputs.join("\n");
  const seen = new Set<string>();
  for (const [line, paths] of contentIndex) {
    if ([...paths].every((path) => seen.has(path))) {
      continue;
    }
    if (text.includes(line)) {
      for (const path of paths) {
        seen.add(path);
      }
    }
  }
  return [...seen].sort();
}

// A symlink is followed: `isDirectory()` on the entry reports the link itself, so a
// linked skill directory would drop out of the lines taken out of the index without a
// word (build-skill-eval-benchmark.ts `listDirs` hit the same). A dangling link throws.
// `ancestors` holds the real paths above the current one, so a link back to itself or
// an ancestor is not walked again (it would recurse until ELOOP). It is not a global
// visited set: two sibling links to one directory must both be listed
// (check-skill-checks.ts `listFiles` keeps the same rule).
function listFiles(root: string): string[] {
  const files: string[] = [];
  collectFiles({ root, files }, root, new Set<string>());
  return files;
}

/** current の下のファイルを、walk.root からの相対パスにして walk.files に足す。 */
function collectFiles(
  walk: { root: string; files: string[] },
  current: string,
  ancestors: Set<string>,
): void {
  const real = realpathSync(current);
  if (ancestors.has(real)) {
    return;
  }
  const above = new Set(ancestors).add(real);
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const kind = entry.isSymbolicLink() ? statSync(path) : entry;
    if (kind.isDirectory()) {
      collectFiles(walk, path, above);
    } else if (kind.isFile()) {
      walk.files.push(relative(walk.root, path).replaceAll("\\", "/"));
    }
  }
}

export function loadSkillContentIndex({
  skillsRoot,
  skill,
  fixture,
  prompt,
}: {
  skillsRoot: string;
  skill: string;
  fixture?: string;
  prompt?: string;
}): SkillContentIndex {
  const skillDirectory = join(skillsRoot, skill);
  if (!existsSync(join(skillDirectory, "SKILL.md"))) {
    throw new Error(`skill not found under --skills-root: ${skillDirectory}`);
  }
  const skillFiles = listFiles(skillDirectory)
    .filter(
      (path) =>
        path === "SKILL.md" || (/^(?:references|assets)\//u.test(path) && path.endsWith(".md")),
    )
    .map((path) => ({ path, text: readFileSync(join(skillDirectory, path), "utf8") }));
  const otherSkillTexts: string[] = [];
  for (const name of readdirSync(skillsRoot)) {
    const directory = join(skillsRoot, name);
    if (name !== skill && statSync(directory).isDirectory()) {
      for (const path of listFiles(directory)) {
        otherSkillTexts.push(readFileSync(join(directory, path), "utf8"));
      }
    }
  }
  const givenTexts = typeof prompt === "string" ? [prompt] : [];
  if (fixture !== undefined) {
    for (const path of listFiles(fixture)) {
      givenTexts.push(readFileSync(join(fixture, path), "utf8"));
    }
  }
  return buildSkillContentIndex({ skillFiles, otherSkillTexts, givenTexts });
}

/** 判定できる軸（visible・invoked・files_read・content_seen）の値と、判定できない軸の名前を集める。 */
function skillAxes({
  skill,
  evidence,
  contentIndex,
}: {
  skill: string;
  evidence?: SkillEvidence | null;
  contentIndex: SkillContentIndex | null;
}) {
  const undeterminable = [];
  let visible = null;
  if (isArray(evidence?.visibleSkills)) {
    visible = evidence.visibleSkills.some((entry) => matchesSkillName(entry, skill));
  } else {
    undeterminable.push("visible");
  }

  let invoked = null;
  if (isArray(evidence?.invokedSkills)) {
    invoked = evidence.invokedSkills.some((entry) => matchesSkillName(entry, skill));
  } else {
    undeterminable.push("invoked");
  }

  let filesRead = null;
  if (isArray(evidence?.toolInputTexts)) {
    filesRead = collectSkillPaths(evidence.toolInputTexts, skill);
  } else {
    undeterminable.push("files_read");
  }

  let contentSeen = null;
  if (contentIndex !== null && isArray(evidence?.toolOutputTexts)) {
    contentSeen = skillContentSeen(evidence.toolOutputTexts, contentIndex);
  } else {
    undeterminable.push("content_seen");
  }
  return { visible, invoked, filesRead, contentSeen, undeterminable };
}

/** 軸の値から、スキルを読んだか（true・false・判定できない null）を決める。 */
function skillRead(
  invoked: boolean | null,
  filesRead: string[] | null,
  contentSeen: string[] | null,
): boolean | null {
  // `invoked === false` alone never settles this: a shell-only read leaves no Skill
  // call. Only a complete tool-input list can turn the answer negative.
  let read = null;
  if (
    invoked === true ||
    (filesRead !== null && filesRead.length > 0) ||
    (contentSeen !== null && contentSeen.length > 0)
  ) {
    read = true;
  } else if (filesRead !== null) {
    read = false;
  }
  return read;
}

// Answers "did this run actually read the subject skill?" so a with_skill run that
// never opened it can be excluded from the comparison instead of silently scoring
// as if the skill were weak (#377). Every axis is tri-state: true / false / null,
// where null means this executor's trace cannot answer it.
export function buildSkillUsage({
  config,
  skill,
  evidence,
  contentIndex = null,
}: {
  config?: string;
  skill?: string;
  evidence?: SkillEvidence | null;
  contentIndex?: SkillContentIndex | null;
}): SkillUsage | null {
  if (!skill || !config) {
    return null;
  }

  const { visible, invoked, filesRead, contentSeen, undeterminable } = skillAxes({
    skill,
    evidence,
    contentIndex,
  });
  const read = skillRead(invoked, filesRead, contentSeen);

  const usage: SkillUsage = {
    schema_version: SCHEMA_VERSION,
    config,
    skill,
    visible,
    invoked,
    files_read: filesRead,
    content_seen: contentSeen,
    read,
    undeterminable,
  };
  if (config === "with_skill") {
    usage.invalid_run = read === null ? null : read === false;
  } else {
    // The mirror case: a baseline that reached the skill is contaminated, not invalid.
    usage.invalid_run = false;
    usage.unexpected_read = read === null ? null : read === true;
  }
  return usage;
}

type NormalizeTraceOptions = {
  executor: string;
  rawText: string;
  exitCode: number;
  model?: string;
  reasoningEffort?: string;
  cliVersion?: string;
  harnessVersion?: string;
  rawTrace?: string;
  durationMs: number;
  startedAt?: string;
  endedAt?: string;
  filesCreated?: string[];
  skill?: string;
  config?: string;
  contentIndex?: SkillContentIndex | null;
};

type NormalizedResult = {
  schema_version: number;
  executor: Record<string, string | null | undefined>;
  status: string;
  exit_code: number;
  result: string;
  usage: NormalizedUsage;
  raw_trace: string | undefined;
  skill_usage?: SkillUsage;
  normalization_error?: string;
};

type NormalizedMetrics = {
  total_steps: number;
  errors_encountered: number;
  output_chars: number;
  transcript_chars: number;
  tool_calls?: Record<string, number>;
  total_tool_calls?: number;
  files_created?: string[];
};

/** トレースを executor に合わせて読む。読めなければ、何も判定できない結果と理由を返す。 */
function parseTraceOrFallback(executor: string, rawText: string) {
  let parsed: ParsedTrace;
  let normalizationError = null;
  try {
    parsed = executor === "codex" ? parseCodexTrace(rawText) : parseClaudeTrace(rawText);
  } catch (error) {
    normalizationError = errorMessage(error);
    parsed = {
      finalResponse: "",
      usage: normalizeUsage(executor),
      toolCalls: null,
      totalToolCalls: null,
      totalSteps: 0,
      errors: 1,
      fatalErrors: 1,
      // An unparsable trace answers nothing about the skill; it must not read as "not read".
      skillEvidence: emptySkillEvidence(),
    };
  }

  return { parsed, normalizationError };
}

/** 終了コードが 0 でも、最終の応答が無いときと致命的なエラーを記録したときは、失敗の理由を返す。 */
function successFailureReason(exitCode: number, parsed: ParsedTrace): string | null {
  if (exitCode === 0 && parsed.finalResponse === "") return "executor produced no final response";
  if (exitCode === 0 && parsed.fatalErrors > 0) {
    return `executor trace reported ${parsed.fatalErrors} fatal error item(s)`;
  }
  return null;
}

/** metrics.json の内容を作る。ツールの呼び出しの数は、トレースが記録したときだけ載せる。 */
function buildMetrics(
  parsed: ParsedTrace,
  {
    exitCode,
    rawText,
    filesCreated,
  }: Pick<NormalizeTraceOptions, "exitCode" | "rawText" | "filesCreated">,
): NormalizedMetrics {
  const metrics: NormalizedMetrics = {
    total_steps: parsed.totalSteps,
    errors_encountered: parsed.errors + (exitCode === 0 ? 0 : 1),
    output_chars: parsed.finalResponse.length,
    transcript_chars: rawText.length,
  };
  if (parsed.toolCalls !== null && parsed.totalToolCalls !== null) {
    metrics.tool_calls = parsed.toolCalls;
    metrics.total_tool_calls = parsed.totalToolCalls;
  }
  if (isArray(filesCreated)) {
    metrics.files_created = filesCreated;
  }
  return metrics;
}

/** timing.json の内容を作る。 */
function buildTiming(
  parsed: ParsedTrace,
  executorMetadata: NormalizedResult["executor"],
  {
    durationMs,
    startedAt,
    endedAt,
  }: Pick<NormalizeTraceOptions, "durationMs" | "startedAt" | "endedAt">,
) {
  const durationSeconds = durationMs / 1000;
  return {
    schema_version: SCHEMA_VERSION,
    executor: executorMetadata,
    total_tokens: parsed.usage.total_tokens,
    duration_ms: durationMs,
    total_duration_seconds: durationSeconds,
    executor_start: startedAt,
    executor_end: endedAt,
    executor_duration_seconds: durationSeconds,
  };
}

export function normalizeTrace(options: NormalizeTraceOptions) {
  const { executor, rawText, exitCode, rawTrace, skill, config, contentIndex = null } = options;
  const { parsed, normalizationError: parseError } = parseTraceOrFallback(executor, rawText);
  const normalizationError = parseError ?? successFailureReason(exitCode, parsed);
  // 最終応答の無い成功は、エラーの件数にも数える。trace を読めなかったとき（parseError がある）は数えない。
  if (parseError === null && exitCode === 0 && parsed.finalResponse === "") parsed.errors += 1;

  const executorMetadata = {
    name: executor,
    model: options.model || null,
    reasoning_effort: options.reasoningEffort || null,
    cli_version: options.cliVersion || null,
    harness_version: options.harnessVersion,
  };
  const status = exitCode === 0 && normalizationError === null ? "succeeded" : "failed";
  const result: NormalizedResult = {
    schema_version: SCHEMA_VERSION,
    executor: executorMetadata,
    status,
    exit_code: exitCode,
    result: parsed.finalResponse,
    usage: parsed.usage,
    raw_trace: rawTrace,
  };
  const skillUsage = buildSkillUsage({
    config,
    skill,
    evidence: parsed.skillEvidence,
    contentIndex,
  });
  if (skillUsage !== null) {
    result.skill_usage = skillUsage;
  }
  if (normalizationError !== null) {
    result.normalization_error = normalizationError;
  }

  const timing = buildTiming(parsed, executorMetadata, options);
  const metrics = buildMetrics(parsed, options);
  return { result, timing, metrics, normalizationError };
}

export function determineFilesCreated(projectFiles: string, initialFilesRaw: string): string[] {
  const initialFiles = new Set(
    initialFilesRaw
      .split("\0")
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/")),
  );
  return listFiles(projectFiles)
    .filter((path) => !initialFiles.has(path))
    .sort();
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near ${key ?? "<end>"}`);
    }
    values[key.slice(2)] = value;
  }
  return values;
}

function atomicWrite(path: string, contents: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, path);
}

// One entry of evals.json, as far as this reads it.
type SourceEval = { id?: unknown; name?: string; assertions?: unknown; expectations?: unknown };

function writeEvalMetadata(args: Record<string, string>): void {
  if (!args["eval-metadata"] || !args["eval-id"] || !args.prompt) {
    return;
  }

  let sourceEval: SourceEval | null = null;
  if (args.evals) {
    const payload = parseJsonAs<{ evals?: SourceEval[] }>(readFileSync(args.evals, "utf8"));
    sourceEval = payload.evals?.find((item) => String(item.id) === String(args["eval-id"])) ?? null;
    if (sourceEval === null) {
      throw new Error(`eval id ${args["eval-id"]} not found in ${args.evals}`);
    }
  }

  const numericId = Number(args["eval-id"]);
  const evalId = Number.isSafeInteger(numericId) ? numericId : args["eval-id"];
  const metadata = {
    eval_id: evalId,
    eval_name: args["eval-name"] || sourceEval?.name || `eval-${args["eval-id"]}`,
    prompt: args.prompt,
    assertions: sourceEval?.assertions ?? sourceEval?.expectations ?? [],
  };
  const encoded = `${JSON.stringify(metadata, null, 2)}\n`;
  atomicWrite(args["eval-metadata"], encoded);
  if (args["compat-eval-metadata"]) {
    atomicWrite(args["compat-eval-metadata"], encoded);
  }
}

/** 必須の引数がそろい、値の組み合わせが受け付けられるものであることを確かめる。 */
function validateArgs(args: Record<string, string>): void {
  const required = [
    "executor",
    "raw",
    "result",
    "timing",
    "metrics",
    "response",
    "exit-code",
    "duration-ms",
    "started-at",
    "ended-at",
    "harness-version",
  ];
  for (const key of required) {
    if (!(key in args)) {
      throw new Error(`missing --${key}`);
    }
  }
  if (!new Set(["claude-code", "codex"]).has(args.executor)) {
    throw new Error(`unsupported executor: ${args.executor}`);
  }
  // Half a pair would emit no skill_usage at all, which reads the same as "this run
  // was not measured" — fail instead of degrading silently.
  if ((args.skill === undefined) !== (args.config === undefined)) {
    throw new Error("--skill and --config must be provided together");
  }
  if (args.config !== undefined && !new Set(["with_skill", "without_skill"]).has(args.config)) {
    throw new Error(`unsupported config: ${args.config}`);
  }
  if (args["skills-root"] !== undefined && args.skill === undefined) {
    throw new Error("--skills-root needs --skill");
  }
  if (args.fixture !== undefined && args["skills-root"] === undefined) {
    throw new Error("--fixture needs --skills-root");
  }
}

/** codex のトレースから、汚染の走査が読む面を --contamination-surface に書く。指定が無ければ何もしない。 */
function writeContaminationSurface(args: Record<string, string>, rawText: string): void {
  // Written before normalization so a trace that fails to normalize is still scanned.
  if (args["contamination-surface"] !== undefined) {
    if (args.executor !== "codex") {
      throw new Error("--contamination-surface is only defined for the codex executor");
    }
    atomicWrite(args["contamination-surface"], codexContaminationSurface(rawText));
  }
}

/** 正規化した結果・計時・指標・最終の応答を、それぞれの出力先のファイルに書く。 */
function writeOutputs(
  args: Record<string, string>,
  normalized: ReturnType<typeof normalizeTrace>,
): void {
  atomicWrite(args.result, `${JSON.stringify(normalized.result, null, 2)}\n`);
  atomicWrite(args.timing, `${JSON.stringify(normalized.timing, null, 2)}\n`);
  atomicWrite(args.metrics, `${JSON.stringify(normalized.metrics, null, 2)}\n`);
  atomicWrite(args.response, normalized.result.result ? `${normalized.result.result}\n` : "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  const contentIndex =
    args["skills-root"] === undefined
      ? null
      : loadSkillContentIndex({
          skillsRoot: args["skills-root"],
          skill: args.skill,
          fixture: args.fixture,
          prompt: args.prompt,
        });

  const rawText = readFileSync(args.raw, "utf8");
  writeContaminationSurface(args, rawText);
  if ((args["project-files"] === undefined) !== (args["initial-files"] === undefined)) {
    throw new Error("--project-files and --initial-files must be provided together");
  }
  const filesCreated = args["project-files"]
    ? determineFilesCreated(args["project-files"], readFileSync(args["initial-files"], "utf8"))
    : undefined;
  const resultDirectory = dirname(args.result);
  const rawTrace = relative(resultDirectory, args.raw).replaceAll("\\", "/");
  const normalized = normalizeTrace({
    executor: args.executor,
    rawText,
    exitCode: Number(args["exit-code"]),
    model: args.model,
    reasoningEffort: args["reasoning-effort"],
    cliVersion: args["cli-version"],
    harnessVersion: args["harness-version"],
    rawTrace,
    durationMs: Number(args["duration-ms"]),
    startedAt: args["started-at"],
    endedAt: args["ended-at"],
    filesCreated,
    skill: args.skill,
    config: args.config,
    contentIndex,
  });

  writeOutputs(args, normalized);
  writeEvalMetadata(args);

  if (normalized.normalizationError !== null) {
    process.stderr.write(`normalization failed: ${normalized.normalizationError}\n`);
    process.exitCode = 1;
  }
}

let isMain = false;
if (process.argv[1]) {
  try {
    isMain = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isMain = false;
  }
}
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
