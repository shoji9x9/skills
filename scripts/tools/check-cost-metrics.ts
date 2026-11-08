// チェックと CI の費用の指標を集め、直す候補を挙げる（Issue #939。親は #508 の週次のセルフ点検）。
// 週次のワークフロー（.github/workflows/check-cost-metrics.yml）が実行し、候補を追跡 Issue に載せる。
// 候補を挙げるだけで、チェックを廃止するか、ジョブを直すかは人が決める。
//
// 集める指標は次の 3 つである。対象と閾値は、隣の check-cost-metrics.json で決める。
// - 空の免除・保留の一覧: 一覧が空のまま、設定に残っている（読む処理は確かめず、readers を案内として添える）
// - 修正の PR が多いチェック: 直近の期間に、チェックのファイルを変えた fix の PR の数
// - GitHub Actions のジョブの所要時間: 直近の期間と前の期間の中央値を比べ、遅くなったジョブを挙げる（最大値は所要時間の表にだけ載せる）
//
// 確かめられなかったものを「該当なし」として扱わない。次のときは exit 1 で止まる。
// - 設定・一覧のファイルを読めない
// - git の履歴が浅い
// - git や API が失敗する、または API の一覧が上限（1000 件）を超えて取りこぼす
//
// 使い方: node scripts/tools/check-cost-metrics.ts --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]
// 標準出力の最後の行に `due=<件数>` を出す。件数が 0 のときも本文とコメントのファイルは書く。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCliEntry } from "../lib/cli/entry.ts";
import { errorMessage } from "../lib/errors.ts";
import { isNonBlankString, isPlainObject, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { spawnAsync } from "../lib/spawn-async.ts";
import {
  formatDiffComment,
  naturalOrder,
  oneLine,
  parseTrackingCli,
  tableCell,
  trackingKeys,
} from "../lib/text/tracking-diff.ts";

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), "check-cost-metrics.json");
const DAY_MS = 24 * 60 * 60 * 1000;

export type Runner = (command: string, args: readonly string[]) => Promise<string>;

/** ジョブの API を並べて呼ぶ数。API は run ごとに 1 回呼び、1 回に数秒かかるので、1 件ずつでは run の数に比例して長くなる。 */
const CONCURRENCY = 8;

/** items を limit 件ずつ並べて処理し、入力の順で結果を返す。1 件でも失敗したら reject する。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // 1 つの反復子を全員で読み、次の 1 件を取り合う。
  const entries = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of entries) results[index] = await task(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---- 設定

export type CountRule =
  | { kind: "json-array"; key: string }
  | { kind: "json-object"; key: string }
  | { kind: "json-arrays"; exclude: string[] }
  | { kind: "ts-export"; export: string };
/** keepEmpty は、意図して空にしている一覧の理由。書いた一覧は空でも候補に挙げない。 */
export type ListTarget = { file: string; count: CountRule; readers: string[]; keepEmpty?: string };
export type Config = {
  lists: ListTarget[];
  fixPrs: { days: number; min: number; paths: string[] };
  durations: {
    days: number;
    workflows: string[];
    minRuns: number;
    minRatio: number;
    minSeconds: number;
  };
};

function stringList(value: unknown, where: string): string[] {
  if (!isArray(value) || value.length === 0 || !value.every(isNonBlankString)) {
    throw new Error(`${where} が、空でない文字列の空でない配列でない`);
  }
  return [...value];
}

