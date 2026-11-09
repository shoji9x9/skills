// 週次のセルフ点検（Issue #940）の指摘のうち、文の書き換えで直せるものを、エージェントに直させて PR にする（Issue #942。親は #508）。
// ワークフロー（.github/workflows/self-review-fix.yml）が、エージェントの前後と PR の扱いを決める段で、このスクリプトを実行する。
// エージェントの手順は docs/self-review-fix-procedure.md に、運用は docs/self-review.md にある。
//
// 何を直してよいかと、エージェントが何を変えたかは、エージェントに任せずにここで決める。
// エージェントは指摘の文を入力に読むので、仕込まれた指示に従って、対象の外のファイルを書き換えるおそれがあるからである。
//
// 使い方は次のとおりである。
// node scripts/weekly/self-review-fix.ts select --report <点検の結果の JSON> --root <リポジトリ> --out <候補の JSON>
//   直す候補を選んで書く。標準出力の最後の行に `count=<件数>` を出す。
// node scripts/weekly/self-review-fix.ts check --candidates <候補の JSON> --result <エージェントの結果の JSON> \
//   --status <git status の出力>
//   エージェントが変えたファイルが、直したと書いた候補のファイルと一致するかを確かめる。
//   標準出力の最後の行に `applied=<件数>` を出す。
// node scripts/weekly/self-review-fix.ts decide --pr <PR の状態の JSON> --bot <PR を作る App の login>
//   今週、PR を作るか・commit を足すか・足さないかを決める。標準出力に `action=<値>` と `reason=<理由>` を出す。
// node scripts/weekly/self-review-fix.ts body --candidates <候補の JSON> --result <エージェントの結果の JSON> --date <YYYY-MM-DD> \
//   --out <PR の本文> --comment-out <週ごとのコメント> [--tracking <追跡 Issue の番号>]
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../lib/cli/args.ts";
import { isCliEntry } from "../lib/cli/entry.ts";
import { isArray } from "../lib/is-array.ts";
import { errorMessage } from "../lib/errors.ts";
import { isNonBlankString, isRecord } from "../lib/guards.ts";
import { oneLine } from "../lib/text/tracking-diff.ts";
import {
  type Category,
  type Finding,
  codeSpan,
  mergeFindings,
  parseReport,
} from "./self-review-issue.ts";

/**
 * 文の書き換えで直せる項目。やりすぎなチェック・回帰 eval・GitHub Actions は、チェックやコードの扱いを人が決めるので外す。
 * 値は docs/self-review-procedure.md の `category` と同じにする。
 */
const FIXABLE: readonly Category[] = ["unused", "inconsistency", "overdoc", "wording"];
const isFixable = (value: unknown): value is Category =>
  typeof value === "string" && FIXABLE.some((c) => c === value);

/**
 * 直してよいファイル。人が読む文書のうち、エージェントやツールの振る舞いを変えないものに限る。
 * AGENTS.md・.agents/rules/・skills/ は、エージェントの振る舞いを変え、skills/ はインストール済みのコピーとの同期も要るので外す。
 */
const ALLOWED_PATHS = [
  /^docs\/[A-Za-z0-9._/-]+\.md$/u,
  /^README\.md$/u,
  /^evals\/[A-Za-z0-9._-]+\/README\.md$/u,
];

/** 1 回の PR に入れる候補の上限。人がまとめてレビューできる量にする。 */
const MAX_CANDIDATES = 10;
/** 理由の欄の上限。PR の本文とコメントの上限を守るため。 */
const MAX_REASON_CHARS = 300;
/** commit を足さずに続けて PR を残せる週の数。超えたら PR への追加をやめる。 */
export const WEEKS_LIMIT = 3;
/** 週ごとのコメントの目印。続けて残った週の数を、この目印のコメントで数える。 */
export const UPDATE_MARKER = "<!-- self-review-fix:update -->";

export type Candidate = Pick<Finding, "category" | "path" | "summary" | "suggestion">;
export type Result = { applied: string[]; skipped: { key: string; reason: string }[] };

const keyOf = (c: Pick<Finding, "category" | "path">): string => `${c.category} ${c.path}`;

