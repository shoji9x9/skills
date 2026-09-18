#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

// A command is evidence only when the WHOLE command is one plain invocation of a
// reading utility. Splitting a compound command and judging the pieces reads a branch
// that never ran as executed: `test -f X && cat X || echo absent` exits zero when X is
// absent, yet the `cat X` piece is still in the text, and a separator inside quotes
// (`printf '%s' 'note; cat X'`) splits the same way. Knowing which branch ran needs a
// real shell parse; short of that, a compound command yields nothing.
//
// This under-counts a genuine read written as `cat X | head -5`, which costs one run
// marked invalid_run — visible, and never a fabricated contamination.
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

function shellReadTarget(command, depth = 0) {
  const trimmed = command.trim();
  const words = trimmed.split(/\s+/u).filter(Boolean);
  // Skip leading env assignments and `sudo`-style prefixes to find the utility.
  let index = 0;
  while (index < words.length && (/^\w+=/u.test(words[index]) || words[index] === "sudo")) {
    index += 1;
  }
  const utility = (words[index] ?? "").split("/").pop();

  // Codex runs every command as `/bin/bash -lc '<script>'` (measured), so without
  // unwrapping the inner script no codex run would ever count as a read.
  if (depth < 2 && SHELL_BINARIES.has(utility) && words.slice(index + 1).some(isShellCFlag)) {
    const inner = stripOuterQuotes(trimmed);
    return inner === null ? [] : shellReadTarget(inner, depth + 1);
  }

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

function stripQuotes(word) {
  return word.replaceAll(/^['"]|['"]$/gu, "");
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

function collectReadEvidence(toolName, input, sink) {
  if (typeof input !== "object" || input === null) {
    return;
  }
  for (const field of READ_TOOL_FIELDS.get(toolName) ?? []) {
    if (typeof input[field] === "string") {
      sink.push(input[field]);
    }
  }
  if (SHELL_TOOLS.has(toolName) && typeof input.command === "string") {
    sink.push(...shellReadTarget(input.command));
  }
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

  let sawNonResultEvent = false;
  for (const event of events) {
    if (event.type === "result") {
      resultEvent = event;
      continue;
    }
    sawNonResultEvent = true;
    if (event.type === "system" && event.subtype === "init" && Array.isArray(event.skills)) {
      visibleSkills = event.skills.filter((name) => typeof name === "string");
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
      collectReadEvidence(name, block.input, candidate);
      if (candidate.length === 0 && invoked === null) {
        continue;
      }
      // Without an id the result cannot be correlated, so the call never becomes
      // evidence — an uncorrelated call is exactly the case this guard exists for.
      if (typeof block.id === "string") {
        pendingEvidence.set(block.id, { texts: candidate, invoked });
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
        toolInputTexts.push(...shellReadTarget(event.item.command));
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
