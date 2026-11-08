// 週次のセキュリティ監査（Issue #941。親は #508）で、監査の記録から追跡 Issue の本文とコメントを作る。
// 監査は cloudflare/security-audit-skill をエージェントが実行し、実行の出力のディレクトリに
// run-metadata.json（実行の状態）と findings.json（指摘の記録）を書く。
// 週次のワークフロー（.github/workflows/security-audit.yml）が、2 つの段で実行する。
//
// summarize: 監査のジョブで、出力のディレクトリから公開してよい要約（件数・状態・識別子）だけを取り出す。
//   公開リポジトリの追跡 Issue に脆弱性の詳細を書かないため、指摘の題名・説明・場所は要約に入れない。
//   識別子は、指摘の fingerprint（エージェントが書く、原因を表す文字列）を、鍵付きハッシュ（HMAC-SHA256）にして先頭 12 桁にする。
//   鍵が無いと、ファイル名などから fingerprint を推測して、ハッシュが一致するかで指摘の中身を確かめられるためである。
//   鍵は環境変数 SECURITY_AUDIT_STATE_KEY（記録を暗号化する鍵と同じ）から読む。
// issue: 追跡 Issue のジョブで、要約と前回の本文から、本文とコメントを作る。標準出力の最後の行に `due=<件数>` を出す。
//   件数は、confirmed（確かめた脆弱性）と needs_validation（確かめきれなかった候補）の合計である。
//
// 使い方は次のとおりである。
// node scripts/weekly/security-audit-issue.ts summarize --run-dir <出力のディレクトリ> --out <要約の JSON>
//
// node scripts/weekly/security-audit-issue.ts issue --summary <要約の JSON> \
//   --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../lib/cli/args.ts";
import { isCliEntry } from "../lib/cli/entry.ts";
import { errorMessage } from "../lib/errors.ts";
import { isNonBlankString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import {
  formatDiffComment,
  parseTrackingCliWith,
  trackingKeys,
} from "../lib/text/tracking-diff.ts";

const VERDICTS = ["confirmed", "needs_validation", "rejected"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
const PROFILES = ["quick", "standard", "deep"] as const;
const RUN_STATUSES = ["complete", "incomplete"] as const;

export type Verdict = (typeof VERDICTS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Item = { id: string; verdict: Verdict; severity: Severity | null };
export type Summary = {
  run_status: (typeof RUN_STATUSES)[number];
  incomplete_reason: string | null;
  profile: (typeof PROFILES)[number];
  items: Item[];
};

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.some((v) => v === value);

/** 識別子の形。HMAC-SHA256 の先頭 12 桁に `sa-` を付ける。前回の本文の目印も、この形だけを読む。 */
const ID_FORM = /^sa-[0-9a-f]{12}$/u;
/**
 * 未完了の理由の形。上流のスキルは `validation_budget_exhausted` のような英小文字とアンダースコアの語を書く。
 * エージェントが文を書いたときに、その文を公開の Issue に載せないよう、この形でなければ `unrecognized` にする。
 */
const REASON_FORM = /^[a-z0-9_]{1,80}$/u;

/** 鍵付きハッシュで識別子を作る。同じ鍵と fingerprint なら、実行をまたいで同じ識別子になる。 */
export function itemId(key: string, fingerprint: string): string {
  return `sa-${createHmac("sha256", key).update(fingerprint).digest("hex").slice(0, 12)}`;
}

function readJson(path: string, label: string): unknown {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${label} を読めない`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    // Node のメッセージは入力の抜粋を含むので、Issue に載るエラーには出さない。
    throw new Error(`${label} が JSON として読めない`, { cause: error });
  }
}

/** run-metadata.json から、実行の状態・未完了の理由・プロファイルを読む。 */
export function parseMetadata(value: unknown): Omit<Summary, "items"> {
  if (!isRecord(value)) throw new Error("run-metadata.json がオブジェクトでない");
  const { run_status: status, incomplete_reason: reason, profile } = value;
  if (!oneOf(RUN_STATUSES, status)) {
    // in_progress のままなら、監査が途中で止まった（時間切れ・ターンの終了）ので、結果として扱わない。
    throw new Error(
      `run_status が complete でも incomplete でもない（値: ${typeof status === "string" && REASON_FORM.test(status) ? status : "読めない"}）。監査が終わっていない`,
    );
  }
  if (!oneOf(PROFILES, profile)) throw new Error("profile が quick・standard・deep のどれでもない");
  let incomplete: string | null = null;
  if (status === "incomplete") {
    incomplete = typeof reason === "string" && REASON_FORM.test(reason) ? reason : "unrecognized";
  }
  return { run_status: status, incomplete_reason: incomplete, profile };
}

/** findings.json の記録から、判定・重大度・識別子だけを取り出す。fingerprint が重複していれば例外にする。 */
export function parseFindings(value: unknown, key: string): Item[] {
  if (!isArray(value)) throw new Error("findings.json が配列でない");
  const seen = new Set<string>();
  const items = value.map((record, i): Item => {
    const where = `findings.json[${i}]`;
    if (!isRecord(record)) throw new Error(`${where} がオブジェクトでない`);
    const { verdict, fingerprint, severity } = record;
    if (!oneOf(VERDICTS, verdict)) throw new Error(`${where}.verdict が知らない値`);
    if (!isNonBlankString(fingerprint)) throw new Error(`${where}.fingerprint が空`);
    if (seen.has(fingerprint)) throw new Error(`${where}.fingerprint が重複している`);
    seen.add(fingerprint);
    let level: Severity | null = null;
    if (verdict === "confirmed") {
      const overall = isRecord(severity) ? severity["overall_severity"] : undefined;
      if (!oneOf(SEVERITIES, overall))
        throw new Error(`${where}.severity.overall_severity が知らない値`);
      level = overall;
    }
    return { id: itemId(key, fingerprint), verdict, severity: level };
  });
  // 識別子は同じ長さの 16 進数なので、文字列のまま比べる（数として比べると桁の並びが変わる）。
  return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 出力のディレクトリから、公開してよい要約を作る。 */
export function summarize(runDir: string, key: string): Summary {
  if (key === "") throw new Error("識別子を作る鍵（SECURITY_AUDIT_STATE_KEY）が空");
  const metadata = parseMetadata(readJson(join(runDir, "run-metadata.json"), "run-metadata.json"));
  const items = parseFindings(readJson(join(runDir, "findings.json"), "findings.json"), key);
  return { ...metadata, items };
}

/** 要約を読む。別のジョブから artifact で受け取るので、summarize が書く形かを確かめ直す。 */
export function parseSummary(value: unknown): Summary {
  if (!isRecord(value) || !isArray(value["items"])) throw new Error("要約の形が違う");
  const metadata = parseMetadata(value);
  const reason = value["incomplete_reason"];
  if (metadata.run_status === "incomplete" && reason !== metadata.incomplete_reason) {
    throw new Error("要約の incomplete_reason の形が違う");
  }
  const items = value["items"].map((item, i): Item => {
    if (!isRecord(item)) throw new Error(`items[${i}] がオブジェクトでない`);
    const { id, verdict, severity } = item;
    if (typeof id !== "string" || !ID_FORM.test(id)) throw new Error(`items[${i}].id の形が違う`);
    if (!oneOf(VERDICTS, verdict)) throw new Error(`items[${i}].verdict が知らない値`);
    // 重大度は confirmed だけが持つ。ほかの判定に値があるか、confirmed に無ければ、summarize が書く形でない。
    let level: Severity | null = null;
    if (verdict === "confirmed") {
      if (!oneOf(SEVERITIES, severity)) throw new Error(`items[${i}].severity が判定と合わない`);
      level = severity;
    } else if (severity !== null) {
      throw new Error(`items[${i}].severity が判定と合わない`);
    }
    return { id, verdict, severity: level };
  });
  return { ...metadata, items };
}

/** 追跡 Issue に載せる（人の対応が要る）記録。rejected は、候補を否定できた記録なので載せない。 */
const isDue = (item: Item): boolean => item.verdict !== "rejected";

const tracking = trackingKeys<Item>({
  marker: "security-audit",
  keyForm: ID_FORM,
  keyOf: (item) => item.id,
});
export const { previousKeys } = tracking;

const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: "確かめた脆弱性（confirmed）",
  needs_validation: "確かめきれなかった候補（needs_validation）",
  rejected: "否定した候補（rejected）",
};

function countLines(items: readonly Item[]): string[] {
  const lines = ["| 判定 | 件数 | 重大度の内訳 |", "| --- | --- | --- |"];
  for (const verdict of VERDICTS) {
    const ofVerdict = items.filter((item) => item.verdict === verdict);
    const bySeverity =
      verdict === "confirmed"
        ? SEVERITIES.map(
            (s) => [s, ofVerdict.filter((item) => item.severity === s).length] as const,
          )
            .filter(([, n]) => n > 0)
            .map(([s, n]) => `${s} ${n}`)
            .join("・")
        : "";
    lines.push(`| ${VERDICT_LABEL[verdict]} | ${ofVerdict.length} | ${bySeverity} |`);
  }
  return [...lines, ""];
}

function itemLines(due: readonly Item[], kept: ReadonlySet<string>): string[] {
  if (due.length === 0) return [];
  const lines = ["| 識別子 | 判定 | 重大度 | 前回から |", "| --- | --- | --- | --- |"];
  for (const item of due) {
    const state = kept.has(item.id) ? "継続" : "新規";
    lines.push(`| ${item.id} | ${item.verdict} | ${item.severity ?? ""} | ${state} |`);
  }
  return [...lines, ""];
}

/** 追跡 Issue の本文。最後の行に、次の実行が差分に使う識別子の一覧を埋める。 */
export function formatBody(summary: Summary, previous: readonly string[] = []): string {
  const due = summary.items.filter(isDue);
  const { kept, resolved } = tracking.diff(due, previous);
  const status =
    summary.run_status === "complete"
      ? "完了"
      : `未完了（理由: ${summary.incomplete_reason ?? "unrecognized"}）。網羅していない範囲がある`;
  const lines = [
    "LLM による週次のセキュリティ監査（cloudflare/security-audit-skill）で残った記録の件数です。",
    "この Issue は `Security audit` ワークフローが作成・更新・クローズします。脆弱性の詳細はここに書きません。",
    "詳細は、run の暗号化した記録（artifact）を手元で復号して読みます（手順は `docs/security-scanning.md`）。",
    "",
    `監査: プロファイル ${summary.profile}・${status}`,
    "",
    ...countLines(summary.items),
    ...itemLines(due, new Set(kept)),
  ];
  return tracking.finish(lines, due, resolved);
}

/** 追跡 Issue に足すコメント。本文の更新だけでは通知が届かないので、差分をコメントにも書く。 */
export function formatComment(summary: Summary, previous: readonly string[]): string {
  const due = summary.items.filter(isDue);
  const diff = formatDiffComment("対応が要る記録", due.length, tracking.diff(due, previous));
  if (summary.run_status === "complete") return diff;
  return `${diff}\n監査は未完了です（理由: ${summary.incomplete_reason ?? "unrecognized"}）。\n`;
}

const USAGE = [
  "使い方: node scripts/weekly/security-audit-issue.ts summarize --run-dir <出力のディレクトリ> --out <要約の JSON>",
  "       node scripts/weekly/security-audit-issue.ts issue --summary <要約の JSON> --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]",
].join("\n");

function runSummarize(args: readonly string[]): number {
  let values: Record<string, string>;
  try {
    values = parseArgs([...args]);
  } catch {
    console.error(USAGE);
    return 2;
  }
  const { "run-dir": runDir, out, ...rest } = values;
  if (!isNonBlankString(runDir) || !isNonBlankString(out) || Object.keys(rest).length > 0) {
    console.error(USAGE);
    return 2;
  }
  const summary = summarize(runDir, process.env["SECURITY_AUDIT_STATE_KEY"] ?? "");
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`items=${summary.items.length} run_status=${summary.run_status}`);
  return 0;
}

function runIssue(args: readonly string[]): number {
  const cli = parseTrackingCliWith(args, ["summary"]);
  if (cli === null) {
    console.error(USAGE);
    return 2;
  }
  const previous =
    cli.previous === undefined ? [] : previousKeys(readFileSync(cli.previous, "utf8"));
  const summary = parseSummary(readJson(cli.extra["summary"] ?? "", "要約"));
  writeFileSync(cli.out, formatBody(summary, previous));
  writeFileSync(cli.commentOut, formatComment(summary, previous));
  console.log(`due=${summary.items.filter(isDue).length}`);
  return 0;
}

export function main(args: readonly string[]): number {
  const [command, ...rest] = args;
  try {
    if (command === "summarize") return runSummarize(rest);
    if (command === "issue") return runIssue(rest);
  } catch (error) {
    console.error(`security-audit-issue: ${errorMessage(error)}`);
    return 1;
  }
  console.error(USAGE);
  return 2;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
