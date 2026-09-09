import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashFixture(directory) {
  if (!directory) return digest("no-fixture\n");
  const root = resolve(directory);
  const entries = [];
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const child = resolve(path, name);
      const rel = relative(root, child).split("\\").join("/");
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) {
        throw new Error(`fixture symlink is not fingerprintable: ${rel}`);
      }
      if (stat.isDirectory()) visit(child);
      else if (stat.isFile())
        entries.push([rel, stat.mode & 0o111 ? "executable" : "file", digest(readFileSync(child))]);
      else throw new Error(`unsupported fixture entry: ${rel}`);
    }
  }
  visit(root);
  return digest(`${JSON.stringify(entries)}\n`);
}

export function assertionsForEval(evalsPath, evalId) {
  if (!evalId) return [];
  if (!evalsPath || !existsSync(evalsPath)) {
    throw new Error(`eval assertions unavailable for eval ${evalId}`);
  }
  const parsed = JSON.parse(readFileSync(evalsPath, "utf8"));
  const evaluation = parsed.evals?.find(({ id }) => String(id) === String(evalId));
  if (!evaluation) throw new Error(`eval ${evalId} not found in ${evalsPath}`);
  if (!Array.isArray(evaluation.assertions)) {
    throw new Error(`eval ${evalId} has no assertions array`);
  }
  return evaluation.assertions;
}

export function createFingerprint(input) {
  const inputs = stable(input);
  return {
    schema_version: 1,
    algorithm: "sha256",
    fingerprint: digest(`${JSON.stringify(inputs)}\n`),
    inputs,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined)
      throw new Error("arguments must be --name value pairs");
    values[flag.slice(2)] = value;
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = [
    "prompt",
    "executor",
    "model",
    "reasoning-effort",
    "cli-version",
    "harness-version",
  ];
  for (const name of required) if (!(name in args)) throw new Error(`missing --${name}`);
  const fingerprint = createFingerprint({
    assertions: assertionsForEval(args.evals, args["eval-id"]),
    eval_id: args["eval-id"] || null,
    executor: args.executor,
    fixture_sha256: hashFixture(args.fixture),
    harness_version: args["harness-version"],
    model: args.model,
    prompt: args.prompt,
    reasoning_effort: args["reasoning-effort"],
    cli_version: args["cli-version"],
  });
  process.stdout.write(`${JSON.stringify(fingerprint, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`skill-eval-fingerprint: ${error.message}`);
    process.exitCode = 1;
  }
}