/** パスが直してよいファイルの形か。`.` と `..` の区切りを持つパスは、形が合っても外す（docs/../AGENTS.md など）。 */
export function isAllowedPath(path: string): boolean {
  if (path.split("/").some((part) => part === "." || part === ".." || part === "")) return false;
  return ALLOWED_PATHS.some((form) => form.test(path));
}

/**
 * 点検の結果から、直す候補を選ぶ。直せる項目で、直してよいファイルで、リポジトリにあるファイルの指摘だけを残す。
 * ワークフローが点検の前に置く canary は、点検の run の作業ツリーにしか無いので、ここで外れる。
 */
export function selectCandidates(
  findings: readonly Finding[],
  isFile: (path: string) => boolean,
): Candidate[] {
  return mergeFindings(findings)
    .filter((f) => isFixable(f.category) && isAllowedPath(f.path) && isFile(f.path))
    .slice(0, MAX_CANDIDATES)
    .map(({ category, path, summary, suggestion }) => ({ category, path, summary, suggestion }));
}

export function parseCandidates(source: string): Candidate[] {
  const value: unknown = JSON.parse(source);
  if (!isArray(value)) throw new Error("候補が配列でない");
  return value.map((c, i) => {
    if (!isRecord(c)) throw new Error(`候補[${i}] がオブジェクトでない`);
    const { category, path, summary, suggestion } = c;
    if (!isFixable(category)) {
      throw new Error(`候補[${i}].category が直せる項目でない`);
    }
    if (typeof path !== "string" || !isAllowedPath(path)) {
      throw new Error(`候補[${i}].path が直してよいファイルでない`);
    }
    if (typeof summary !== "string" || typeof suggestion !== "string") {
      throw new Error(`候補[${i}] の summary か suggestion が文字列でない`);
    }
    const candidate: Candidate = { category, path, summary, suggestion };
    return candidate;
  });
}

function reasonText(value: unknown, where: string): string {
  if (!isNonBlankString(value)) throw new Error(`${where} が空でない文字列でない`);
  const chars = Array.from(oneLine(value));
  return chars.length > MAX_REASON_CHARS
    ? `${chars.slice(0, MAX_REASON_CHARS).join("")}…`
    : chars.join("");
}

function resultKey(value: unknown, where: string, known: ReadonlySet<string>): string {
  if (!isRecord(value)) throw new Error(`${where} がオブジェクトでない`);
  const key = `${String(value["category"])} ${String(value["path"])}`;
  if (!known.has(key)) throw new Error(`${where} が候補に無い（${JSON.stringify(key)}）`);
  return key;
}

/**
 * エージェントの結果を読む。直した候補（applied）と、直さなかった候補（skipped）と理由を書く。
 * 候補に無い指摘を挙げた結果や、同じ候補を 2 回挙げた結果は、形の誤りとして例外にする。
 */
export function parseResult(source: string, candidates: readonly Candidate[]): Result {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error("エージェントの結果が JSON として読めない", { cause: error });
  }
  if (!isRecord(value)) throw new Error("エージェントの結果がオブジェクトでない");
  const { applied, skipped } = value;
  if (!isArray(applied) || !isArray(skipped)) throw new Error("applied か skipped が配列でない");
  const known = new Set(candidates.map(keyOf));
  const appliedKeys = applied.map((a, i) => resultKey(a, `applied[${i}]`, known));
  const skippedRows = skipped.map((s, i) => ({
    key: resultKey(s, `skipped[${i}]`, known),
    reason: reasonText(isRecord(s) ? s["reason"] : undefined, `skipped[${i}].reason`),
  }));
  const all = [...appliedKeys, ...skippedRows.map((s) => s.key)];
  const duplicate = all.find((k, i) => all.indexOf(k) !== i);
  if (duplicate !== undefined) throw new Error(`同じ候補を 2 回挙げている: ${duplicate}`);
  return { applied: appliedKeys, skipped: skippedRows };
}

/**
 * `git status --porcelain=v1 -z --untracked-files=all` の出力を読み、変わったファイルを返す。
 * 内容の変更（` M`・`M `・`MM`）でないもの（追加・削除・名前の変更・追跡していないファイル）は、エージェントの手順の外なので例外にする。
 */
export function changedFiles(status: string): string[] {
  const entries = status.split("\0").filter((e) => e !== "");
  return entries.map((entry) => {
    const state = entry.slice(0, 2);
    const path = entry.slice(3);
    if (![" M", "M ", "MM"].includes(state)) {
      throw new Error(`内容の変更でない変化がある（${JSON.stringify(state)} ${path}）`);
    }
    return path;
  });
}