function positive(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where} が正の数でない`);
  }
  return value;
}

function parseCountRule(value: unknown, where: string): CountRule {
  if (!isRecord(value)) throw new Error(`${where} がオブジェクトでない`);
  const { kind } = value;
  if (kind === "json-array" || kind === "json-object") {
    if (!isNonBlankString(value["key"])) throw new Error(`${where}.key が無い`);
    return { kind, key: value["key"] };
  }
  if (kind === "json-arrays") {
    const exclude = value["exclude"];
    if (!isArray(exclude) || !exclude.every(isNonBlankString)) {
      throw new Error(`${where}.exclude が文字列の配列でない`);
    }
    return { kind, exclude: [...exclude] };
  }
  if (kind === "ts-export") {
    if (!isNonBlankString(value["export"])) throw new Error(`${where}.export が無い`);
    return { kind, export: value["export"] };
  }
  throw new Error(`${where}.kind が知らない値: ${JSON.stringify(kind)}`);
}

function parseList(value: unknown, index: number): ListTarget {
  const where = `lists[${index}]`;
  if (!isRecord(value) || !isNonBlankString(value["file"])) {
    throw new Error(`${where}.file が無い`);
  }
  const keep = value["keep_empty"];
  if (keep !== undefined && !isNonBlankString(keep)) {
    throw new Error(`${where}.keep_empty が空でない文字列（空のままにする理由）でない`);
  }
  return {
    file: value["file"],
    count: parseCountRule(value["count"], `${where}.count`),
    readers: stringList(value["readers"], `${where}.readers`),
    ...(keep === undefined ? {} : { keepEmpty: keep }),
  };
}

function section(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const found = value[key];
  if (!isRecord(found)) throw new Error(`${key} がオブジェクトでない`);
  return found;
}

/** check-cost-metrics.json を読む。足りない・型の違う項目は例外にする。 */
export function parseConfig(text: string): Config {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || !isArray(value["lists"]) || value["lists"].length === 0) {
    throw new Error("lists が空でない配列でない");
  }
  const fix = section(value, "fix_prs");
  const dur = section(value, "durations");
  const lists = value["lists"].map(parseList);
  // 同じ一覧を 2 回書くと、識別子が重複し、次の実行が前回の本文を読めなくなる。
  const files = lists.map((l) => l.file);
  const duplicated = files.find((f, i) => files.indexOf(f) !== i);
  if (duplicated !== undefined) throw new Error(`lists の file が重複している: ${duplicated}`);
  return {
    lists,
    fixPrs: {
      days: positive(fix["days"], "fix_prs.days"),
      min: positive(fix["min"], "fix_prs.min"),
      paths: stringList(fix["paths"], "fix_prs.paths"),
    },
    durations: {
      days: positive(dur["days"], "durations.days"),
      workflows: stringList(dur["workflows"], "durations.workflows"),
      minRuns: positive(dur["min_runs"], "durations.min_runs"),
      minRatio: positive(dur["min_ratio"], "durations.min_ratio"),
      minSeconds: positive(dur["min_seconds"], "durations.min_seconds"),
    },
  };
}

// ---- 指標 1: 空の免除・保留の一覧

function lengthOf(value: unknown, where: string, kind: "array" | "object"): number {
  if (kind === "array") {
    if (!isArray(value)) throw new Error(`${where} が配列でない`);
    return value.length;
  }
  if (!isRecord(value)) throw new Error(`${where} がオブジェクトでない`);
  return Object.keys(value).length;
}

/** 一覧の件数を数える。value は JSON を読んだ値か、ts-export ならモジュールの名前空間。 */
export function countEntries(rule: CountRule, value: unknown, file: string): number {
  if (!isRecord(value)) throw new Error(`${file} がオブジェクトでない`);
  switch (rule.kind) {
    case "json-array":
      return lengthOf(value[rule.key], `${file} の ${rule.key}`, "array");
    case "json-object":
      return lengthOf(value[rule.key], `${file} の ${rule.key}`, "object");
    case "ts-export": {
      // Map や Set は Object.keys が 0 件を返し、要素があっても空として扱ってしまうので、配列と素のオブジェクトだけを数える。
      const exported = value[rule.export];
      if (isArray(exported)) return exported.length;
      if (isPlainObject(exported)) return Object.keys(exported).length;
      throw new Error(`${file} の ${rule.export} が配列か素のオブジェクトでない`);
    }
    case "json-arrays": {
      const arrays = Object.entries(value).filter(
        ([key, v]) => isArray(v) && !rule.exclude.includes(key),
      );
      if (arrays.length === 0) throw new Error(`${file} に数える配列が無い`);
      return arrays.reduce((sum, [, v]) => sum + lengthOf(v, file, "array"), 0);
    }
  }
}

export type Finding = {
  kind: "empty-list" | "fix-heavy" | "slow-job";
  target: string;
  detail: string;
};

async function loadList(target: ListTarget, root: string): Promise<unknown> {
  const path = join(root, target.file);
  if (target.count.kind === "ts-export") {
    const module: unknown = await import(pathToFileURL(path).href);
    return module;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * 空の一覧を挙げる。一覧を読めないときは例外にする。
 * readers は表に出す案内で、読む処理が今も一覧を読むかは確かめない（Issue #948）。
 */
export async function emptyLists(lists: readonly ListTarget[], root: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const target of lists) {
    const count = countEntries(target.count, await loadList(target, root), target.file);
    if (count === 0 && target.keepEmpty === undefined) {
      findings.push({ kind: "empty-list", target: target.file, detail: target.readers.join("、") });
    }
  }
  return findings;
}

// ---- 指標 2: 修正の PR が多いチェック

const RECORD = "\u001e";
const FIELD = "\u001f";
const FIX_TITLE = /^fix(\([^)]*\))?!?: /u;
const MERGE_SUBJECT = /^Merge pull request #\d+ /u;

/** first-parent の 1 件（PR のマージか、squash した PR）のタイトル。マージの commit は本文の 1 行目にタイトルがある。 */
export function prTitle(subject: string, body: string): string {
  if (!MERGE_SUBJECT.test(subject)) return subject;
  return body.split("\n").find((line) => line.trim() !== "") ?? "";
}

/**
 * テストとミューテーションテストの定義は、チェックの本体の修正として数える。
 * 同じ名前の本体が無いテスト（設定を確かめるテストなど）は、テストそのものをチェックとして数える。
 */
export function checkFileOf(path: string, exists: (path: string) => boolean = () => true): string {
  const body = path.replace(/\.test\.ts$/u, ".ts").replace(/\.mutations\.json$/u, ".ts");
  if (body === path || exists(body)) return body;
  return path.replace(/\.mutations\.json$/u, ".test.ts");
}

type LogEntry = { title: string; changes: string[][] };

/** `git log --name-status` の 1 件を読む。changes は [状態, パス...] の並び。 */
function parseLogRecord(record: string): LogEntry | null {
  const [, subject = "", body = "", status = ""] = record.split(FIELD);
  if (subject === "") return null;
  const changes = status
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("\t"));
  return { title: prTitle(subject, body), changes };
}

/**
 * fix の PR が変えたファイルごとに、PR の数を数える。ログは新しい順で、名前を変えたファイルは今の名前に寄せる。
 */
export function countFixPrs(
  log: string,
  exists: (path: string) => boolean = () => true,
): Map<string, number> {
  const check = (path: string): string => checkFileOf(path, exists);
  const renamed = new Map<string, string>();
  const current = (path: string): string => renamed.get(path) ?? path;
  const counts = new Map<string, number>();
  for (const record of log.split(RECORD)) {
    const entry = parseLogRecord(record);
    if (entry === null) continue;
    const touched = new Set<string>();
    for (const [state = "", from = "", to] of entry.changes) {
      if (state.startsWith("R") && to !== undefined) {
        renamed.set(check(from), current(check(to)));
      }
      touched.add(current(check(to ?? from)));
    }
    if (!FIX_TITLE.test(entry.title)) continue;
    for (const file of touched) counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

/** 修正の PR が多いチェックを挙げる。git の履歴が浅いときは数えられないので例外にする。 */
export async function fixHeavyChecks(
  run: Runner,
  fix: Config["fixPrs"],
  input: { root: string; now: Date },
): Promise<Finding[]> {
  const { root, now } = input;
  const git = (args: string[]): Promise<string> => run("git", ["-C", root, ...args]);
  if ((await git(["rev-parse", "--is-shallow-repository"])).trim() !== "false") {
    throw new Error("git の履歴が浅い（checkout の fetch-depth を 0 にする）");
  }
  const since = new Date(now.getTime() - fix.days * DAY_MS).toISOString();
  const log = await git([
    "log",
    "--first-parent",
    "-m",
    "-M",
    `--since=${since}`,
    `--format=${RECORD}%H${FIELD}%s${FIELD}%b${FIELD}`,
    "--name-status",
    "HEAD",
    "--",
    ...fix.paths,
  ]);
  // 今あるファイルの一覧は、テストの本体があるかの判定と、消えたチェックを外すのに使う。
  const tracked = new Set((await git(["ls-files"])).split("\n"));
  return [...countFixPrs(log, (path) => tracked.has(path))]
    .filter(([file, count]) => count >= fix.min && tracked.has(file))
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([file, count]) => ({
      kind: "fix-heavy",
      target: file,
      detail: `直近 ${fix.days} 日の fix の PR: ${count} 件`,
    }));
}

// ---- 指標 3: GitHub Actions のジョブの所要時間

export type JobSample = { key: string; seconds: number; at: number };
export type Stats = { runs: number; median: number; max: number };

async function pages(run: Runner, path: string): Promise<Record<string, unknown>[]> {
  const value: unknown = JSON.parse(await run("gh", ["api", "--paginate", "--slurp", path]));
  if (!isArray(value) || !value.every(isRecord))
    throw new Error(`${path} の応答がページの配列でない`);
  return value;
}

function items(
  page: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown>[] {
  const list = page[key];
  if (!isArray(list) || !list.every(isRecord)) throw new Error(`${path} の ${key} が配列でない`);
  return list;
}

function time(value: unknown, where: string): number {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) throw new Error(`${where} が日時でない`);
  return ms;
}

/** ジョブのキーの材料。欠けた値を "undefined" のまま使うと、別のジョブが 1 つのキーにまとまるので例外にする。 */
function text(value: unknown, where: string): string {
  if (!isNonBlankString(value)) throw new Error(`${where} が空でない文字列でない`);
  return value;
}

/** 1 つのワークフローの、成功した run を期間の始まりから取得する。1000 件を超えると取りこぼすので例外にする。 */
async function workflowRuns(
  run: Runner,
  workflow: string,
  from: Date,
): Promise<Record<string, unknown>[]> {
  const path = `repos/{owner}/{repo}/actions/workflows/${workflow}/runs?status=success&per_page=100&created=%3E%3D${from.toISOString().slice(0, 10)}`;
  const all = await pages(run, path);
  const total = all[0]?.["total_count"];
  if (typeof total !== "number") throw new Error(`${path} に total_count が無い`);
  if (total > 1000)
    throw new Error(`${workflow} の run が ${total} 件あり、API の上限で取りこぼす`);
  return all.flatMap((page) => items(page, "workflow_runs", path));
}

/** 1 つの run の、成功したジョブの所要時間を取る。キーはワークフロー・ジョブ・イベントの組。 */
export function jobSamples(
  runRecord: Record<string, unknown>,
  jobs: Record<string, unknown>[],
): JobSample[] {
  const name = text(runRecord["name"], "run の name");
  const event = text(runRecord["event"], "run の event");
  const at = time(runRecord["created_at"], "run の created_at");
  return jobs
    .filter((job) => job["conclusion"] === "success")
    .map((job) => {
      const seconds =
        (time(job["completed_at"], "job の completed_at") -
          time(job["started_at"], "job の started_at")) /
        1000;
      return { key: `${name} / ${text(job["name"], "job の name")}（${event}）`, seconds, at };
    });
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function stats(seconds: readonly number[]): Stats {
  const sorted = [...seconds].sort((a, b) => a - b);
  return { runs: sorted.length, median: median(sorted), max: sorted.at(-1) ?? 0 };
}

export type JobRow = { key: string; current: Stats; previous: Stats };

/** ジョブごとに、直近の期間と前の期間の統計を出す。境界は split（ミリ秒）で、それより前が前の期間。 */
export function compareJobs(samples: readonly JobSample[], split: number): JobRow[] {
  const groups = new Map<string, { current: number[]; previous: number[] }>();
  for (const s of samples) {
    const group = groups.get(s.key) ?? { current: [], previous: [] };
    (s.at >= split ? group.current : group.previous).push(s.seconds);
    groups.set(s.key, group);
  }
  return (
    [...groups]
      .map(([key, g]) => ({ key, current: stats(g.current), previous: stats(g.previous) }))
      // shard 2 を shard 10 より前に並べる。
      .sort((a, b) => naturalOrder(a.key, b.key))
  );
}

/**
 * 遅くなったジョブか。両方の期間に min_runs 回以上あり、中央値が割合と秒数の両方で増えたものだけを挙げる。
 * 週に 1 回だけ起動するワークフロー（outdated など）は min_runs に届かないので候補に挙げず、所要時間の表にだけ載せる。
 * 1 回ずつの値は実行ごとのばらつきが大きく、比べても遅くなったと判断できないためである。
 */
export function isSlower(row: JobRow, dur: Config["durations"]): boolean {
  const { current, previous } = row;
  if (current.runs < dur.minRuns || previous.runs < dur.minRuns) return false;
  const diff = current.median - previous.median;
  return diff >= dur.minSeconds && current.median >= previous.median * (1 + dur.minRatio);
}

/** 対象のワークフローの run とジョブを取得し、ジョブごとの統計を出す。 */
export async function jobRows(run: Runner, dur: Config["durations"], now: Date): Promise<JobRow[]> {
  const split = now.getTime() - dur.days * DAY_MS;
  const from = new Date(split - dur.days * DAY_MS);
  const perWorkflow = await Promise.all(
    dur.workflows.map((workflow) => workflowRuns(run, workflow, from)),
  );
  const runs = perWorkflow
    .flat()
    .filter((r) => time(r["created_at"], "run の created_at") >= from.getTime());
  const samples = await mapLimit(runs, CONCURRENCY, async (r) => {
    const path = `repos/{owner}/{repo}/actions/runs/${String(r["id"])}/jobs?filter=latest&per_page=100`;
    const jobs = (await pages(run, path)).flatMap((page) => items(page, "jobs", path));
    return jobSamples(r, jobs);
  });
  return compareJobs(samples.flat(), split);
}

function seconds(value: number): string {
  return `${Math.round(value)} 秒`;
}

export function slowJobs(rows: readonly JobRow[], dur: Config["durations"]): Finding[] {
  return rows
    .filter((row) => isSlower(row, dur))
    .map((row) => ({
      kind: "slow-job",
      target: row.key,
      detail: `中央値 ${seconds(row.previous.median)} → ${seconds(row.current.median)}`,
    }));
}

// ---- 追跡 Issue の本文

const KIND_LABEL: Record<Finding["kind"], string> = {
  "empty-list": "空の免除・保留の一覧",
  "fix-heavy": "修正の PR が多いチェック",
  "slow-job": "遅くなったジョブ",
};
const KEY_FORM = new RegExp(`^(${Object.keys(KIND_LABEL).join("|")}) \\S(.*\\S)?$`, "u");

/** 前回との差分に使う識別子。件数や秒数は週ごとに変わるので含めず、種別と対象だけにする。 */
const findingKey = (f: Finding): string => `${f.kind} ${oneLine(f.target)}`;

const tracking = trackingKeys({
  marker: "check-cost-metrics",
  keyForm: KEY_FORM,
  keyOf: findingKey,
});
export const { previousKeys, diff: diffFindings } = tracking;

/** 空の一覧の候補があるときに、候補の表の下に 1 回だけ出す注記（Issue #948）。 */
const READERS_NOTE =
  "空の免除・保留の一覧の「内容」は、check-cost-metrics.json の readers に書いた、一覧を読む処理の案内である。スクリプトは確かめていない。";

function findingTable(findings: readonly Finding[], kept: ReadonlySet<string>): string[] {
  if (findings.length === 0) return [];
  const lines = ["| 指標 | 対象 | 内容 | 前回から |", "| --- | --- | --- | --- |"];
  for (const f of findings) {
    const state = kept.has(findingKey(f)) ? "継続" : "新規";
    lines.push(
      `| ${KIND_LABEL[f.kind]} | ${tableCell(f.target)} | ${tableCell(f.detail)} | ${state} |`,
    );
  }
  if (findings.some((f) => f.kind === "empty-list")) {
    lines.push("", READERS_NOTE);
  }
  return [...lines, ""];
}

function durationTable(rows: readonly JobRow[], days: number): string[] {
  const lines = [
    `<details><summary>ジョブの所要時間（直近 ${days} 日と、その前の ${days} 日）</summary>`,
    "",
    "| ジョブ | 回数 | 中央値 | 最大 | 前の回数 | 前の中央値 | 前の最大 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const { key, current: c, previous: p } of rows) {
    lines.push(
      `| ${tableCell(key)} | ${c.runs} | ${seconds(c.median)} | ${seconds(c.max)} | ${p.runs} | ${seconds(p.median)} | ${seconds(p.max)} |`,
    );
  }
  return [...lines, "", "</details>", ""];
}

export type Result = { findings: Finding[]; rows: JobRow[]; config: Config };

/** 追跡 Issue の本文。最後の行に、次の実行が差分に使う識別子の一覧を埋める。 */
export function formatBody(result: Result, previous: readonly string[] = []): string {
  const { findings, rows, config } = result;
  const { kept, resolved } = diffFindings(findings, previous);
  const lines = [
    "チェックと CI の費用の指標から挙げた、直す候補の一覧です。廃止するか直すかは人が決めます。",
    "この Issue は `Check cost metrics` ワークフローが作成・更新・クローズします。対象と閾値は `scripts/tools/check-cost-metrics.json` にあります。",
    "",
    `直す候補: ${findings.length} 件`,
    "",
    ...findingTable(findings, new Set(kept)),
    ...durationTable(rows, config.durations.days),
  ];
  if (resolved.length > 0) lines.push(`前回から解消したもの: ${resolved.join("、")}`, "");
  lines.push(tracking.markerLine(findings));
  return `${lines.join("\n")}\n`;
}

export function formatComment(findings: readonly Finding[], previous: readonly string[]): string {
  return formatDiffComment("直す候補", findings.length, diffFindings(findings, previous));
}

// ---- 実行

/** 1 回の呼び出しの上限。gh api は 1 回で数秒なので、止まったときに気付けるよう 2 分で打ち切る。 */
const CALL_TIMEOUT_MS = 120_000;

/** 本番の呼び出し。失敗（起動できない・0 以外で終わる・時間切れ）は、stderr を添えて例外にする。 */
export const defaultRunner: Runner = async (command, args) => {
  const result = await spawnAsync(command, args, { timeout: CALL_TIMEOUT_MS });
  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? `終了コード ${String(result.status)}`;
    throw new Error(
      `${command} ${args.join(" ")} が失敗した（${reason}）: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
};

