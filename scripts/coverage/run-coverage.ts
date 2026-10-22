#!/usr/bin/env node
// テスト全体をカバレッジ付きで実行し、ファイルごとの値を閾値（coverage-thresholds.json）と比べる（lefthook pre-push と CI）。
//
// 測り方は次のとおり。
// - JavaScript・TypeScript は c8 で測る。c8 は NODE_V8_COVERAGE を設定して vitest を起動するので、
//   テストが子プロセスとして起動した CLI の分も集まる。vitest の coverage-v8 はワーカーの中しか測らず、
//   CLI を子プロセスで確かめるテストの分が 0 になる。
//   ワーカーの分は、vitest-coverage-setup.ts が各テストファイルの最後に `v8.takeCoverage()` で書き出す。
//   ワーカーは終了の処理を経ずに止められるので、書き出さないと NODE_V8_COVERAGE に残らない。
//   位置がずれないよう、vitest.config.ts で vite の変換を外し、Node が直接ファイルを読み込むようにしている。
// - シェルスクリプトは、BASH_ENV で bash-trace-env.sh を読み込ませて xtrace を記録し、shell-coverage.ts で集計する。
//
// 使い方:
//   node scripts/coverage/run-coverage.ts           # 測って比べる。
//   node scripts/coverage/run-coverage.ts --reuse   # 前回の測定の結果を使って比べるだけにする（閾値を調整するとき）。
//   node scripts/coverage/run-coverage.ts --focus skills/kaizen/ -- scripts/skills/kaizen/
//       # 一部のテストだけを実行し、--focus で始まるファイルだけを比べる（テストを足しながら確かめるとき）。
//       # `--` の後は vitest に渡す。--focus は何度でも書ける。結果は実行ごとに別のディレクトリに置くので、並べて実行できる。
//
// 結果は node_modules/.cache/coverage/ に置く。HTML のレポートは report/index.html にある（GitHub Actions では作らない）。
// --focus の結果は実行ごとのディレクトリに置く。次の --focus の実行が、終わった実行の結果のディレクトリを消す。
// 終了コード: 0 はすべて閾値以上、1 は閾値を下回るファイルか設定の古い記述がある、またはテストが失敗した、
// 2 は判定できない（設定の形の誤り・測定の失敗・前回の結果が無い）。
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, isErrnoException } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import {
  type Config,
  type FileMeasure,
  METRICS,
  describe,
  evaluate,
  kindOf,
  loadConfig,
} from "./check-coverage.ts";
import { shellCoverage } from "./shell-coverage.ts";
import { VENDORED_GLOBS, isVendored } from "../lib/source-scope.ts";

const CACHE = "node_modules/.cache/coverage";

/** private skill のディレクトリ（`.agents/skills/<name>/` のうち `.private-skill` を持つもの）。リポジトリからの相対パスで、末尾に `/` を付ける。 */
export function privateSkillDirs(root: string): string[] {
  const base = join(root, ".agents", "skills");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => existsSync(join(base, name, ".private-skill")))
    .map((name) => `.agents/skills/${name}/`)
    .sort();
}

/**
 * 測る対象のファイル（scripts/・skills/ と private skill の下）。git が管理するファイルに加え、まだ add していない新しいファイルも含める。
 * 含めないと、commit する前の手元の実行では新しいファイルを比べず、commit した後の CI で初めて閾値を下回ることが分かる。
 * `.agents/skills/` のうち private skill でないものは、skills/ のインストール済みのコピーなので測らない。
 */
export function targetFiles(root: string): string[] {
  const privates = privateSkillDirs(root);
  const args = [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "scripts",
    "skills",
    ...privates,
  ];
  const res = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`git ls-files に失敗した: ${res.stderr}`);
  const files = [...new Set(res.stdout.split("\0"))].filter(
    (f) => f !== "" && kindOf(f) !== null && !isVendored(f),
  );
  if (files.length === 0) throw new Error("測る対象のファイルが 0 件である");
  return files.sort();
}

/** 実行中かを pid で決められないときに、実行中とみなす期間。--focus の実行は数分で終わる。 */
export const FOCUS_STALE_MS = 60 * 60 * 1000;

