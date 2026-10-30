import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  type Stats,
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
  // existsSync はリンクをたどるので、指す先の無いリンクを「無い」と判定して、その先を見ずに祖先へ上がる。
  while (!lstatSync(existing, { throwIfNoEntry: false }) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}

/** パスを解決する処理の失敗（祖先が指す先の無いリンク・途中がファイル）を、どの引数かが分かる形で報告する。 */
function resolving<T>(label: string, path: string, resolve: (path: string) => T): T {
  try {
    return resolve(path);
  } catch (error) {
    throw new Error(`${label} cannot be resolved: ${path}: ${errorMessage(error)}`);
  }
}

/** 必須の成果物がそろっていることを確かめる。リンクでないことは assertOnlyFilesAndDirectories が先に確かめる。 */
function assertArtifactsPresent(source: string): void {
  for (const artifact of requiredArtifacts) {
    if (!existsSync(resolve(source, artifact))) {
      throw new Error(`baseline artifact missing: ${artifact}`);
    }
  }
}

/**
 * 通常のファイルとディレクトリ以外の要素を、木を確かめるときとコピーするときの両方で同じ文で拒否する。
 * 判定に使った lstat の結果を返し、呼び出し側はそれで再帰するかを決める（readdir の型と食い違わないように）。
 */
function assertFileOrDirectory(path: string, name: string): Stats {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`baseline contains a symlink: ${name}`);
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error(`baseline contains an entry that is not a file or directory: ${name}`);
  }
  return stat;
}

/**
 * source の木に、通常のファイルとディレクトリ以外が無いことを確かめる（#766）。
 * ハーネスが書く baseline はリンクを含まないので、シンボリックリンクは指す先に関わらず受け入れない。
 * 受け入れるなら、リンクごとに 3 つを判定することになる。途中のディレクトリを通して source の外を読むか・
 * 循環するか・確かめた後に指す先が変わるかである。
 * FIFO・socket・デバイスも、読むと止まるか外の状態に依存するので受け入れない。
 * ハードリンクは受け入れる（Issue #766 の prepare の決定）。lstat の nlink では、同じ実体を持つ相手が
 * source の中か外かを判定できない。
 */
function assertOnlyFilesAndDirectories(realSource: string): void {
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (assertFileOrDirectory(path, relative(realSource, path)).isDirectory()) walk(path);
    }
  };
  // source が無いときは、assertArtifactsPresent が欠けた成果物の名前で報告する。
  if (lstatSync(realSource, { throwIfNoEntry: false })?.isDirectory()) walk(realSource);
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
  // source の木にリンクが無いことは assertOnlyFilesAndDirectories が確かめるので、字面で比べれば足りる。
  if (escapes(source, rawTrace)) throw new Error("baseline raw_trace escapes the source run");
  const stat = lstatSync(rawTrace, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size === 0) {
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

/** 再利用してよい baseline かを、source を realpath で解決した実体（realSource）で確かめる。 */
function validateReusableBaseline(realSource: string, expectedFingerprint: Fingerprint): void {
  assertOnlyFilesAndDirectories(realSource);
  assertArtifactsPresent(realSource);
  assertFingerprintMatches(realSource, expectedFingerprint);
  assertSucceededWithRawTrace(realSource);
  assertCleanAndIsolated(realSource);
}

/** 既にある target に当たったときの cpSync の失敗か。この呼び出しが target を作っていないので、消さない。 */
function isExistError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ERR_FS_CP_EEXIST" || code === "EEXIST";
}

/**
 * 確かめた木を target にコピーし、再利用の記録を書く。確かめた後に足されたリンクや FIFO も、コピーする要素ごとに
 * 同じ判定で拒否する。ルートは確かめた realSource なので filter を当てず、既にある target は force: false の
 * EEXIST で止める。それ以外の理由で失敗したら（拒否・EACCES・書き込みの失敗）、この呼び出しが作った target を消す。
 */
function copyVerifiedTree(realSource: string, target: string, writeRecord: () => void): void {
  try {
    cpSync(realSource, target, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (path) =>
        path === realSource || Boolean(assertFileOrDirectory(path, relative(realSource, path))),
    });
    writeRecord();
  } catch (error) {
    if (!isExistError(error)) rmSync(target, { recursive: true, force: true });
    throw error;
  }
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
  const targetStat = resolving("reuse target", target, (path) =>
    lstatSync(path, { throwIfNoEntry: false }),
  );
  // 指す先の無いリンクも在るとして扱う。cpSync はそれをコピー先にすると、例外を投げずに node ごと異常終了する。
  // target 自体のリンクは、realpath で解決する前に、ENOENT ではなくこのメッセージで報告する。
  if (targetStat?.isSymbolicLink()) throw new Error(`reuse target already exists: ${target}`);
  // source がシンボリックリンクの下にあっても同じ結果になるよう、両辺を同じ realpath で解決して比べる。
  const realSource = resolving("reusable baseline source", source, realpathOfNearest);
  if (!escapes(realSource, resolving("reuse target", target, realpathOfNearest))) {
    throw new Error("reuse target must not be the source or nested inside it");
  }
  if (targetStat) throw new Error(`reuse target already exists: ${target}`);
  const expectedFingerprint = readJson<Fingerprint>(expectedPath, "expected fingerprint");
  // run のディレクトリ自体のリンクも、木の中のリンクと同じに受け入れない。祖先のリンクは受け入れる。
  if (lstatSync(source, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("baseline contains a symlink: .");
  }
  validateReusableBaseline(realSource, expectedFingerprint);
  const record = reuseRecord(sourceValue, source, expectedFingerprint);
  copyVerifiedTree(realSource, target, () =>
    writeFileSync(resolve(target, "baseline-reuse.json"), record, "utf8"),
  );
}

/** target に書く baseline-reuse.json の本文。 */
function reuseRecord(
  sourceValue: string,
  source: string,
  expectedFingerprint: Fingerprint,
): string {
  return `${JSON.stringify(
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
  )}\n`;
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
