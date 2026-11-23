// PostToolUseFailure の Hook。ツールの失敗か拒否のエラーの文を、一覧（tool-error-guides.json）の行と照らす。
// 一致した行があれば、その行の案内と規約の場所を、次の応答の前にエージェントへ渡す（additionalContext）。
// 同じセッションで、直前の失敗と同じツール・同じ入力・同じエラーが続いたら、同じ呼び出しを繰り返さないよう求める案内も渡す。
// 間に成功した呼び出しを挟んでも、直前の失敗の記録は消さない（成功の時点では Hook を呼ばない）。
//
// 文章の規約は文脈にあっても、誤りが分かる時点（エラーが返った時点）では何も知らせない。
// 学びごとに Hook を作らず、一覧に 1 行足して対応する（Issue #1122）。
//
// Claude Code は、実行を始めたツールが失敗したときに PostToolUseFailure を呼ぶ。
// 出典は https://code.claude.com/docs/en/hooks である。
// worktree の隔離セッションが git の複合コマンドを拒否したときも、このイベントで拒否の文が `error` に入ることを実測した。
// 入力の検証で返されたエラー（Edit の置換元が見つからないなど）と、PreToolUse の Hook による拒否では呼ばれない（実測）。
// 権限の拒否でも呼ばれないと、ドキュメントに書かれている。
//
// 判定を誤っても、案内が出ないか余分に出るだけで、ツールの結果は変えない。
// そのため、一覧や入力を読めないときは stderr に理由を出して 1 で終え、案内は出さない。
import { createHash } from "node:crypto";
import { closeSync, constants, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../lib/errors.ts";
import { isNonEmptyString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { isCliEntry } from "../lib/cli/entry.ts";
import { isCopilotClaudeSettingsPayload, parseHookInput } from "./stop-input.ts";

const HOOK = "tool-error-guide";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const GUIDES_PATH = join(REPO_ROOT, "scripts/hooks/tool-error-guides.json");

/** 一覧の 1 行。tool・input は省略でき、省略したときはその軸で絞らない。 */
export type Guide = {
  id: string;
  tool?: RegExp;
  error: RegExp;
  input?: RegExp;
  guide: string;
  rule: string;
};

/** 照合に使う失敗の情報。input は tool_input を JSON の文字列にしたもの。 */
export type Failure = { toolName: string; error: string; input: string };

export const REPEAT_GUIDE =
  "tool-error-guide: 直前に失敗した呼び出しと同じ呼び出しが、同じエラーで失敗しました。" +
  "同じ呼び出しを繰り返さず、エラーの文を読んで別のやり方（呼び出しを分ける・スクリプトにする・前提を確かめ直す）を取ってください。";

function regexOf(row: Record<string, unknown>, key: string, id: string): RegExp | undefined {
  const value = row[key];
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) throw new Error(`${id}: ${key} が空でない文字列でない`);
  try {
    return new RegExp(value);
  } catch (error) {
    throw new Error(`${id}: ${key} の正規表現を読めない: ${errorMessage(error)}`, { cause: error });
  }
}

function requiredString(row: Record<string, unknown>, key: string, id: string): string {
  const value = row[key];
  if (!isNonEmptyString(value)) throw new Error(`${id}: ${key} が空でない文字列でない`);
  return value;
}

/** 一覧の 1 行を読む。形が合わなければ、行の id か位置を添えて例外にする。 */
function parseGuide(row: unknown, index: number, seen: Set<string>): Guide {
  if (!isRecord(row)) throw new Error(`guides[${index}] がオブジェクトでない`);
  const id = requiredString(row, "id", `guides[${index}]`);
  if (seen.has(id)) throw new Error(`${id}: id が重複している`);
  seen.add(id);
  const error = regexOf(row, "error", id);
  if (!error) throw new Error(`${id}: error が無い`);
  return {
    id,
    tool: regexOf(row, "tool", id),
    error,
    input: regexOf(row, "input", id),
    guide: requiredString(row, "guide", id),
    rule: requiredString(row, "rule", id),
  };
}

/** 一覧の JSON を読む。読めない・形が合わないときは例外にする。 */
export function parseGuides(text: string): Guide[] {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !isArray(data.guides)) throw new Error("guides の配列が無い");
  const seen = new Set<string>();
  return data.guides.map((row, index) => parseGuide(row, index, seen));
}