/**
 * エージェントが変えたファイルが、直したと書いた候補のファイルと一致するかを確かめる。
 * 直したと書いたのに変わっていないファイルも、変えたのに直したと書いていないファイルも、例外にする。
 */
export function checkChanges(
  changed: readonly string[],
  result: Result,
  candidates: readonly Candidate[],
): void {
  const byKey = new Map(candidates.map((c) => [keyOf(c), c.path]));
  const appliedPaths = new Set(result.applied.map((k) => byKey.get(k) ?? ""));
  for (const path of changed) {
    if (!isAllowedPath(path)) throw new Error(`直してよいファイルの外を変えた: ${path}`);
    if (!appliedPaths.has(path)) throw new Error(`直したと書いていないファイルを変えた: ${path}`);
  }
  const changedSet = new Set(changed);
  for (const path of appliedPaths) {
    if (!changedSet.has(path)) throw new Error(`直したと書いたのに変わっていない: ${path}`);
  }
}

type Author = { login: string };
export type PrState = {
  number: number;
  mergeable: string;
  reviews: { author: Author | null }[];
  comments: { author: Author | null; body: string }[];
} | null;

export type Decision = { action: "create" | "update" | "hold" | "stop"; reason: string };

/** bot の投稿か。gh の JSON は、GitHub App の login を `app/<slug>` の形で返す。 */
const isBot = (author: Author | null): boolean =>
  author === null || author.login.startsWith("app/") || author.login.endsWith("[bot]");

/**
 * 今週の PR の扱いを決める。
 * - open の PR が無ければ、作る（create）
 * - コンフリクトしている PR と、人がレビューかコメントをした PR には、commit を足さない（hold）
 * - `WEEKS_LIMIT` 週続けて残った PR には、commit を足さない（stop）
 * - それ以外は、同じ PR に commit を足す（update）
 */
export function decide(pr: PrState, bot: string): Decision {
  if (pr === null) return { action: "create", reason: "open の PR が無い" };
  if (pr.mergeable === "CONFLICTING") {
    return { action: "hold", reason: `#${pr.number} が main とコンフリクトしている` };
  }
  const human = [...pr.reviews, ...pr.comments].some((p) => !isBot(p.author));
  if (human) return { action: "hold", reason: `#${pr.number} に人のレビューかコメントがある` };
  const weeks = pr.comments.filter(
    (c) => c.author?.login === bot && c.body.startsWith(UPDATE_MARKER),
  ).length;
  if (weeks >= WEEKS_LIMIT) {
    return { action: "stop", reason: `#${pr.number} が ${weeks} 週続けて処理されていない` };
  }
  return { action: "update", reason: `#${pr.number} に commit を足す` };
}

function parsePrState(source: string): PrState {
  const value: unknown = JSON.parse(source);
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("PR の状態がオブジェクトでも null でもない");
  const { number, mergeable, reviews, comments } = value;
  if (typeof number !== "number" || typeof mergeable !== "string") {
    throw new Error("PR の状態の number か mergeable の形が違う");
  }
  if (!isArray(reviews) || !isArray(comments)) throw new Error("reviews か comments が配列でない");
  const author = (v: unknown): Author | null =>
    isRecord(v) && isRecord(v["author"]) && typeof v["author"]["login"] === "string"
      ? { login: v["author"]["login"] }
      : null;
  return {
    number,
    mergeable,
    reviews: reviews.map((r) => ({ author: author(r) })),
    comments: comments.map((c) => ({
      author: author(c),
      body: isRecord(c) && typeof c["body"] === "string" ? c["body"] : "",
    })),
  };
}

const DATE_FORM = /^\d{4}-\d{2}-\d{2}$/u;

function rows(candidates: readonly Candidate[], keys: readonly string[]): string[] {
  const byKey = new Map(candidates.map((c) => [keyOf(c), c]));
  return keys.map((k) => {
    const c = byKey.get(k);
    if (c === undefined) throw new Error(`候補に無い: ${k}`);
    return `- ${c.category} ${c.path}: ${codeSpan(oneLine(c.summary))}`;
  });
}

