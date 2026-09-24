#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeUsage(executor, usage = {}) {
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
function emptySkillEvidence() {
  return { visibleSkills: null, invokedSkills: null, toolInputTexts: null };
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
function readOperands(command) {
  const trimmed = command.trim();
  const words = trimmed.split(/\s+/u).filter(Boolean);
  // Skip leading env assignments and `sudo`-style prefixes to find the utility.
  let index = 0;
  while (index < words.length && (/^\w+=/u.test(words[index]) || words[index] === "sudo")) {
    index += 1;
  }
  const utility = (words[index] ?? "").split("/").pop();
  if (!READ_UTILITIES.has(utility) || SHELL_CONTROL_FLOW.test(trimmed)) {
    return [];
  }

  // Only the file operands are evidence. An option's VALUE goes with the option:
  // `diff --label <skill path> a b` exits zero having read only a and b, and dropping
  // just the `--label` token would leave its value looking like a file. Knowing each
  // option's arity means shipping a table per utility, so the token after an option is
  // treated as its value — over-consuming there only ever drops evidence.
  const rest = words.slice(index + 1);
  const operands = [];
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
      if (next !== undefined && next !== "--" && !next.startsWith("-")) {
        cursor += 1;
        consumedOptionValue = true;
      }
      continue;
    }
    operands.push(stripQuotes(word));
  }
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
function splitAndList(script) {
  const elements = [];
  let current = "";
  let quote = null;
  let substitutionDepth = 0;
  let inBackticks = false;
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index];
    const next = script[index + 1];
    if (quote === "'") {
      current += char;
      if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === "\\") {
      current += char + (next ?? "");
      index += 1;
      continue;
    }
    if (quote === '"') {
      // `"$(…)"` may nest quotes of its own; rather than track that, give up.
      if (char === "`" || (char === "$" && next === "(")) {
        return null;
      }
      current += char;
      if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (inBackticks) {
      current += char;
      if (char === "`") {
        inBackticks = false;
      }
      continue;
    }
    if (char === "`") {
      inBackticks = true;
      current += char;
      continue;
    }
    if (char === "$" && next === "(") {
      substitutionDepth += 1;
      current += "$(";
      index += 1;
      continue;
    }
    if (substitutionDepth > 0) {
      if (char === "(") {
        substitutionDepth += 1;
      } else if (char === ")") {
        substitutionDepth -= 1;
      }
      current += char;
      continue;
    }
    // Top level from here on.
    if (char === "&" && next === "&") {
      elements.push(current);
      current = "";
      index += 1;
      continue;
    }
    // `2>&1`, `>&2` and `&>` are redirects, not a background `&`.
    const redirect = char === "&" && (/[<>]/u.test(script[index - 1] ?? "") || next === ">");
    const commentStart = char === "#" && (current === "" || /\s/u.test(current.at(-1)));
    if (
      (char === "&" && !redirect) ||
      (char === "|" && next === "|") ||
      ";\n(){}".includes(char) ||
      commentStart
    ) {
      return null;
    }
    current += char;
  }
  if (quote !== null || inBackticks || substitutionDepth !== 0) {
    return null;
  }
  elements.push(current);
  return elements.every((element) => element.trim() !== "") ? elements : null;
}