/** 失敗に当たる行を、一覧の順に返す。 */
export function matchGuides(guides: Guide[], failure: Failure): Guide[] {
  return guides.filter(
    (g) =>
      g.error.test(failure.error) &&
      (!g.tool || g.tool.test(failure.toolName)) &&
      (!g.input || g.input.test(failure.input)),
  );
}

/** Hook の入力から失敗の情報を取る。案内の対象でない入力（中断・エラーの文が無い）は null。 */
export function failureOf(payload: Record<string, unknown>): Failure | null {
  if (payload.is_interrupt === true) return null;
  const { tool_name: toolName, error } = payload;
  if (!isNonEmptyString(toolName) || !isNonEmptyString(error)) return null;
  return { toolName, error, input: JSON.stringify(payload.tool_input ?? null) };
}

/** 直前の失敗を残すファイルのパス。session_id が使えない形なら null（繰り返しを判定しない）。 */
export function lastFailurePath(sessionId: unknown, dir: string = tmpdir()): string | null {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return null;
  return join(dir, `${HOOK}-${sessionId}.last`);
}

function digest(failure: Failure): string {
  return createHash("sha256")
    .update(`${failure.toolName}\0${failure.input}\0${failure.error}`)
    .digest("hex");
}

/**
 * 直前の失敗と同じかを返し、今回の失敗を残す。
 * 共有の一時ディレクトリに置くので、O_NOFOLLOW で開き、名前がシンボリックリンクなら辿らずに失敗させる。
 * ディレクトリなど読み書きできない名前のときも、繰り返しを判定せずに false を返す。
 * O_NOFOLLOW の無い OS（Windows）では、値が undefined になり、辿らない指定を付けずに開く。
 */
function repeatsLast(path: string | null, failure: Failure): boolean {
  if (!path) return false;
  let fd: number | undefined;
  try {
    const flags = constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
    fd = openSync(path, flags, 0o600);
    const previous = readFileSync(fd, "utf8");
    const current = digest(failure);
    ftruncateSync(fd, 0);
    writeSync(fd, current, 0);
    return previous === current;
  } catch (error) {
    console.error(
      `${HOOK}: 直前の失敗を読み書きできないので、繰り返しを判定しない（${path}）: ${errorMessage(error)}`,
    );
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** 渡す案内の文。案内が無ければ空文字。 */
function contextOf(matched: Guide[], repeated: boolean): string {
  const lines = matched.map((g) => `tool-error-guide（${g.id}）: ${g.guide} 規約: ${g.rule}`);
  if (repeated) lines.push(REPEAT_GUIDE);
  return lines.join("\n");
}

/** Hook として実行する。戻り値は終了コード（0: 案内を出した・出さなかった、1: 入力か一覧を読めない）。 */
export function main(
  input: string,
  guidesPath: string = GUIDES_PATH,
  stateDir: string = tmpdir(),
): number {
  const payload = parseHookInput(HOOK, input);
  if (typeof payload === "number") return payload;
  // Copilot の入力は形が違い、繰り返しの記録も Claude Code のセッションだけに使う（理由は stop-input.ts）。
  if (isCopilotClaudeSettingsPayload(payload)) return 0;
  const failure = failureOf(payload);
  if (!failure) return 0;
  let guides: Guide[];
  try {
    guides = parseGuides(readFileSync(guidesPath, "utf8"));
  } catch (error) {
    console.error(`${HOOK}: 一覧（${guidesPath}）を読めない: ${errorMessage(error)}`);
    return 1;
  }
  const repeated = repeatsLast(lastFailurePath(payload.session_id, stateDir), failure);
  const context = contextOf(matchGuides(guides, failure), repeated);
  if (context === "") return 0;
  const output = {
    hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: context },
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(main(readFileSync(0, "utf8")));