/** 3 つの指標を集める。確かめられなければ例外を投げる。 */
export async function collect(
  run: Runner,
  input: { config: Config; root: string; now: Date },
): Promise<Result> {
  const { config, root, now } = input;
  // 手元で済む指標を先に集め、一覧を読めないときや履歴が浅いときは、時間のかかるジョブの API を呼ぶ前に止める。
  const lists = await emptyLists(config.lists, root);
  const fixes = await fixHeavyChecks(run, config.fixPrs, { root, now });
  const rows = await jobRows(run, config.durations, now);
  const findings = [...lists, ...fixes, ...slowJobs(rows, config.durations)];
  return { findings, rows, config };
}

/** `options` はテストが一時ディレクトリと偽の時刻を渡すためにある。ワークフローはデフォルトで呼ぶ。 */
export async function main(
  args: readonly string[],
  run: Runner = defaultRunner,
  options: { config?: string; root?: string; now?: Date } = {},
): Promise<number> {
  const cli = parseTrackingCli(args);
  if (cli === null) {
    console.error(
      "使い方: node scripts/tools/check-cost-metrics.ts --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]",
    );
    return 2;
  }
  try {
    const previous =
      cli.previous === undefined ? [] : previousKeys(readFileSync(cli.previous, "utf8"));
    const config = parseConfig(readFileSync(options.config ?? CONFIG, "utf8"));
    const root = options.root ?? process.cwd();
    if (!existsSync(root)) throw new Error(`${root} が無い`);
    const result = await collect(run, { config, root, now: options.now ?? new Date() });
    writeFileSync(cli.out, formatBody(result, previous));
    writeFileSync(cli.commentOut, formatComment(result.findings, previous));
    console.log(`due=${result.findings.length}`);
    return 0;
  } catch (error) {
    console.error(`check-cost-metrics: 確かめられない: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(await main(process.argv.slice(2)));