/**
 * 終わった --focus の実行が残した結果のディレクトリ（`coverage-focus-<pid>-<一意な文字列>`）を消す。
 * 名前に一意な文字列を付けるのは、pid の名前空間の違う実行どうしで pid が同じでも、同じディレクトリを使わないためである。
 * 消すのは、pid のプロセスが無く、かつ更新から FOCUS_STALE_MS が過ぎたものだけである。
 * pid だけで決めると、pid の名前空間の違う環境（コンテナとホスト）で node_modules を共有したときに、実行中の結果を消す。
 * pid が再利用されて残ったものは、次に pid が空いたときに消える。
 */
export function sweepFocusDirs(root: string, now: number = Date.now()): void {
  const parent = join(root, dirname(CACHE));
  if (!existsSync(parent)) return;
  const prefix = `${basename(CACHE)}-focus-`;
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length).split("-")[0]);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue;
    const dir = join(parent, name);
    // 並べて実行した別の --focus が先に消していれば、在るかを確かめた後でも無いことがある。
    const stat = statSync(dir, { throwIfNoEntry: false });
    if (stat === undefined || now - stat.mtimeMs < FOCUS_STALE_MS) continue;
    rmSync(dir, { recursive: true, force: true });
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM は、別の利用者のプロセスとして在ることを示す。
    return isErrnoException(error) && error.code === "EPERM";
  }
}

/** c8 の json-summary を、リポジトリからの相対パスの測定値にする。 */
export function readC8Summary(root: string, value: unknown): Map<string, FileMeasure> {
  if (!isRecord(value)) throw new Error("c8 の coverage-summary.json が object でない");
  const measures = new Map<string, FileMeasure>();
  for (const [abs, entry] of Object.entries(value)) {
    if (abs === "total") continue;
    if (!isRecord(entry)) throw new Error(`c8 の結果の ${abs} が object でない`);
    const measure: FileMeasure = {};
    for (const metric of METRICS) {
      const m = entry[metric];
      if (!isRecord(m) || typeof m.pct !== "number")
        throw new Error(`c8 の結果の ${abs} に ${metric}.pct が無い`);
      measure[metric] = m.pct;
    }
    measures.set(relative(root, abs), measure);
  }
  return measures;
}

/** c8 に渡す引数。測る対象・除く対象・結果の置き場所・レポートの形式を並べ、最後に vitest の起動を続ける。 */
function c8Args(
  privates: readonly string[],
  cache: string,
  vitestArgs: readonly string[],
): string[] {
  return [
    "exec",
    "c8",
    "--all",
    "--src",
    "scripts",
    "--src",
    "skills",
    ...privates.flatMap((dir) => ["--src", dir]),
    ...[
      "scripts/**/*.ts",
      "skills/**/*.mjs",
      "skills/**/*.ts",
      ...privates.flatMap((dir) => [`${dir}**/*.mjs`, `${dir}**/*.ts`]),
    ].flatMap((p) => ["--include", p]),
    // 外部のパッケージから作った生成物（scripts/lib/source-scope.ts の VENDORED_GLOBS）は、このリポジトリのテストの対象ではない。
    ...["**/*.test.ts", "**/*.d.ts", ...VENDORED_GLOBS].flatMap((p) => ["--exclude", p]),
    "--temp-directory",
    join(cache, "v8"),
    "--report-dir",
    join(cache, "report"),
    "--reporter",
    "json-summary",
    // HTML のレポートは手元で未実行の行を見るためのもので、GitHub Actions のジョブでは残さないので作らない。
    ...(process.env.GITHUB_ACTIONS === "true" ? [] : ["--reporter", "html"]),
    "--reporter",
    "text-summary",
    "vitest",
    "run",
    ...vitestArgs,
  ];
}

/** `measure` が受け取る、リポジトリの直下・結果の置き場所・測る対象のファイル・vitest に渡す引数。 */
interface MeasureOptions {
  root: string;
  cache: string;
  files: readonly string[];
  vitestArgs: readonly string[];
}

