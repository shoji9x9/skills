#!/usr/bin/env node
// ミューテーションテストの所要時間の見積もり（`mutation-durations.json`）を、ランナーのログの実測から更新する（Issue #684）。
//
// 使い方:
//   gh run view <run ID> --log > run.log   # 全件を測った PR の CI か、週次の全件の run
//   node scripts/mutation/update-mutation-durations.ts [--summary <path>] run.log [...]
//
// ランナー（`check-mutation-proof.ts`）は、宣言ごとに `=== <宣言> → <テスト>` の行を出し、測り終えると
// `時間: X 秒（N 変異、基準 run を含む）` の行を出す。重い宣言は複数のシャードに分かれ、一部ごとに基準 run を含むので、
// 1 回の実行の秒数は、宣言ごとに X の合計 ÷ (N + 1) の合計とする。
// `gh run view --log` のログは、行の先頭にジョブの名前とタブを持ち、ジョブの行がまとまって並ぶ。
// `=== ` の行と `時間:` の行は、同じジョブの中で対応づける。手元のランナーの出力（タブを持たない）も同じに読む。
//
// ログに無い宣言の見積もりは変えない。実在しない宣言の行は、見積もりに入れずに件数と名前を出す。
// 値が変わった宣言を、前と後の値で出す。
// 見積もりから大きくずれた宣言は、ランナーがログに出す「見積もりとのずれ:」の行から集め、その件数を 0 件でも出す。
// ずれの判定はランナーが持つので、ここでは判定し直さない。
// `--summary <path>` を渡すと、ずれた宣言と値が変わった宣言を Markdown でそのファイルに追記する。
// 週次の全件の run（`.github/workflows/mutation-proof.yml`）が、ジョブの結果（`GITHUB_STEP_SUMMARY`）に出すのに使う（Issue #1077）。
//
// 終了コード: 0 は更新した、2 は更新できない（引数・ログを読めない・`時間:` の行が 0 件・`=== ` の行と対応しない `時間:` の行）。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../lib/errors.ts";
import { isCliEntry } from "../lib/cli/entry.ts";
import { isPlainObject } from "../lib/guards.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DURATIONS_FILE = "scripts/mutation/mutation-durations.json";

/** 宣言ごとの実測の合計。`runs` はテストファイルを実行した回数（変異の数 + 基準 run の数）。 */
export type Measured = Map<string, { seconds: number; runs: number }>;

export type Durations = { default_seconds: number; seconds_per_run: Record<string, number> };

/**
 * 見積もりのファイルを読む。ランナー（`check-mutation-proof.ts` の `loadDurations`）が受け付ける形
 * （`default_seconds` と、`seconds_per_run` のすべての値が正の有限数）でなければ、例外にする。
 * 形の誤ったファイルを読んで書き戻すと、ランナーが次の実行で読めなくなる。
 */
function readDurations(text: string): Durations {
  const parsed: unknown = JSON.parse(text);
  const isSeconds = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!isPlainObject(parsed)) throw new Error("見積もりのファイルが JSON オブジェクトでない");
  const { default_seconds: defaultSeconds, seconds_per_run: perRun } = parsed;
  if (!isSeconds(defaultSeconds)) throw new Error("default_seconds が正の数でない");
  if (!isPlainObject(perRun)) throw new Error("seconds_per_run がオブジェクトでない");
  const seconds: Record<string, number> = {};
  for (const [spec, value] of Object.entries(perRun)) {
    if (!isSeconds(value)) throw new Error(`seconds_per_run の ${spec} が正の数でない`);
    seconds[spec] = value;
  }
  return { default_seconds: defaultSeconds, seconds_per_run: seconds };
}

const SPEC_LINE = /=== (\S+\.mutations\.json) → /;
const TIME_LINE = /時間: (\d+(?:\.\d+)?) 秒（(\d+) 変異、基準 run を含む）/;

