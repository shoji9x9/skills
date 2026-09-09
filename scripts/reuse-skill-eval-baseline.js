import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const requiredArtifacts = [
  "contamination.txt",
  "eval_metadata.json",
  "eval-fingerprint.json",
  "isolation.txt",
  "outputs/metrics.json",
  "outputs/response.md",
  "project-files-skipped.txt",
  "project-files",
  "project-tree.txt",
  "raw",
  "result.json",
  "stderr.log",
  "timing.json",
];

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`);
  }
}

export function validateReusableBaseline(source, expectedFingerprint) {
  for (const artifact of requiredArtifacts) {
    if (!existsSync(resolve(source, artifact)))
      throw new Error(`baseline artifact missing: ${artifact}`);
  }
  const actualFingerprint = readJson(
    resolve(source, "eval-fingerprint.json"),
    "baseline fingerprint",
  );
  for (const [label, fingerprint] of [
    ["expected", expectedFingerprint],
    ["baseline", actualFingerprint],
  ]) {
    if (fingerprint.schema_version !== 1 || fingerprint.algorithm !== "sha256") {
      throw new Error(`${label} fingerprint metadata is unsupported`);
    }
  }
  if (actualFingerprint.fingerprint !== expectedFingerprint.fingerprint) {
    throw new Error(
      `baseline fingerprint mismatch: expected ${expectedFingerprint.fingerprint}, got ${actualFingerprint.fingerprint ?? "missing"}`,
    );
  }
  const result = readJson(resolve(source, "result.json"), "baseline result");
  if (result.status !== "succeeded" || result.exit_code !== 0)
    throw new Error("baseline run did not succeed");
  if (typeof result.raw_trace !== "string" || !result.raw_trace) {
    throw new Error("baseline result has no raw_trace path");
  }
  const rawTrace = resolve(source, result.raw_trace);
  const relativeRawTrace = relative(source, rawTrace);
  if (
    relativeRawTrace === ".." ||
    relativeRawTrace.startsWith(`..${sep}`) ||
    isAbsolute(relativeRawTrace)
  ) {
    throw new Error("baseline raw_trace escapes the source run");
  }
  if (!existsSync(rawTrace) || readFileSync(rawTrace).length === 0) {
    throw new Error(`baseline raw trace missing or empty: ${result.raw_trace}`);
  }
  if (!/^verdict: clean$/mu.test(readFileSync(resolve(source, "contamination.txt"), "utf8"))) {
    throw new Error("baseline contamination verdict is not clean");
  }
}

export function reuseBaseline(sourceValue, targetValue, expectedPath) {
  const source = resolve(sourceValue);
  const target = resolve(targetValue);
  if (
    basename(dirname(source)) !== "without_skill" ||
    !/^run-[1-9][0-9]*$/u.test(basename(source))
  ) {
    throw new Error("reusable baseline source must be under without_skill/run-N");
  }
  if (source === target || relative(source, target).split("/")[0] !== "..") {
    throw new Error("reuse target must not be the source or nested inside it");
  }
  if (existsSync(target)) throw new Error(`reuse target already exists: ${target}`);
  const expectedFingerprint = readJson(expectedPath, "expected fingerprint");
  validateReusableBaseline(source, expectedFingerprint);
  cpSync(source, target, { recursive: true, errorOnExist: true });
  writeFileSync(
    resolve(target, "baseline-reuse.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        reused_from: isAbsolute(sourceValue) ? source : sourceValue,
        source_run: basename(source),
        source_configuration: basename(dirname(source)),
        fingerprint: expectedFingerprint.fingerprint,
        executor: expectedFingerprint.inputs.executor,
        model: expectedFingerprint.inputs.model,
        reasoning_effort: expectedFingerprint.inputs.reasoning_effort,
        cli_version: expectedFingerprint.inputs.cli_version,
        harness_version: expectedFingerprint.inputs.harness_version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function main() {
  const [source, target, expectedPath] = process.argv.slice(2);
  if (!source || !target || !expectedPath) {
    throw new Error(
      "usage: reuse-skill-eval-baseline.js <source-run> <target-run> <expected-fingerprint>",
    );
  }
  reuseBaseline(source, target, expectedPath);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`reuse-skill-eval-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}
