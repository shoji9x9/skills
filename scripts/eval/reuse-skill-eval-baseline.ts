import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { errorMessage } from "../lib/errors.ts";
import { parseJsonAs } from "../lib/parse-as.ts";
import { showValue } from "../lib/show-value.ts";
import { isCliEntry } from "../lib/cli/entry.ts";

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

// eval-fingerprint.json as skill-eval-fingerprint.ts writes it.
type Fingerprint = {
  schema_version?: unknown;
  algorithm?: unknown;
  fingerprint?: unknown;
  inputs: Record<string, unknown>;
};

// The caller declares the shape it reads.
function readJson<T>(path: string, label: string): T {
  try {
    return parseJsonAs<T>(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${errorMessage(error)}`);
  }
}

export function formatError(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}

/** path が root の外にあるかを、パスの字面で判定する。 */
function escapes(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

/** 存在しない末尾を残したまま、存在する最も近い祖先までを realpath で解決する。 */
function realpathOfNearest(path: string): string {
  const rest: string[] = [];
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}

/** 必須の成果物がそろい、どれもシンボリックリンクでないことを確かめる。 */
function assertArtifactsPresent(source: string): void {
  for (const artifact of requiredArtifacts) {
    const artifactPath = resolve(source, artifact);
    if (!existsSync(artifactPath)) throw new Error(`baseline artifact missing: ${artifact}`);
    if (lstatSync(artifactPath).isSymbolicLink()) {
      throw new Error(`baseline artifact must not be a symlink: ${artifact}`);
    }
  }
}

/**
 * source の木の中のシンボリックリンクを、実体が source の中にあるものだけに限る（#766）。
 * source の外を指すリンクがあると、必須の成果物や raw_trace が途中のディレクトリを通して外のファイルを読む。
 * 受け入れたリンクは、コピーのときに実体へ置き換えるので（dereference）、target にはリンクが残らない。
 * 自分を含むディレクトリを指すリンクは、置き換えると終わらないので受け入れない。
 */
function assertSymlinksStayInside(realSource: string): void {
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(realSource, path);
      if (entry.isSymbolicLink()) {
        if (!existsSync(path)) throw new Error(`baseline symlink is dangling: ${name}`);
        const linkTarget = realpathSync(path);
        if (escapes(realSource, linkTarget)) {
          throw new Error(`baseline symlink escapes the source run: ${name}`);
        }
        if (!escapes(linkTarget, directory)) {
          throw new Error(`baseline symlink points to a directory that contains it: ${name}`);
        }
      } else if (entry.isDirectory()) {
        walk(path);
      }
    }
  };
  walk(realSource);
}

/** baseline の fingerprint が期待した fingerprint と同じ形式・同じ値であることを確かめる。 */
function assertFingerprintMatches(source: string, expectedFingerprint: Fingerprint): void {
  const actualFingerprint = readJson<Fingerprint>(
    resolve(source, "eval-fingerprint.json"),
    "baseline fingerprint",
  );
  for (const [label, fingerprint] of [
    ["expected", expectedFingerprint],
    ["baseline", actualFingerprint],
  ] as const) {
    if (fingerprint.schema_version !== 1 || fingerprint.algorithm !== "sha256") {
      throw new Error(`${label} fingerprint metadata is unsupported`);
    }
  }
  if (actualFingerprint.fingerprint !== expectedFingerprint.fingerprint) {
    throw new Error(
      `baseline fingerprint mismatch: expected ${String(expectedFingerprint.fingerprint)}, got ${showValue(actualFingerprint.fingerprint ?? "missing")}`,
    );
  }
}

/** baseline の実行が成功し、raw_trace が source の中にある空でない通常のファイルを指すことを確かめる。 */
function assertSucceededWithRawTrace(source: string): void {
  const result = readJson<{ status?: unknown; exit_code?: unknown; raw_trace?: unknown }>(
    resolve(source, "result.json"),
    "baseline result",
  );
  if (result.status !== "succeeded" || result.exit_code !== 0)
    throw new Error("baseline run did not succeed");
  if (typeof result.raw_trace !== "string" || !result.raw_trace) {
    throw new Error("baseline result has no raw_trace path");
  }
  // 絶対パスは、target にコピーした後も元の source を指すので受け入れない。
  if (isAbsolute(result.raw_trace)) throw new Error("baseline raw_trace must be relative");
  const rawTrace = resolve(source, result.raw_trace);
  // 途中のディレクトリのシンボリックリンクは、assertSymlinksStayInside が source の中を指すものに限る。
  if (escapes(source, rawTrace)) throw new Error("baseline raw_trace escapes the source run");
  const stat = lstatSync(rawTrace, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
    throw new Error(`baseline raw trace missing or empty: ${result.raw_trace}`);
  }
}

/** 汚染の判定が clean で、読み取りの隔離が信頼できる sandbox のものであることを確かめる。 */
function assertCleanAndIsolated(source: string): void {
  if (!/^verdict: clean$/mu.test(readFileSync(resolve(source, "contamination.txt"), "utf8"))) {
    throw new Error("baseline contamination verdict is not clean");
  }
  // The sandbox moved to scripts/eval/ (Issue #514); baselines recorded before the move
  // carry the old path and came from the same sandbox, so both labels are trusted.
  if (
    !/^isolation: sandboxed \(scripts\/(?:eval\/)?eval-sandbox\.sh\)$/mu.test(
      readFileSync(resolve(source, "isolation.txt"), "utf8"),
    )
  ) {
    throw new Error("baseline read isolation is not trusted");
  }
}

/** 再利用してよい baseline かを確かめ、コピー元にする source の実体のパスを返す。 */
function validateReusableBaseline(source: string, expectedFingerprint: Fingerprint): string {
  assertArtifactsPresent(source);
  const realSource = realpathSync(source);
  assertSymlinksStayInside(realSource);
  assertFingerprintMatches(realSource, expectedFingerprint);
  assertSucceededWithRawTrace(realSource);
  assertCleanAndIsolated(realSource);
  return realSource;
}

function reuseBaseline(sourceValue: string, targetValue: string, expectedPath: string): void {
  const source = resolve(sourceValue);
  const target = resolve(targetValue);
  if (
    basename(dirname(source)) !== "without_skill" ||
    !/^run-[1-9][0-9]*$/u.test(basename(source))
  ) {
    throw new Error("reusable baseline source must be under without_skill/run-N");
  }
  // source がシンボリックリンクの下にあっても同じ結果になるよう、両辺を同じ realpath で解決して比べる。
  const realTarget = realpathOfNearest(target);
  if (!escapes(realpathOfNearest(source), realTarget)) {
    throw new Error("reuse target must not be the source or nested inside it");
  }
  if (existsSync(target)) throw new Error(`reuse target already exists: ${target}`);
  const expectedFingerprint = readJson<Fingerprint>(expectedPath, "expected fingerprint");
  const realSource = validateReusableBaseline(source, expectedFingerprint);
  // 確かめた実体の木からコピーする。source の中のリンクは、run 自体のリンクも含めて実体に置き換え、
  // target が元の source を指さないようにする。
  cpSync(realSource, target, { recursive: true, errorOnExist: true, dereference: true });
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
      "usage: reuse-skill-eval-baseline.ts <source-run> <target-run> <expected-fingerprint>",
    );
  }
  reuseBaseline(source, target, expectedPath);
}

if (isCliEntry(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`reuse-skill-eval-baseline: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