/** c8 で vitest を実行して測り、シェルの記録を集計して shell-summary.json に書く。テストの終了コードを返す。 */
function measure({ root, cache, files, vitestArgs }: MeasureOptions): number {
  // private skill の列挙で例外が出ても空の shell-trace を残さないよう、shell-trace を作る前に求める
  // （置き場所の cache そのものは呼び出し元が先に作っている）。
  const privates = privateSkillDirs(root);
  const traceDir = join(cache, "shell-trace");
  mkdirSync(traceDir, { recursive: true });
  const res = spawnSync("pnpm", c8Args(privates, cache, vitestArgs), {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      BASH_ENV: join(root, "scripts/coverage/bash-trace-env.sh"),
      SHELL_COVERAGE_DIR: traceDir,
    },
  });
  try {
    if (res.error) throw res.error;
    if (res.status !== 0) return res.status ?? 1;
    const sh = shellCoverage(
      root,
      files.filter((f) => kindOf(f) === "sh"),
      traceDir,
    );
    writeFileSync(join(cache, "shell-summary.json"), `${JSON.stringify(sh, null, 2)}\n`);
    return 0;
  } finally {
    // 比べるのに使うのは 2 つの要約とレポートだけである。元の記録は数百 MB になるので、
    // テストが失敗したときも消す（--focus の実行は実行ごとに別のディレクトリを作るので、残すと溜まる）。
    rmSync(join(cache, "v8"), { recursive: true, force: true });
    rmSync(traceDir, { recursive: true, force: true });
  }
}

/** `reportFocus` が受け取る、閾値の設定・対象のファイル・測定値・--focus の接頭辞・結果の置き場所。 */
interface FocusReport {
  config: Config;
  files: readonly string[];
  measures: ReadonlyMap<string, FileMeasure>;
  focus: readonly string[];
  cache: string;
}

/** --focus の実行の結果を出す。対象のファイルごとの値と、閾値を下回るものを出す。 */
function reportFocus({ config, files, measures, focus, cache }: FocusReport): number {
  const inFocus = (path: string) => focus.some((prefix) => path.startsWith(prefix));
  for (const file of files.filter(inFocus)) {
    const m = measures.get(file);
    const values = m
      ? METRICS.filter((k) => m[k] !== undefined).map((k) => `${k} ${m[k]}%`)
      : ["測定なし"];
    console.log(`${file}: ${values.join(", ")}`);
  }
  const findings = evaluate(config, files, measures).filter((f) =>
    inFocus("file" in f ? f.file : f.path),
  );
  for (const f of findings) console.error(describe(f));
  console.log(
    `run-coverage: 結果は ${cache} にある（シェルの未実行の行は shell-summary.json の uncovered）`,
  );
  return findings.length > 0 ? 1 : 0;
}

/** 解析した CLI の引数。 */
interface CliArgs {
  reuse: boolean;
  focus: string[];
  vitestArgs: string[];
}

/** CLI の引数を解析する。知らない引数・値の無い --focus・組み合わせの誤りは、理由を出して undefined を返す。 */
function parseArgs(argv: readonly string[]): CliArgs | undefined {
  const args: CliArgs = { reuse: false, focus: [], vitestArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      args.vitestArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--reuse") args.reuse = true;
    else if (arg === "--focus" && argv[i + 1] !== undefined && argv[i + 1] !== "")
      args.focus.push(argv[++i] ?? "");
    else {
      console.error(`run-coverage: 知らない引数か、値の無い --focus: ${arg}`);
      return undefined;
    }
  }
  if (args.vitestArgs.length > 0 && args.focus.length === 0) {
    console.error(
      "run-coverage: テストを絞るときは --focus も指定する（絞った実行で全体の閾値は比べられない）",
    );
    return undefined;
  }
  if (args.reuse && args.focus.length > 0) {
    console.error("run-coverage: --reuse と --focus は一緒に使えない");
    return undefined;
  }
  return args;
}

/**
 * 結果の置き場所を用意して、そのパスを返す。用意できなければ、理由を出して undefined を返す。
 * --focus は実行ごとに一意なディレクトリを作り、通常の実行は前回の結果を消してから測る。
 */
function prepareCache(root: string, { focus, reuse }: CliArgs): string | undefined {
  let cache = join(root, CACHE);
  try {
    if (focus.length > 0) {
      sweepFocusDirs(root);
      mkdirSync(dirname(cache), { recursive: true });
      cache = mkdtempSync(`${cache}-focus-${process.pid}-`);
    } else if (!reuse) {
      rmSync(cache, { recursive: true, force: true });
    }
  } catch (error) {
    // 置き場所を用意できないのは、閾値を下回ったこと（exit 1）ではなく、判定できないこと（exit 2）である。
    console.error(
      `run-coverage: 判定できない: 結果の置き場所を用意できない: ${errorMessage(error)}`,
    );
    return undefined;
  }
  return cache;
}