/**
 * ランナーのログから、宣言ごとの実測を合計する。
 * `時間:` の行が、同じジョブの直前の `=== ` の行と対応しなければ、例外にする（どの宣言の時間か分からない）。
 * `時間:` の行が無いまま次の `=== ` の行が来るか、ログが終わった宣言も、例外にする。
 * 途中で止まった run のログは、どの宣言を測り終えたかを確かめられないので、一部の実測で見積もりを書き換えない。
 */
export function parseTimings(text: string): Measured {
  const measured: Measured = new Map();
  // ジョブごとの、測っている途中の宣言
  const current = new Map<string, string>();
  text.split("\n").forEach((line, index) => {
    const job = line.includes("\t") ? line.slice(0, line.indexOf("\t")) : "";
    const spec = SPEC_LINE.exec(line);
    if (spec) {
      const unfinished = current.get(job);
      if (unfinished !== undefined) {
        throw new Error(
          `${index + 1} 行目の前に、${unfinished} の「時間:」の行が無い（run が途中で止まった）`,
        );
      }
      current.set(job, spec[1] ?? "");
      return;
    }
    const time = TIME_LINE.exec(line);
    if (!time) return;
    const name = current.get(job);
    if (name === undefined) {
      throw new Error(`${index + 1} 行目の「時間:」の前に、同じジョブの「=== 」の行が無い`);
    }
    current.delete(job);
    const sum = measured.get(name) ?? { seconds: 0, runs: 0 };
    sum.seconds += Number(time[1]);
    sum.runs += Number(time[2]) + 1;
    measured.set(name, sum);
  });
  if (current.size > 0) {
    const names = [...current].map(([job, name]) => (job === "" ? name : `${job}: ${name}`));
    throw new Error(
      `「時間:」の行が無いままログが終わった宣言がある（run が途中で止まった）: ${names.join(", ")}`,
    );
  }
  return measured;
}

const DRIFT_LINE =
  /見積もりとのずれ: (\S+\.mutations\.json) 1 回 (\d+(?:\.\d+)?) 秒（見積もり (\d+(?:\.\d+)?) 秒）/;

/** ランナーが「見積もりとのずれ:」の行で挙げた宣言。分けた宣言は一部ごとに 1 行になるので、行ごとに返す。 */
export type Drift = { spec: string; perRun: number; estimate: number };

export function parseDrifts(text: string): Drift[] {
  return text.split("\n").flatMap((line) => {
    const m = DRIFT_LINE.exec(line);
    return m ? [{ spec: m[1] ?? "", perRun: Number(m[2]), estimate: Number(m[3]) }] : [];
  });
}

/** ずれの行が挙げた宣言の数。同じ宣言の一部ごとの行は 1 件に数える。 */
function countSpecs(drifts: Drift[]): number {
  return new Set(drifts.map((d) => d.spec)).size;
}

export type Change = { spec: string; before: number | undefined; after: number };

/**
 * 実測で見積もりを更新する。ログに無い宣言の見積もりは残し、新しい宣言は末尾に足す。`changes` は値が変わった宣言だけを持つ。
 * `exists` が false を返す宣言（消した宣言）は、見積もりに入れずに `missing` に入れる。
 */
export function updateDurations(
  durations: Durations,
  measured: Measured,
  exists: (spec: string) => boolean,
): { next: Durations; changes: Change[]; missing: string[] } {
  const seconds = { ...durations.seconds_per_run };
  const changes: Change[] = [];
  const missing: string[] = [];
  for (const [spec, sum] of [...measured].sort(([a], [b]) => a.localeCompare(b))) {
    if (!exists(spec)) {
      missing.push(spec);
      continue;
    }
    // 0.1 秒の単位にする。0 にすると、ランナーが正の数でない見積もりとして拒否する
    const after = Math.max(0.1, Math.round((sum.seconds / sum.runs) * 10) / 10);
    const before = seconds[spec];
    seconds[spec] = after;
    if (after === before) continue;
    changes.push({ spec, before, after });
  }
  return { next: { ...durations, seconds_per_run: seconds }, changes, missing };
}

function formatChange(c: Change): string {
  const before = c.before === undefined ? "（無し）" : `${c.before} 秒`;
  return `  ${c.spec}: ${before} → ${c.after} 秒`;
}