// `cd <one literal directory>`. Anything the shell would expand first (`~`, `$VAR`,
// globs, `cd -`, no operand) has a destination the trace does not state.
function plainCdTarget(element) {
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
function blankQuoted(text) {
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

function movesCwd(text) {
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

function resolveAgainst(cwd, path) {
  return cwd === null || /^[/~$]/u.test(path) ? path : posix.resolve(cwd, path);
}

// What one shell command read, and where it left the shell's directory, given the
// directory it started in (`null` = not known). `cwdAfter` is `undefined` when the
// command cannot have moved it, `null` when it may have gone somewhere unknown.
function analyzeShellCommand(command, cwd, depth = 0) {
  const trimmed = command.trim();
  // Codex runs every command as `/bin/bash -lc '<script>'` (measured), so without
  // unwrapping the inner script no codex run would ever count as a read. The inner
  // shell is a child, so nothing it does moves the caller's directory.
  //
  // The quote check cannot tell one quoted script from `bash -c "a" && cd "/b"`, whose
  // cd runs in the caller's shell, so the caller's side is judged like any script.
  if (isShellCInvocation(trimmed)) {
    const inner = stripOuterQuotes(trimmed);
    const callerMove = movesCwd(trimmed) ? null : undefined;
    if (depth >= 2 || inner === null) {
      return { reads: [], cwdAfter: callerMove };
    }
    return { reads: analyzeShellCommand(inner, cwd, depth + 1).reads, cwdAfter: callerMove };
  }

  const elements = splitAndList(trimmed);
  if (elements === null) {
    return { reads: [], cwdAfter: movesCwd(trimmed) ? null : undefined };
  }
  const reads = [];
  let current = cwd;
  let cwdAfter;
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
    if (movesCwd(element)) {
      current = null;
      cwdAfter = null;
      continue;
    }
    if (isShellCInvocation(element.trim())) {
      reads.push(...analyzeShellCommand(element, current, depth).reads);
      continue;
    }
    reads.push(...readOperands(element).map((path) => resolveAgainst(current, path)));
  }
  return { reads, cwdAfter };
}

function stripQuotes(word) {
  return word.replaceAll(/^['"]|['"]$/gu, "");
}

// `bash -c '<script>'` and its kin, when the quoted script is the last thing on the
// line. Text after the closing quote (`bash -c 'x' && cd y`) runs in the caller's
// shell, so that form is left to the list scanner instead.
function isShellCInvocation(command) {
  const words = command.split(/\s+/u);
  let index = 0;
  while (index < words.length && (/^\w+=/u.test(words[index]) || words[index] === "sudo")) {
    index += 1;
  }
  const utility = (words[index] ?? "").split("/").pop();
  return (
    SHELL_BINARIES.has(utility) &&
    words.slice(index + 1).some(isShellCFlag) &&
    stripOuterQuotes(command) !== null &&
    command.at(-1) === command[command.search(/['"]/u)]
  );
}

function isShellCFlag(word) {
  return /^-[a-z]*c[a-z]*$/u.test(word);
}

// Return the text between the first quote and the last matching one, which is where a
// `-c` script lives.
function stripOuterQuotes(text) {
  const opening = text.search(/['"]/u);
  if (opening === -1) {
    return null;
  }
  const closing = text.lastIndexOf(text[opening]);
  return closing <= opening ? null : text.slice(opening + 1, closing);
}

// Returns where a shell call may leave the directory (see analyzeShellCommand).
function collectReadEvidence(toolName, input, sink, cwd) {
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

function toolResultText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
}

// `--output-format json` writes one object; `--output-format stream-json --verbose`
// writes one event per line and ends with the same `result` object. Both are accepted
// so traces captured before the stream-json switch still normalize.
export function parseClaudeTrace(rawText) {
  const lines = rawText.split(/\r?\n/u).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("Claude trace is empty");
  }

  const events = lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      // Say WHICH line, like the Codex parser does: a stream has thousands of them
      // and "Unexpected token" alone cannot be traced back to one.
      throw new Error(`Claude trace line ${index + 1} is not JSON: ${error.message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Claude trace line ${index + 1} must be a JSON object`);
    }
    return parsed;
  });

  // `--output-format json` emits the very same `{"type":"result"}` object that ends a
  // stream, so the number of lines cannot tell the two apart. What separates them is
  // whether anything *besides* the result was recorded: with only the result object
  // there is no tool record, and the skill axes must stay undeterminable rather than
  // be computed as an empty list — an empty list would read as a measured "not read".
  let resultEvent = null;
  let visibleSkills = null;
  const invokedSkills = [];
  const toolInputTexts = [];
  const toolCalls = {};
  let totalToolCalls = 0;
  // tool_use id -> evidence awaiting its result. Anything still here at the end was
  // issued but never completed, so it is dropped.
  const pendingEvidence = new Map();
  // The Bash tool keeps one shell across calls, so `cd <skill dir>` followed by
  // `cat SKILL.md` reads the skill without its path ever appearing in one command.
  // `null` = not known: before init states it, after a call that may have moved it
  // anywhere, and after the tool reports resetting it. Unknown leaves relative
  // operands unresolved, which only ever loses evidence.
  let cwd = null;

  let sawNonResultEvent = false;
  for (const event of events) {
    if (event.type === "result") {
      resultEvent = event;
      continue;
    }
    sawNonResultEvent = true;
    if (event.type === "system" && event.subtype === "init") {
      if (Array.isArray(event.skills)) {
        visibleSkills = event.skills.filter((name) => typeof name === "string");
      }
      if (typeof event.cwd === "string" && event.cwd.startsWith("/")) {
        cwd = event.cwd;
      }
      continue;
    }
    // A call's evidence counts only once its result comes back without an error.
    // `cat <absent path>` and `false && cat <path>` both name the path in a reading
    // segment but never return its contents, and crediting them marks a clean
    // baseline contaminated.
    if (event.type === "user" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (typeof block !== "object" || block === null || block.type !== "tool_result") {
          continue;
        }
        const pending = pendingEvidence.get(block.tool_use_id);
        if (pending === undefined) {
          continue;
        }
        pendingEvidence.delete(block.tool_use_id);
        if (block.is_error !== true) {
          toolInputTexts.push(...pending.texts);
          if (pending.invoked !== null) {
            invokedSkills.push(pending.invoked);
          }
        }
        // A failed `cd X && …` may have stopped before or after the cd, and a move that
        // ran alongside another may have run either first or last.
        if (pending.cwdAfter !== undefined) {
          cwd = block.is_error === true || pending.concurrentMove ? null : pending.cwdAfter;
        }
        if (/^Shell cwd was reset to /mu.test(toolResultText(block.content))) {
          cwd = null;
        }
      }
      continue;
    }
    if (event.type !== "assistant" || !Array.isArray(event.message?.content)) {
      continue;
    }
    for (const block of event.message.content) {
      if (typeof block !== "object" || block === null || block.type !== "tool_use") {
        continue;
      }
      const name = typeof block.name === "string" ? block.name : "unknown";
      totalToolCalls += 1;
      toolCalls[name] = (toolCalls[name] ?? 0) + 1;
      const candidate = [];
      let invoked = null;
      // An invocation that errored or never returned did not hand the skill over
      // either, so it waits on its result exactly like a file read does.
      if (name === "Skill" && typeof block.input?.skill === "string") {
        invoked = block.input.skill;
      }
      // Calls issued together may run in any order, so while one that may move the
      // directory is still out, where the others ran is not known.
      const movePending = [...pendingEvidence.values()].some(
        (pending) => pending.cwdAfter !== undefined,
      );
      const cwdAfter = collectReadEvidence(name, block.input, candidate, movePending ? null : cwd);
      // The order runs both ways: a call already out may run after this move, so its
      // relative reads lose the directory they were resolved against, and two moves out
      // together leave whichever ran last.
      let concurrentMove = false;
      if (cwdAfter !== undefined) {
        for (const pending of pendingEvidence.values()) {
          if (pending.cwdAfter !== undefined) {
            pending.concurrentMove = true;
            concurrentMove = true;
          }
          const unresolved = [];
          collectReadEvidence(pending.name, pending.input, unresolved, null);
          pending.texts = unresolved;
        }
      }
      const shell = SHELL_TOOLS.has(name);
      if (candidate.length === 0 && invoked === null && !shell) {
        continue;
      }
      // Without an id the result cannot be correlated, so the call never becomes
      // evidence — an uncorrelated call is exactly the case this guard exists for.
      // Every shell call waits too: its result is where a cwd reset is reported.
      if (typeof block.id === "string") {
        pendingEvidence.set(block.id, {
          texts: candidate,
          invoked,
          cwdAfter,
          concurrentMove,
          name,
          input: block.input,
        });
      } else if (cwdAfter !== undefined) {
        cwd = null;
      }
    }
  }

  // Tolerate the pre-stream-json shape, which had no `type` at all.
  if (resultEvent === null && events.length === 1 && events[0].type === undefined) {
    resultEvent = events[0];
    sawNonResultEvent = false;
  }
  if (resultEvent === null) {
    throw new Error("Claude trace has no result event");
  }

  return {
    finalResponse: typeof resultEvent.result === "string" ? resultEvent.result : "",
    usage: normalizeUsage("claude-code", resultEvent.usage),
    toolCalls: sawNonResultEvent ? toolCalls : null,
    totalToolCalls: sawNonResultEvent ? totalToolCalls : null,
    totalSteps: numberOrZero(resultEvent.num_turns),
    errors: resultEvent.is_error === true ? 1 : 0,
    fatalErrors: resultEvent.is_error === true ? 1 : 0,
    // The init event lists what was offered, so an absent list is "not stated",
    // not "nothing was offered".
    skillEvidence: sawNonResultEvent
      ? { visibleSkills, invokedSkills, toolInputTexts }
      : emptySkillEvidence(),
  };
}

export function parseCodexTrace(rawText) {
  const events = rawText
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Codex trace line ${index + 1} is not JSON: ${error.message}`);
      }
    });

  let finalResponse = "";
  let usage = normalizeUsage("codex");
  const toolCalls = {};
  const toolInputTexts = [];
  let totalToolCalls = 0;
  let totalSteps = 0;
  let errors = 0;
  let fatalErrors = 0;

  for (const event of events) {
    if (event.type === "turn.completed") {
      usage = normalizeUsage("codex", event.usage);
    }
    if (event.type === "turn.failed") {
      errors += 1;
      fatalErrors += 1;
    }
    if (event.type !== "item.completed" || typeof event.item !== "object" || event.item === null) {
      continue;
    }
    totalSteps += 1;
    if (event.item.type === "error") {
      errors += 1;
      fatalErrors += 1;
      continue;
    }
    if (event.item.type === "agent_message" && typeof event.item.text === "string") {
      finalResponse = event.item.text;
      continue;
    }
    if (event.item.type === "command_execution") {
      totalToolCalls += 1;
      toolCalls.command_execution = (toolCalls.command_execution ?? 0) + 1;
      // Codex emits item.started and item.completed for the same command; only the
      // completed side is counted here, so the command text is collected once too.
      // Same rule as the claude side, plus the same success requirement: only a
      // command that ran a content-reading utility AND exited zero is evidence.
      // `cat` of a path a baseline expects to be absent exits nonzero and must not
      // count as having read it.
      if (typeof event.item.command === "string" && event.item.exit_code === 0) {
        // Codex starts every command afresh in its workdir, so a `cd` carries only
        // through the rest of the same command, never into the next one.
        toolInputTexts.push(...analyzeShellCommand(event.item.command, null).reads);
      }
      if (typeof event.item.exit_code === "number" && event.item.exit_code !== 0) {
        errors += 1;
      }
    }
  }

  return {
    finalResponse,
    usage,
    toolCalls,
    totalToolCalls,
    totalSteps,
    errors,
    fatalErrors,
    // Codex has no init event listing offered skills and no skill-invocation tool;
    // it reads a skill through the shell. Those two axes stay undeterminable.
    // A trace with no events at all recorded nothing, so an empty command list there
    // is "not measured", not "ran no command" — the same distinction the claude side
    // draws with `sawNonResultEvent`.
    skillEvidence: {
      visibleSkills: null,
      invokedSkills: null,
      toolInputTexts: events.length > 0 ? toolInputTexts : null,
    },
  };
}

// The harness installs the subject skill under one of these, by executor
// (run-skill-eval.sh `skill_home`). Both are matched regardless of executor so a
// run that reaches for the other layout is still counted as having read it.
const SKILL_HOME_PATTERN = String.raw`(?:\.claude|\.agents)/skills/`;

function escapeForRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

// `dir:name` and `plugin:name` are how a scoped skill is listed; the bare name is
// what the eval project installs.
function matchesSkillName(entry, skill) {
  return entry === skill || entry.endsWith(`:${skill}`);
}

function collectSkillPaths(texts, skill) {
  // The name must be a whole directory segment: `/` or the end of the path has to
  // follow it. A lookahead that only rejects word characters still matches `box`
  // inside `box.old/` and `box@backup/`, because `.` and `@` are neither.
  const pathTail = "[^\\s\"'`,;:)\\]}]";
  const pattern = new RegExp(
    `${SKILL_HOME_PATTERN}${escapeForRegExp(skill)}(?:/${pathTail}*)?(?!${pathTail})`,
    "gu",
  );
  const found = new Set();
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}

