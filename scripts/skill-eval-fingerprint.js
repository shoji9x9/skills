import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function formatError(error) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
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

function findEval(evalsPath, evalId) {
  if (!evalsPath || !existsSync(evalsPath)) {
    throw new Error(`eval definition unavailable for eval ${evalId}`);
  }
  const parsed = JSON.parse(readFileSync(evalsPath, "utf8"));
  const evaluation = parsed.evals?.find(({ id }) => String(id) === String(evalId));
  if (!evaluation) throw new Error(`eval ${evalId} not found in ${evalsPath}`);
  return evaluation;
}

export function assertionsForEval(evalsPath, evalId) {
  if (!evalId) return [];
  const evaluation = findEval(evalsPath, evalId);
  if (!Array.isArray(evaluation.assertions)) {
    throw new Error(`eval ${evalId} has no assertions array`);
  }
  return evaluation.assertions;
}

// Sibling skills a with_skill run installs next to the subject skill. A skill whose
// steps call a sibling's bundled tool (parity-component → parity-suite) cannot reach
// the branch an eval targets when the disposable project holds only the subject, so
// the eval declares the dependency instead of the fixture faking the sibling's files.
// Every malformed shape fails: a dropped name would silently reintroduce that gap.
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export function requiredSkillsForEval(evalsPath, evalId, subjectSkill) {
  if (!evalId) return [];
  const evaluation = findEval(evalsPath, evalId);
  if (!Object.hasOwn(evaluation, "requires_skills")) return [];
  const names = evaluation.requires_skills;
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`eval ${evalId} requires_skills must be a non-empty array`);
  }
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== "string" || !SKILL_NAME.test(name)) {
      throw new Error(
        `eval ${evalId} requires_skills has an invalid skill name: ${JSON.stringify(name)}`,
      );
    }
    if (name === subjectSkill) {
      throw new Error(`eval ${evalId} requires_skills lists the subject skill itself: ${name}`);
    }
    if (seen.has(name)) throw new Error(`eval ${evalId} requires_skills lists ${name} twice`);
    seen.add(name);
  }
  return names;
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
  if (args["required-skills-of"] !== undefined) {
    // Print mode for the harness: one required skill per line, from the same parser
    // the fingerprint uses, so installation and fingerprint cannot disagree.
    for (const name of requiredSkillsForEval(
      args.evals,
      args["eval-id"],
      args["required-skills-of"],
    ))
      process.stdout.write(`${name}\n`);
    return;
  }
  for (const name of required) if (!(name in args)) throw new Error(`missing --${name}`);
  const requiredSkills = requiredSkillsForEval(args.evals, args["eval-id"], args.skill);
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
    // Only when declared, so fingerprints of evals without dependencies stay unchanged
    // and their recorded baselines remain reusable. A baseline installs no skill, but
    // its contamination markers include the required skills' bundles.
    ...(requiredSkills.length > 0 ? { required_skills: requiredSkills } : {}),
  });
  process.stdout.write(`${JSON.stringify(fingerprint, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`skill-eval-fingerprint: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
