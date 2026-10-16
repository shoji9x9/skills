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
// 結果は node_modules/.cache/coverage/ に置く。HTML のレポートは report/index.html にある。
// 終了コード: 0 はすべて閾値以上、1 は閾値を下回るファイルか設定の古い記述がある、またはテストが失敗した、
// 2 は判定できない（設定の形の誤り・測定の失敗・前回の結果が無い）。
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../lib/errors.ts";
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
  const files = [...new Set(res.stdout.split("\0"))].filter((f) => f !== "" && kindOf(f) !== null);
  if (files.length === 0) throw new Error("測る対象のファイルが 0 件である");
  return files.sort();
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

function measure(
  root: string,
  cache: string,
  files: readonly string[],
  vitestArgs: readonly string[],
): number {
  const privates = privateSkillDirs(root);
  rmSync(cache, { recursive: true, force: true });
  const traceDir = join(cache, "shell-trace");
  mkdirSync(traceDir, { recursive: true });
  const c8Args = [
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
    ...["**/*.test.ts", "**/*.d.ts"].flatMap((p) => ["--exclude", p]),
    "--temp-directory",
    join(cache, "v8"),
    "--report-dir",
    join(cache, "report"),
    "--reporter",
    "json-summary",
    // HTML のレポートは手元で未実行の行を見るためのもので、CI では残さないので作らない（GitHub Actions は CI=true を渡す）。
    ...(process.env.CI === "true" ? [] : ["--reporter", "html"]),
    "--reporter",
    "text-summary",
    "vitest",
    "run",
    ...vitestArgs,
  ];
  const res = spawnSync("pnpm", c8Args, {
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

/** --focus の実行の結果を出す。対象のファイルごとの値と、閾値を下回るものを出す。 */
function reportFocus(
  config: Config,
  files: readonly string[],
  measures: ReadonlyMap<string, FileMeasure>,
  focus: readonly string[],
  cache: string,
): number {
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

/** CLI の本体。`root` はリポジトリの直下で、テストが一時ディレクトリに作った最小のリポジトリを渡す。 */
export function main(
  argv: readonly string[],
  root = fileURLToPath(new URL("../../", import.meta.url)),
): number {
  let reuse = false;
  const focus: string[] = [];
  const vitestArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      vitestArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--reuse") reuse = true;
    else if (arg === "--focus" && argv[i + 1] !== undefined && argv[i + 1] !== "")
      focus.push(argv[++i] ?? "");
    else {
      console.error(`run-coverage: 知らない引数か、値の無い --focus: ${arg}`);
      return 2;
    }
  }
  if (vitestArgs.length > 0 && focus.length === 0) {
    console.error(
      "run-coverage: テストを絞るときは --focus も指定する（絞った実行で全体の閾値は比べられない）",
    );
    return 2;
  }
  if (reuse && focus.length > 0) {
    console.error("run-coverage: --reuse と --focus は一緒に使えない");
    return 2;
  }
  const cache = join(root, focus.length > 0 ? `${CACHE}-focus-${process.pid}` : CACHE);
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
  const c8Path = join(cache, "report", "coverage-summary.json");
  const shPath = join(cache, "shell-summary.json");
  if (!reuse) {
    try {
      const status = measure(root, cache, files, vitestArgs);
      if (status !== 0) {
        console.error(`run-coverage: テストが失敗した（exit ${status}）。カバレッジは比べない`);
        return 1;
      }
    } catch (error) {
      console.error(`run-coverage: 判定できない: 測定に失敗した: ${errorMessage(error)}`);
      return 2;
    }
  }
  if (!existsSync(c8Path) || !existsSync(shPath)) {
    console.error(`run-coverage: 判定できない: 測定の結果が無い（${c8Path}・${shPath}）`);
    return 2;
  }
  let measures: Map<string, FileMeasure>;
  try {
    measures = readC8Summary(root, JSON.parse(readFileSync(c8Path, "utf8")));
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
  } catch (error) {
    console.error(`run-coverage: 判定できない: 測定の結果を読めない: ${errorMessage(error)}`);
    return 2;
  }

  if (focus.length > 0) return reportFocus(config, files, measures, focus, cache);
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
