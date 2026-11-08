// 週次のセルフ点検（Issue #940。親は #508）で、エージェントが書いた結果の JSON から追跡 Issue の本文とコメントを作る。
// 週次のワークフロー（.github/workflows/self-review.yml）が、エージェントのジョブと別のジョブで実行する。
// 点検の手順と JSON の形は docs/self-review-procedure.md にある。
//
// 点検が動いていない状態を「指摘 0 件」として扱わないよう、ワークフローは点検の前に、既知の食い違いを持つファイル（canary）を
// 作業ツリーに置く。結果に canary への指摘が無ければ、点検が機能していないとして exit 1 で止まる。canary への指摘は本文に載せない。
// 結果のファイルを読めない・形が違うときも exit 1 で止まる。
//
// 使い方は次のとおりである。
// node scripts/weekly/self-review-issue.ts --report <結果の JSON> --canary <canary のパス> \
//   --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]
// 標準出力の最後の行に `due=<件数>` を出す。
import { readFileSync, writeFileSync } from "node:fs";
import { isCliEntry } from "../lib/cli/entry.ts";
import { parseArgs } from "../lib/cli/args.ts";
import { errorMessage } from "../lib/errors.ts";
import { isNonBlankString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import {
  formatDiffComment,
  naturalOrder,
  oneLine,
  tableCell,
  trackingKeys,
} from "../lib/text/tracking-diff.ts";

/** 点検の項目と、追跡 Issue に出す名前。値は docs/self-review-procedure.md の `category` と同じにする。 */
const CATEGORY_LABEL = {
  unused: "不要物",
  inconsistency: "文書の食い違い・重複",
  overdoc: "やりすぎな記述",
  overcheck: "やりすぎなチェック",
  eval: "回帰 eval の妥当性",
  actions: "効果の無い GitHub Actions",
  wording: "分かりにくい語・旧称",
} as const;

export type Category = keyof typeof CATEGORY_LABEL;
export type Finding = {
  category: Category;
  path: string;
  summary: string;
  evidence: string;
  suggestion: string;
};
export type Report = { findings: Finding[]; notes: string[] };

const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && Object.hasOwn(CATEGORY_LABEL, value);

function text(value: unknown, where: string): string {
  if (!isNonBlankString(value)) throw new Error(`${where} が空でない文字列でない`);
  return oneLine(value);
}

function parseFinding(value: unknown, where: string): Finding {
  if (!isRecord(value)) throw new Error(`${where} がオブジェクトでない`);
  const { category } = value;
  if (!isCategory(category)) {
    throw new Error(
      `${where}.category が項目の値でない: ${JSON.stringify(category)}（使える値: ${Object.keys(CATEGORY_LABEL).join("・")}）`,
    );
  }
  const suggestion = value["suggestion"];
  return {
    category,
    path: text(value["path"], `${where}.path`),
    summary: text(value["summary"], `${where}.summary`),
    evidence: text(value["evidence"], `${where}.evidence`),
    suggestion: suggestion === undefined ? "" : text(suggestion, `${where}.suggestion`),
  };
}

/** 結果の JSON を読む。形が違えば、どこが違うかを書いて例外にする。 */
export function parseReport(source: string): Report {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`結果が JSON として読めない: ${errorMessage(error)}`, { cause: error });
  }
  if (!isRecord(value)) throw new Error("結果がオブジェクトでない");
  const { findings, notes } = value;
  if (!isArray(findings)) throw new Error("findings が配列でない");
  if (notes !== undefined && !isArray(notes)) throw new Error("notes が配列でない");
  return {
    findings: findings.map((f, i) => parseFinding(f, `findings[${i}]`)),
    notes: (notes ?? []).map((n, i) => text(n, `notes[${i}]`)),
  };
}

const keyOf = (f: Finding): string => `${f.category} ${f.path}`;

/** 同じ項目と対象の指摘を 1 件にまとめる。前回との差分はこの組で数えるので、組を一意にする。 */
export function mergeFindings(findings: readonly Finding[]): Finding[] {
  const merged = new Map<string, Finding>();
  for (const f of findings) {
    const seen = merged.get(keyOf(f));
    if (seen === undefined) {
      merged.set(keyOf(f), { ...f });
      continue;
    }
    for (const field of ["summary", "evidence", "suggestion"] as const) {
      if (f[field] !== "")
        seen[field] = seen[field] === "" ? f[field] : `${seen[field]} / ${f[field]}`;
    }
  }
  return [...merged.values()].sort((a, b) => naturalOrder(keyOf(a), keyOf(b)));
}

/**
 * canary の名前（拡張子を除いたファイル名）。ワークフローは、canary が起動するよう書いた存在しないスクリプトの名前にも、これを含める。
 * 例えば docs/release-notes-1a2b.md の名前は release-notes-1a2b で、スクリプトは scripts/tools/verify-release-notes-1a2b.ts である。
 */