/** ジョブの結果に出す Markdown。ずれた宣言を先に、値が変わった宣言を後に置く。 */
export function summaryMarkdown(drifts: Drift[], changes: Change[]): string {
  const lines = ["## ミューテーションテストの所要時間の見積もり", ""];
  // 分けた宣言は一部ごとに 1 行になるので、件数は宣言の数で数える
  const driftedSpecs = countSpecs(drifts);
  if (drifts.length === 0) {
    lines.push(
      "見積もりから大きくずれた宣言は無い（ランナーの「見積もりとのずれ」の行が 0 件）。",
      "",
    );
  } else {
    lines.push(
      `見積もりから大きくずれた宣言: ${driftedSpecs} 件。`,
      "このジョブの artifact の `mutation-durations.json` で `scripts/mutation/mutation-durations.json` を置き換える PR を作る。",
      "",
      "| 宣言 | 1 回の実測 | 見積もり |",
      "| --- | --- | --- |",
      ...drifts.map((d) => `| \`${d.spec}\` | ${d.perRun} 秒 | ${d.estimate} 秒 |`),
      "",
    );
  }
  lines.push(`実測で値が変わった宣言: ${changes.length} 件。`, "");
  if (changes.length > 0) {
    lines.push(
      "| 宣言 | 前 | 後 |",
      "| --- | --- | --- |",
      ...changes.map(
        (c) =>
          `| \`${c.spec}\` | ${c.before === undefined ? "（無し）" : `${c.before} 秒`} | ${c.after} 秒 |`,
      ),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

const USAGE =
  "使い方: node scripts/mutation/update-mutation-durations.ts [--summary <path>] <ランナーのログ> ...";

/** 引数を読む。`--summary` の値が無いときと、ほかの `-` で始まる引数は誤りにする。 */
function parseArgs(argv: string[]): { summary: string | undefined; logs: string[] } | undefined {
  let summary: string | undefined;
  const logs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--summary") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-") || summary !== undefined) return undefined;
      summary = value;
      i++;
    } else if (arg.startsWith("-")) {
      return undefined;
    } else {
      logs.push(arg);
    }
  }
  return logs.length === 0 ? undefined : { summary, logs };
}

export function main(argv: string[], root = repoRoot): number {
  const args = parseArgs(argv);
  if (args === undefined) {
    console.error(USAGE);
    return 2;
  }
  const path = join(root, DURATIONS_FILE);
  let measured: Measured;
  let durations: Durations;
  let drifts: Drift[];
  try {
    const text = args.logs.map((f) => readFileSync(f, "utf8")).join("\n");
    measured = parseTimings(text);
    drifts = parseDrifts(text);
    durations = readDurations(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`更新できない: ${errorMessage(err)}`);
    return 2;
  }
  if (measured.size === 0) {
    console.error("ログに「時間:」の行が無い（ランナーのログを渡したかを確かめる）");
    return 2;
  }
  const { next, changes, missing } = updateDurations(durations, measured, (spec) =>
    existsSync(join(root, spec)),
  );
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`見積もりを更新した宣言: ${changes.length} 件（${DURATIONS_FILE}）`);
  for (const c of changes) console.log(formatChange(c));
  if (missing.length > 0) {
    console.log(`実在しないので見積もりに入れなかった宣言: ${missing.length} 件`);
    for (const spec of missing) console.log(`  ${spec}`);
  }
  // 0 件でも出す。出さないと「ずれが無い」と「ずれの行を読んでいない」が同じ出力になる
  console.log(
    `見積もりから大きくずれた宣言: ${countSpecs(drifts)} 件（ログの「見積もりとのずれ」の行）`,
  );
  for (const d of drifts)
    console.log(`  ${d.spec}: 1 回 ${d.perRun} 秒（見積もり ${d.estimate} 秒）`);
  if (args.summary !== undefined) appendFileSync(args.summary, summaryMarkdown(drifts, changes));
  return 0;
}

if (isCliEntry(import.meta.url)) process.exitCode = main(process.argv.slice(2));
