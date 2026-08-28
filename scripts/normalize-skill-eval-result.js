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

export function parseClaudeTrace(rawText) {
  const payload = JSON.parse(rawText);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Claude trace must be a JSON object");
  }
  return {
    finalResponse: typeof payload.result === "string" ? payload.result : "",
    usage: normalizeUsage("claude-code", payload.usage),
    toolCalls: null,
    totalToolCalls: null,
    totalSteps: numberOrZero(payload.num_turns),
    errors: payload.is_error === true ? 1 : 0,
    fatalErrors: payload.is_error === true ? 1 : 0,
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
      if (typeof event.item.exit_code === "number" && event.item.exit_code !== 0) {
        errors += 1;
      }
    }
  }

  return { finalResponse, usage, toolCalls, totalToolCalls, totalSteps, errors, fatalErrors };
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
