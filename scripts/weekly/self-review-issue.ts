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
import { errorMessage } from "../lib/errors.ts";
import { isNonBlankString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import {
  formatDiffComment,
  naturalOrder,
  oneLine,
  parseTrackingCliWith,
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

/** 1 欄の上限。手順（docs/self-review-procedure.md）の目安と同じにする。 */
const MAX_TEXT_CHARS = 300;
/** 表に載せる指摘の上限。手順の目安と同じにし、本文が GitHub の上限を超えないようにする。前回との比較は全件で行う。 */
const MAX_FINDINGS = 40;
const MAX_NOTES = 20;
/** Anthropic の API キーと OAuth トークンの形。結果にあれば、Issue に載せずに失敗させる。 */
const CREDENTIAL = /sk-ant-[\w-]{8,}/u;

/** エージェントが書いた文を 1 行にし、1 欄 `MAX_TEXT_CHARS` 字までに切り詰める（本文とコメントの上限を守るため）。 */
const shorten = (value: string): string => {
  // サロゲートペア（絵文字など）を途中で切らないよう、コードポイントの単位で数える。
  const chars = Array.from(oneLine(value));
  return chars.length > MAX_TEXT_CHARS
    ? `${chars.slice(0, MAX_TEXT_CHARS).join("")}…`
    : chars.join("");
};

/**
 * 対象のパスに使える文字。パスは、本文の HTML コメントの目印と差分のコメントに、コードスパンに入れずに載る。
 * リポジトリのパスに使う文字だけに限ると、メンション・Issue への参照・リンク・画像・HTML のどれにもならない。
 */
const PATH_FORM = /^[A-Za-z0-9._/-]+$/u;

/**
 * 文をコードスパンに入れ、メンション・リンク・画像・HTML として読まれないリテラルにする。
 * 文の中のバッククォートより長い並びで囲むので、文がバッククォートを含んでも閉じない。
 * 形ごとに無害にする置換を足すと、GitHub がリンクにする形が増えるたびに抜けが出るので、まとめてリテラルにする。
 */
export function codeSpan(value: string): string {
  if (value === "") return "";
  const longest = Math.max(0, ...(value.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence} ${value} ${fence}`;
}

function text(value: unknown, where: string): string {
  if (!isNonBlankString(value)) throw new Error(`${where} が空でない文字列でない`);
  if (CREDENTIAL.test(value)) throw new Error(`${where} に資格情報の形の文字列がある`);
  return shorten(value);
}

/** 直し方の案は、無い指摘もある。省略・null・空白だけの文字列は、どれも案が無いものとして読む。 */
function optionalText(value: unknown, where: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" && value.trim() === "") return "";
  return text(value, where);
}

/**
 * 指摘を 1 件読む。対象のパスがリポジトリのパスの形（PATH_FORM）でなければ、その指摘だけを省いて null を返す。
 * 1 件の書き方の誤りで、その週のほかの指摘まで捨てないためである。ほかの形の誤りは、結果の形の誤りとして例外にする。
 */
function parseFinding(value: unknown, where: string): Finding | null {
  if (!isRecord(value)) throw new Error(`${where} がオブジェクトでない`);
  const { category } = value;
  if (!isCategory(category)) {
    throw new Error(
      `${where}.category が項目の値でない（使える値: ${Object.keys(CATEGORY_LABEL).join("・")}）`,
    );
  }
  const path = text(value["path"], `${where}.path`);
  if (!PATH_FORM.test(path)) return null;
  return {
    category,
    path,
    summary: text(value["summary"], `${where}.summary`),
    evidence: text(value["evidence"], `${where}.evidence`),
    suggestion: optionalText(value["suggestion"], `${where}.suggestion`),
  };
}

/** 結果の JSON を読む。形が違えば、どこが違うかを書いて例外にする。 */
export function parseReport(source: string): Report {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    // Node のメッセージは入力の抜粋を含むので、Issue に載るエラーには出さない。
    throw new Error("結果が JSON として読めない", { cause: error });
  }
  if (!isRecord(value)) throw new Error("結果がオブジェクトでない");
  const { findings, notes } = value;
  if (!isArray(findings)) throw new Error("findings が配列でない");
  if (notes !== undefined && !isArray(notes)) throw new Error("notes が配列でない");
  const parsed = findings.map((f, i) => parseFinding(f, `findings[${i}]`));
  const valid = parsed.filter((f): f is Finding => f !== null);
  // メモは、指摘 0 件の週にコメントへ載せるので、件数にも上限を置く。
  const read = (notes ?? []).slice(0, MAX_NOTES).map((n, i) => text(n, `notes[${i}]`));
  const skipped = parsed.length - valid.length;
  const extra =
    skipped > 0
      ? [`対象のパスがリポジトリのパスの形（英数字・.・_・-・/）でない指摘を ${skipped} 件省いた`]
      : [];
  return { findings: valid, notes: [...read, ...extra] };
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
        seen[field] = seen[field] === "" ? f[field] : shorten(`${seen[field]} / ${f[field]}`);
    }
  }
  return [...merged.values()].sort((a, b) => naturalOrder(keyOf(a), keyOf(b)));
}

/**
 * canary の名前（拡張子を除いたファイル名）。ワークフローは、canary が起動するよう書いた存在しないスクリプトの名前にも、これを含める。
 * 例えば docs/release-notes-1a2b.md の名前は release-notes-1a2b で、スクリプトは scripts/tools/verify-release-notes-1a2b.ts である。
 */
function canaryStem(canary: string): string {
  const stem = canary.replace(/^.*\//u, "").replace(/\.[^.]*$/u, "");
  // 空だと、すべての指摘の path に一致し、すべてを canary として除いて合格にしてしまう。
  if (stem === "") throw new Error(`canary のパスから名前を取り出せない: ${canary}`);
  return stem;
}

/**
 * canary への指摘を取り除く。canary か、canary が書いた存在しないスクリプトを対象にした指摘を、canary への指摘とする。
 * それが 1 件も無ければ、点検が機能していないとして例外にする。内容で触れただけでは見つけたことにしない
 * （ファイルの一覧を貼っただけの指摘で、食い違いを見つけていなくても合格になるため）。
 */
export function dropCanary(report: Report, canary: string): Report {
  const stem = canaryStem(canary);
  const rest = report.findings.filter((f) => !f.path.includes(stem));
  if (rest.length === report.findings.length) {
    throw new Error(
      `既知の食い違いを置いた ${canary} への指摘が無い。点検が機能していないので、指摘 0 件として扱わない`,
    );
  }
  return { findings: rest, notes: report.notes };
}

// 識別子の対象の部分は、PATH_FORM と同じ文字に限る。前回の本文を人が編集しても、メンションやリンクを「解消」に出さないため。
const KEY_FORM = new RegExp(`^(${Object.keys(CATEGORY_LABEL).join("|")}) [A-Za-z0-9._/-]+$`, "u");
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
    const texts = [f.summary, f.evidence, f.suggestion].map(codeSpan);
    const cells = [CATEGORY_LABEL[f.category], f.path, ...texts];
    lines.push(`| ${cells.map(tableCell).join(" | ")} | ${state} |`);
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
    // 前回との比較と識別子の目印は全件で行い、表だけを切り詰める。比較の前に切ると、残っている指摘を「解消」と書いてしまう。
    ...findingTable(findings.slice(0, MAX_FINDINGS), new Set(kept)),
  ];
  if (findings.length > MAX_FINDINGS) {
    lines.push(`表には、先頭の ${MAX_FINDINGS} 件だけを載せた。`, "");
  }
  if (notes.length > 0) {
    lines.push("<details><summary>点検のメモ（指摘にしなかったもの）</summary>", "");
    lines.push(...notes.map((n) => `- ${codeSpan(n)}`), "", "</details>", "");
  }
  return tracking.finish(lines, findings, resolved);
}

/**
 * 追跡 Issue に足すコメント。指摘が 0 件の週は Issue を閉じて本文を書き換えないので、点検のメモをコメントに載せる。
 * メモには、読めなかった入力や確かめられなかった項目が書かれる。
 */
export function formatComment(report: Report, previous: readonly string[]): string {
  const { findings, notes } = report;
  const diff = formatDiffComment("指摘", findings.length, diffFindings(findings, previous));
  if (findings.length > 0 || notes.length === 0) return diff;
  return `${diff}\n点検のメモ:\n\n${notes.map((n) => `- ${codeSpan(n)}`).join("\n")}\n`;
}

const USAGE =
  "使い方: node scripts/weekly/self-review-issue.ts --report <結果の JSON> --canary <canary のパス> --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]";

/** 本文の上限。GitHub の Issue の本文は 65,536 字までなので、超える前に失敗として扱う。 */
const MAX_BODY_CHARS = 60_000;

export function main(args: readonly string[]): number {
  const cli = parseTrackingCliWith(args, ["report", "canary"]);
  if (cli === null) {
    console.error(USAGE);
    return 2;
  }
  try {
    const previous =
      cli.previous === undefined ? [] : previousKeys(readFileSync(cli.previous, "utf8"));
    const { report: reportPath = "", canary = "" } = cli.extra;
    const report = dropCanary(parseReport(readFileSync(reportPath, "utf8")), canary);
    const findings = mergeFindings(report.findings);
    const { notes } = report;
    const body = formatBody({ findings, notes }, previous);
    if (body.length > MAX_BODY_CHARS) {
      throw new Error(
        `本文が ${body.length} 字で、上限の ${MAX_BODY_CHARS} 字を超える。手順の件数と字数の目安を守っているかを確かめる`,
      );
    }
    const comment = formatComment({ findings, notes }, previous);
    if (comment.length > MAX_BODY_CHARS) {
      throw new Error(`コメントが ${comment.length} 字で、上限の ${MAX_BODY_CHARS} 字を超える`);
    }
    writeFileSync(cli.out, body);
    writeFileSync(cli.commentOut, comment);
    console.log(`due=${findings.length}`);
    return 0;
  } catch (error) {
    console.error(`self-review-issue: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