// Answers "did this run actually read the subject skill?" so a with_skill run that
// never opened it can be excluded from the comparison instead of silently scoring
// as if the skill were weak (#377). Every axis is tri-state: true / false / null,
// where null means this executor's trace cannot answer it.
export function buildSkillUsage({ config, skill, evidence }) {
  if (!skill || !config) {
    return null;
  }

  const undeterminable = [];
  let visible = null;
  if (Array.isArray(evidence?.visibleSkills)) {
    visible = evidence.visibleSkills.some((entry) => matchesSkillName(entry, skill));
  } else {
    undeterminable.push("visible");
  }

  let invoked = null;
  if (Array.isArray(evidence?.invokedSkills)) {
    invoked = evidence.invokedSkills.some((entry) => matchesSkillName(entry, skill));
  } else {
    undeterminable.push("invoked");
  }

  let filesRead = null;
  if (Array.isArray(evidence?.toolInputTexts)) {
    filesRead = collectSkillPaths(evidence.toolInputTexts, skill);
  } else {
    undeterminable.push("files_read");
  }

  // `invoked === false` alone never settles this: a shell-only read leaves no Skill
  // call. Only a complete tool-input list can turn the answer negative.
  let read = null;
  if (invoked === true || (filesRead !== null && filesRead.length > 0)) {
    read = true;
  } else if (filesRead !== null) {
    read = false;
  }

  const usage = {
    schema_version: SCHEMA_VERSION,
    config,
    skill,
    visible,
    invoked,
    files_read: filesRead,
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

export function normalizeTrace({
  executor,
  rawText,
  exitCode,
  model,
  reasoningEffort,
  cliVersion,
  harnessVersion,
  rawTrace,
  durationMs,
  startedAt,
  endedAt,
  filesCreated,
  skill,
  config,
}) {
  let parsed;
  let normalizationError = null;
  try {
    parsed = executor === "codex" ? parseCodexTrace(rawText) : parseClaudeTrace(rawText);
  } catch (error) {
    normalizationError = error instanceof Error ? error.message : String(error);
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

  if (exitCode === 0 && parsed.finalResponse === "" && normalizationError === null) {
    normalizationError = "executor produced no final response";
    parsed.errors += 1;
  }
  if (exitCode === 0 && parsed.fatalErrors > 0 && normalizationError === null) {
    normalizationError = `executor trace reported ${parsed.fatalErrors} fatal error item(s)`;
  }

  const executorMetadata = {
    name: executor,
    model: model || null,
    reasoning_effort: reasoningEffort || null,
    cli_version: cliVersion || null,
    harness_version: harnessVersion,
  };
  const status = exitCode === 0 && normalizationError === null ? "succeeded" : "failed";
  const result = {
    schema_version: SCHEMA_VERSION,
    executor: executorMetadata,
    status,
    exit_code: exitCode,
    result: parsed.finalResponse,
    usage: parsed.usage,
    raw_trace: rawTrace,
  };
  const skillUsage = buildSkillUsage({ config, skill, evidence: parsed.skillEvidence });
  if (skillUsage !== null) {
    result.skill_usage = skillUsage;
  }
  if (normalizationError !== null) {
    result.normalization_error = normalizationError;
  }

  const durationSeconds = durationMs / 1000;
  const timing = {
    schema_version: SCHEMA_VERSION,
    executor: executorMetadata,
    total_tokens: parsed.usage.total_tokens,
    duration_ms: durationMs,
    total_duration_seconds: durationSeconds,
    executor_start: startedAt,
    executor_end: endedAt,
    executor_duration_seconds: durationSeconds,
  };
  const metrics = {
    total_steps: parsed.totalSteps,
    errors_encountered: parsed.errors + (exitCode === 0 ? 0 : 1),
    output_chars: parsed.finalResponse.length,
    transcript_chars: rawText.length,
  };
  if (parsed.toolCalls !== null && parsed.totalToolCalls !== null) {
    metrics.tool_calls = parsed.toolCalls;
    metrics.total_tool_calls = parsed.totalToolCalls;
  }
  if (Array.isArray(filesCreated)) {
    metrics.files_created = filesCreated;
  }

  return { result, timing, metrics, normalizationError };
}

function listCapturedFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      listCapturedFiles(root, path, files);
    } else if (entry.isFile()) {
      files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return files;
}

export function determineFilesCreated(projectFiles, initialFilesRaw) {
  const initialFiles = new Set(
    initialFilesRaw
      .split("\0")
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/")),
  );
  return listCapturedFiles(projectFiles)
    .filter((path) => !initialFiles.has(path))
    .sort();
}

function parseArgs(argv) {
  const values = {};
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

function atomicWrite(path, contents) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, path);
}

function writeEvalMetadata(args) {
  if (!args["eval-metadata"] || !args["eval-id"] || !args.prompt) {
    return;
  }

  let sourceEval = null;
  if (args.evals) {
    const payload = JSON.parse(readFileSync(args.evals, "utf8"));
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

function main() {
  const args = parseArgs(process.argv.slice(2));
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

  const rawText = readFileSync(args.raw, "utf8");
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
  });

  atomicWrite(args.result, `${JSON.stringify(normalized.result, null, 2)}\n`);
  atomicWrite(args.timing, `${JSON.stringify(normalized.timing, null, 2)}\n`);
  atomicWrite(args.metrics, `${JSON.stringify(normalized.metrics, null, 2)}\n`);
  atomicWrite(args.response, normalized.result.result ? `${normalized.result.result}\n` : "");
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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