export type PrInput = {
  candidates: readonly Candidate[];
  result: Result;
  date: string;
  tracking: number | undefined;
};

/** PR の本文と、週ごとのコメントを作る。指摘の文はエージェントが書いたものなので、コードスパンに入れてリテラルにする。 */
export function formatPr(input: PrInput): { body: string; comment: string } {
  const { candidates, result, date, tracking } = input;
  if (!DATE_FORM.test(date)) throw new Error(`日付の形でない: ${date}`);
  const source = tracking === undefined ? "週次のセルフ点検の追跡 Issue" : `#${tracking}`;
  const body = [
    `週次のセルフ点検（${source}）の指摘のうち、文の書き換えで直せるものを直した PR です。`,
    "この PR は `Self review fix` ワークフローが作成し、毎週 commit を足します。マージするかは人が決めます。",
    "人がレビューかコメントをすると、ワークフローはこの PR に commit を足しません。",
    "直し方は `docs/self-review-fix-procedure.md` にあります。週ごとに直した指摘は、コメントにあります。",
    "",
  ].join("\n");
  const skipped = result.skipped.map((s) => `- ${s.key}: ${codeSpan(s.reason)}`);
  const comment = [
    UPDATE_MARKER,
    `${date} の点検の指摘を ${result.applied.length} 件直した。`,
    "",
    ...rows(candidates, result.applied),
    ...(skipped.length > 0 ? ["", "直さなかった指摘:", "", ...skipped] : []),
    "",
  ].join("\n");
  return { body, comment };
}

const USAGE =
  "使い方: node scripts/weekly/self-review-fix.ts <select|check|decide|body> ...（引数はファイルの先頭のコメントにある）";

function required(values: Record<string, string>, names: readonly string[]): string[] {
  return names.map((name) => {
    const value = values[name];
    if (!isNonBlankString(value)) throw new Error(`--${name} が無い`);
    return value;
  });
}

const read = (path: string): string => readFileSync(path, "utf8");

function runSelect(values: Record<string, string>): void {
  const [report = "", root = "", out = ""] = required(values, ["report", "root", "out"]);
  const isFile = (p: string): boolean =>
    existsSync(join(root, p)) && statSync(join(root, p)).isFile();
  const candidates = selectCandidates(parseReport(read(report)).findings, isFile);
  writeFileSync(out, `${JSON.stringify(candidates, null, 2)}\n`);
  console.log(`count=${candidates.length}`);
}

function runCheck(values: Record<string, string>): void {
  const [cand = "", res = "", status = ""] = required(values, ["candidates", "result", "status"]);
  const candidates = parseCandidates(read(cand));
  const result = parseResult(read(res), candidates);
  checkChanges(changedFiles(read(status)), result, candidates);
  console.log(`applied=${result.applied.length}`);
}

function runDecide(values: Record<string, string>): void {
  const [pr = "", bot = ""] = required(values, ["pr", "bot"]);
  const decision = decide(parsePrState(read(pr)), bot);
  console.log(`action=${decision.action}`);
  console.log(`reason=${decision.reason}`);
}

function runBody(values: Record<string, string>): void {
  const names = ["candidates", "result", "date", "out", "comment-out"];
  const [cand = "", res = "", date = "", out = "", commentOut = ""] = required(values, names);
  const raw = values["tracking"];
  const tracking = raw === undefined ? undefined : Number(raw);
  if (tracking !== undefined && !Number.isSafeInteger(tracking)) {
    throw new Error("--tracking が整数でない");
  }
  const candidates = parseCandidates(read(cand));
  const result = parseResult(read(res), candidates);
  const { body, comment } = formatPr({ candidates, result, date, tracking });
  writeFileSync(out, body);
  writeFileSync(commentOut, comment);
}

const COMMANDS: Record<string, (values: Record<string, string>) => void> = {
  select: runSelect,
  check: runCheck,
  decide: runDecide,
  body: runBody,
};

export function main(args: readonly string[]): number {
  const [command = "", ...rest] = args;
  let values: Record<string, string>;
  try {
    values = parseArgs([...rest]);
  } catch {
    console.error(USAGE);
    return 2;
  }
  const handler = COMMANDS[command];
  if (handler === undefined) {
    console.error(USAGE);
    return 2;
  }
  try {
    handler(values);
    return 0;
  } catch (error) {
    console.error(`self-review-fix: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