const canaryStem = (canary: string): string =>
  canary.replace(/^.*\//u, "").replace(/\.[^.]*$/u, "");

/**
 * canary への指摘を取り除く。canary か、canary が書いた存在しないスクリプトを対象にした指摘だけを除く。
 * 内容で canary に触れていても、対象が別のファイルなら本物の指摘として残す（1 件の指摘が複数のファイルを挙げることがある）。
 * 対象にも内容にも canary が 1 件も現れなければ、点検が機能していないとして例外にする。
 */
export function dropCanary(findings: readonly Finding[], canary: string): Finding[] {
  const stem = canaryStem(canary);
  const seen = findings.some((f) =>
    [f.path, f.summary, f.evidence].some((field) => field.includes(stem)),
  );
  if (!seen) {
    throw new Error(
      `既知の食い違いを置いた ${canary} への指摘が無い。点検が機能していないので、指摘 0 件として扱わない`,
    );
  }
  return findings.filter((f) => !f.path.includes(stem));
}

/** canary に触れたメモを除く。canary は追跡 Issue に載せない。 */
const dropCanaryNotes = (notes: readonly string[], canary: string): string[] =>
  notes.filter((n) => !n.includes(canary));

/**
 * エージェントが書いた文を Issue に載せる形にする。`@name` は GitHub がメンションとして通知するので、
 * `@` の直後にゼロ幅スペースを入れる。`<` は、HTML のタグ（`<details>` など）として読まれないよう実体参照にする。
 */
const noMention = (value: string): string => value.replace(/@(?=[\w-])/gu, "@​");

const KEY_FORM = new RegExp(`^(${Object.keys(CATEGORY_LABEL).join("|")}) \\S(.*\\S)?$`, "u");
const tracking = trackingKeys({ marker: "self-review", keyForm: KEY_FORM, keyOf });
export const { previousKeys, diff: diffFindings } = tracking;

function findingTable(findings: readonly Finding[], kept: ReadonlySet<string>): string[] {
  if (findings.length === 0) return [];
  const lines = [
    "| 項目 | 対象 | 内容 | 根拠 | 直し方の案 | 前回から |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const f of findings) {
    const state = kept.has(keyOf(f)) ? "継続" : "新規";
    const cells = [CATEGORY_LABEL[f.category], f.path, f.summary, f.evidence, f.suggestion];
    lines.push(
      `| ${cells.map((c) => noMention(tableCell(c)).replaceAll("<", "&lt;")).join(" | ")} | ${state} |`,
    );
  }
  return [...lines, ""];
}

/** 追跡 Issue の本文。最後の行に、次の実行が差分に使う識別子の一覧を埋める。 */
export function formatBody(report: Report, previous: readonly string[] = []): string {
  const { findings, notes } = report;
  const { kept, resolved } = diffFindings(findings, previous);
  const lines = [
    "LLM による週次のセルフ点検で見つかった指摘の一覧です。直すか、決定論的なチェックに移すかは人が決めます。",
    "この Issue は `Self review` ワークフローが作成・更新・クローズします。点検の手順は `docs/self-review-procedure.md` にあります。",
    "",
    `指摘: ${findings.length} 件`,
    "",
    ...findingTable(findings, new Set(kept)),
  ];
  if (notes.length > 0) {
    lines.push("<details><summary>点検のメモ（指摘にしなかったもの）</summary>", "");
    lines.push(
      ...notes.map((n) => `- ${noMention(n).replaceAll("<", "&lt;")}`),
      "",
      "</details>",
      "",
    );
  }
  return tracking.finish(lines, findings, resolved);
}

export function formatComment(findings: readonly Finding[], previous: readonly string[]): string {
  return formatDiffComment("指摘", findings.length, diffFindings(findings, previous));
}

const NAMES = new Set(["report", "canary", "out", "comment-out", "previous"]);
const USAGE =
  "使い方: node scripts/weekly/self-review-issue.ts --report <結果の JSON> --canary <canary のパス> --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]";

type Cli = { report: string; canary: string; out: string; commentOut: string; previous?: string };

function parseCli(args: readonly string[]): Cli | null {
  let values: Record<string, string>;
  try {
    values = parseArgs([...args]);
  } catch {
    return null;
  }
  if (Object.keys(values).some((name) => !NAMES.has(name))) return null;
  const { report, canary, out, "comment-out": commentOut, previous } = values;
  const required = [report, canary, out, commentOut];
  if (!required.every(isNonBlankString)) return null;
  if (previous !== undefined && !isNonBlankString(previous)) return null;
  return { report, canary, out, commentOut, ...(previous === undefined ? {} : { previous }) };
}

export function main(args: readonly string[]): number {
  const cli = parseCli(args);
  if (cli === null) {
    console.error(USAGE);
    return 2;
  }
  try {
    const previous =
      cli.previous === undefined ? [] : previousKeys(readFileSync(cli.previous, "utf8"));
    const report = parseReport(readFileSync(cli.report, "utf8"));
    const findings = mergeFindings(dropCanary(report.findings, cli.canary));
    const result = { findings, notes: dropCanaryNotes(report.notes, cli.canary) };
    writeFileSync(cli.out, formatBody(result, previous));
    writeFileSync(cli.commentOut, formatComment(findings, previous));
    console.log(`due=${findings.length}`);
    return 0;
  } catch (error) {
    console.error(`self-review-issue: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