/** c8 の要約とシェルの要約を読み、ファイルごとの測定値にまとめる。形が誤っていれば Error を投げる。 */
function readMeasures(root: string, c8Path: string, shPath: string): Map<string, FileMeasure> {
  const measures = readC8Summary(root, JSON.parse(readFileSync(c8Path, "utf8")));
  const sh: unknown = JSON.parse(readFileSync(shPath, "utf8"));
  if (!isRecord(sh) || !isRecord(sh.files)) throw new Error(`${shPath} に files が無い`);
  for (const [file, entry] of Object.entries(sh.files)) {
    if (!isRecord(entry) || typeof entry.pct !== "number")
      throw new Error(`${shPath} の ${file} に pct が無い`);
    measures.set(file, { lines: entry.pct });
  }
  if (typeof sh.unresolved === "number" && sh.unresolved > 0) {
    console.log(
      `run-coverage: ファイルに解決できなかったシェルの記録 ${sh.unresolved} 件（テストが消した一時ファイルなど）`,
    );
  }
  return measures;
}

/** 測り（--reuse なら測らず）、測定値を読む。テストの失敗と判定できないことは、終了コードの数値で返す。 */
function measureAndRead(
  { root, cache, files, vitestArgs }: MeasureOptions,
  reuse: boolean,
): { ok: true; measures: Map<string, FileMeasure> } | { ok: false; code: number } {
  const c8Path = join(cache, "report", "coverage-summary.json");
  const shPath = join(cache, "shell-summary.json");
  if (!reuse) {
    try {
      const status = measure({ root, cache, files, vitestArgs });
      if (status !== 0) {
        console.error(`run-coverage: テストが失敗した（exit ${status}）。カバレッジは比べない`);
        return { ok: false, code: 1 };
      }
    } catch (error) {
      console.error(`run-coverage: 判定できない: 測定に失敗した: ${errorMessage(error)}`);
      return { ok: false, code: 2 };
    }
  }
  if (!existsSync(c8Path) || !existsSync(shPath)) {
    console.error(`run-coverage: 判定できない: 測定の結果が無い（${c8Path}・${shPath}）`);
    return { ok: false, code: 2 };
  }
  try {
    return { ok: true, measures: readMeasures(root, c8Path, shPath) };
  } catch (error) {
    console.error(`run-coverage: 判定できない: 測定の結果を読めない: ${errorMessage(error)}`);
    return { ok: false, code: 2 };
  }
}

/** 全体の実行の結果を出す。閾値を下回るものと、比べたファイルの件数を出す。 */
function reportAll(
  config: Config,
  files: readonly string[],
  measures: ReadonlyMap<string, FileMeasure>,
): number {
  const findings = evaluate(config, files, measures);
  for (const f of findings) console.error(describe(f));
  const checked = files.filter((f) => !config.exclude.some((e) => e.path === f)).length;
  if (findings.length > 0) {
    console.error(
      `run-coverage: ${findings.length} 件（対象 ${files.length} ファイル、比べた ${checked} ファイル）`,
    );
    return 1;
  }
  console.log(
    `run-coverage: 対象 ${files.length} ファイルのうち ${checked} ファイルが閾値以上（除外 ${files.length - checked}）`,
  );
  return 0;
}

/** CLI の本体。`root` はリポジトリの直下で、テストが一時ディレクトリに作った最小のリポジトリを渡す。 */
export function main(
  argv: readonly string[],
  root = fileURLToPath(new URL("../../", import.meta.url)),
): number {
  const args = parseArgs(argv);
  if (args === undefined) return 2;
  const { focus, vitestArgs } = args;
  let config;
  let files;
  try {
    config = loadConfig(root);
    files = targetFiles(root);
  } catch (error) {
    console.error(`run-coverage: 判定できない: ${errorMessage(error)}`);
    return 2;
  }
  // 測る前に確かめる。当たるファイルが無いと、テストを実行し終えてから何も比べずに止まる。
  if (focus.length > 0 && !files.some((f) => focus.some((prefix) => f.startsWith(prefix)))) {
    console.error(`run-coverage: --focus に当たる対象のファイルが無い: ${focus.join(" ")}`);
    return 2;
  }
  // 結果の置き場所は、測ると決まってから作る（引数・設定・対象の誤りで止まる実行に、空のディレクトリを残さない）。
  const cache = prepareCache(root, args);
  if (cache === undefined) return 2;
  const measured = measureAndRead({ root, cache, files, vitestArgs }, args.reuse);
  if (!measured.ok) return measured.code;
  const { measures } = measured;
  if (focus.length > 0) return reportFocus({ config, files, measures, focus, cache });
  return reportAll(config, files, measures);
}

function isCliEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`run-coverage: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(2);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
