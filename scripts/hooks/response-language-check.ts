// 人への応答が日本語で書かれているかを確かめる Hook（AGENTS.md「人への応答は日本語で書く」）。
// Claude Code の Stop と、デスクトップアプリの「次の一手」の箱を出すツール（wrap_up）の PreToolUse から呼ばれる。
//
// 指示を文書に書いても、英語のツール出力・通知・出力スタイルの指示が続いた後に応答が英語へ切り替わった（3 回再発）。
// 記憶に頼らず、応答を確定する前に決定論的に確かめる。
//
// 入力は Hook の JSON（https://code.claude.com/docs/en/hooks の Stop と PreToolUse）。
// Stop では次の 2 つを確かめ、英語の箇所があれば exit 2 で、その箇所だけを書き直させる。
// - 最後の本文: `last_assistant_message` を読む。transcript は Stop の時点で最後のメッセージを含まないことがある。
// - そのターンの途中報告: transcript（`transcript_path`）の、人が入力した最後の発言より後の assistant の本文。
//   ツールの呼び出しが続いた text ブロックと、`thinkingDisplay` が `updates` の thinking ブロック（画面に途中報告として出る）を見る。
//   1 行の前置きは画面に小さく出るだけなので見ず、複数行か長い段落だけを見る。
// `stop_hook_active` が true でも、この Hook が止めた印が無ければ（別の Stop の Hook が続けさせた後なら）確かめる。
// 印が在れば、書き直しても判定が変わらない応答で止め続けないように通す（scripts/hooks/stop-marker.ts）。
// PreToolUse では、wrap_up の入力の文字列が英語なら exit 2 でツールの呼び出しを止め、日本語で呼び直させる。箱が画面に出る前に止められる。
//
// 判定: 応答の言語に数えない部分（コードブロック・インラインコード・引用・URL・Markdown のリンク・ハーネスのタグの塊）を除いた本文で、
// 日本語の文字（ひらがな・カタカナ・漢字）とラテン文字を数え、ラテン文字が日本語の文字の決まった倍数を超える本文を英語とみなす。
// ラテン文字が少ない本文（「OK」やコマンドだけ）は判定の対象から外す。しきい値は過去の transcript で測って決めた（Issue #1121）。
// JSON の値だけの最後の本文はスクリプトが読む出力なので確かめない。書き直させると説明の文が入り、JSON として読めなくなる。
// 環境変数 RESPONSE_LANGUAGE_CHECK_DISABLE が 1 のときは何もしない（`claude -p` で人が読まない出力を作る呼び出し向け）。
//
// 途中報告と wrap_up の扱いは、minorun365/claude-code-japanese-guard（Apache-2.0）の考え方を取り入れた。コードは持ち込んでいない。
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { blankInlineCode, fencedLines } from "../lib/doc-scan.ts";
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { recordBlocked } from "./stop-marker.ts";
import { isCopilotClaudeSettingsPayload, parseHookInput, stopResponseOf } from "./stop-input.ts";
import { isCliEntry } from "../lib/cli/entry.ts";

const HOOK = "response-language-check";
export const DISABLE_ENV = "RESPONSE_LANGUAGE_CHECK_DISABLE";

/** ラテン文字が minLatin 以上あり、日本語の文字の ratio 倍を超えるときに英語とみなす。 */
export type Threshold = { minLatin: number; ratio: number };

/** 最後の本文と wrap_up の箱のしきい値。 */
const FINAL: Threshold = { minLatin: 25, ratio: 5 };
/** 複数行の途中報告のしきい値。 */
const REPORT_MULTILINE: Threshold = { minLatin: 60, ratio: 5 };
/** 1 行の途中報告のしきい値。これに届かない 1 行は前置きとして見ない。 */
const REPORT_ONE_LINE: Threshold = { minLatin: 250, ratio: 5 };

/**
 * 応答の言語に数えない部分を除いた本文を返す（response-word-check も使う）。
 * - コードブロックは、Markdown の解析の部品（字下げ・長い閉じ記号・閉じていないブロックを扱う）で外す。
 * - 引用（`>` で始まる行）は、英語のレビューコメントなどを貼っただけで応答の言語ではない。
 * - ハーネスが本文の後ろに付けるタグの塊は、過去の transcript の実測で、日本語の応答を英語と判定させた。
 *   外すのは実測で見たタグ（HARNESS_TAGS）だけにする。任意のタグを外すと、`<p>...</p>` のような英語の本文まで消えて通ってしまう。
 * - URL は ASCII の範囲だけを外す。空白で区切らない日本語の続きまで消さないためである。
 */
const HARNESS_TAGS = ["system-reminder", "task-notification"];
const HARNESS_BLOCK = new RegExp(`<(${HARNESS_TAGS.join("|")})>[\\s\\S]*?<\\/\\1>`, "g");

export function prose(message: string): string {
  const lines = message.replace(HARNESS_BLOCK, " ").split("\n");
  const fenced = fencedLines(lines);
  return lines
    .filter((line, i) => !fenced[i] && !/^\s*>/.test(line))
    .map((line) => blankInlineCode(line).replace(/https?:\/\/[\x21-\x7E]+/g, " "))
    .join("\n");
}

/**
 * 言語の判定に数える本文。prose に加えて、Markdown のインラインリンク（`[文字](URL)`）を丸ごと外す。
 * リンクの文字は Issue や PR の題を英語のまま貼ったものが多く、応答の言語ではない。
 * prose は response-word-check も使うので、リンクは prose では外さない（使わない語はリンクの文字でも確かめる）。
 */
const MARKDOWN_LINK = /\[[^\]\n]*\]\([^)\s]*\)/g;

function languageBody(message: string): string {
  // prose が URL を外すと `](URL)` の形が残らないので、リンクは prose より先に外す。
  return prose(message.replace(MARKDOWN_LINK, " "));
}

export type Verdict = { english: boolean; japanese: number; latin: number };

export function judge(message: string, threshold: Threshold = FINAL): Verdict {
  const body = languageBody(message);
  const japanese = (body.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? [])
    .length;
  const latin = (body.match(/[A-Za-z]/g) ?? []).length;
  const english = latin >= threshold.minLatin && latin > japanese * threshold.ratio;
  return { english, japanese, latin };
}

/** 途中報告が英語か。言語に数える本文が 2 行以上なら複数行の、1 行なら 1 行のしきい値で判定する。 */
function isEnglishReport(text: string): boolean {
  const lines = languageBody(text)
    .split("\n")
    .filter((line) => line.trim() !== "");
  return judge(text, lines.length >= 2 ? REPORT_MULTILINE : REPORT_ONE_LINE).english;
}

/** 応答が JSON の値だけか（前後の ```json のフェンスは許す）。配列とオブジェクトだけを数える。 */
function isJsonOnly(message: string): boolean {
  const body = message
    .trim()
    .replace(/^```(?:json)?[ \t]*\n/, "")
    .replace(/\n```$/, "")
    .trim();
  if (!body.startsWith("{") && !body.startsWith("[")) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

export type Passage = { kind: "report" | "final"; text: string };

/**
 * transcript の行のうち、人が入力した発言か。
 * ツールの結果と Hook のフィードバック（isMeta）も type が user のエントリになるので、境界にしない。
 * バックグラウンドの処理の完了の通知（task-notification）は新しいターンを始め、前のターンの本文はその前の Stop で確かめたので、境界にする。
 * サブエージェントへの指示（isSidechain）も、人の発言ではないので境界にしない。
 * ターンの途中の自動の compact が書く要約（isCompactSummary）も、人の発言ではないので境界にしない。
 */
function isHumanTurn(entry: Record<string, unknown>): boolean {
  if (
    entry.type !== "user" ||
    entry.isMeta === true ||
    entry.isSidechain === true ||
    entry.isCompactSummary === true
  )
    return false;
  const message = entry.message;
  if (!isRecord(message)) return false;
  const content = message.content;
  if (typeof content === "string") return true;
  return (
    isArray(content) && !content.some((block) => isRecord(block) && block.type === "tool_result")
  );
}

function parseEntries(transcript: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of transcript.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isRecord(entry)) entries.push(entry);
    } catch {
      // 書き込みの途中の行などは読まない（その行の本文は判定しない）。
    }
  }
  return entries;
}

/**
 * transcript（JSON Lines）から、最後のターンの本文を順に返す。
 * ツールの呼び出しが続いた text ブロックと、thinkingDisplay が updates の中身のある thinking ブロックは途中報告（report）、
 * 最後のツールの呼び出しより後の text ブロックは最後の本文（final）にする。
 * サブエージェントの行（isSidechain）と、ハーネスが書いた API のエラーの行（isApiErrorMessage）は読まない。
 */
/** 最後のターンで読む assistant の行の content。サブエージェントの行と API のエラーの行は読まない。 */
function assistantContent(entry: Record<string, unknown>): unknown[] {
  // isApiErrorMessage は、ハーネスが API のエラー（利用上限など）を英語の定型文で書いた行で、応答ではない。
  if (entry.type !== "assistant" || entry.isSidechain === true || entry.isApiErrorMessage === true)
    return [];
  const message = entry.message;
  const content = isRecord(message) ? message.content : undefined;
  return isArray(content) ? content : [];
}

/** thinkingDisplay が updates の行の、中身のある thinking ブロックの本文。それ以外は null。 */
function shownThinking(
  entry: Record<string, unknown>,
  block: Record<string, unknown>,
): string | null {
  if (block.type !== "thinking" || entry.thinkingDisplay !== "updates") return null;
  return typeof block.thinking === "string" && block.thinking.trim() !== "" ? block.thinking : null;
}

function turnPassages(transcript: string): Passage[] {
  const entries = parseEntries(transcript);
  const start = entries.findLastIndex((entry) => isHumanTurn(entry)) + 1;
  const passages: Passage[] = [];
  let pending: string[] = [];
  for (const entry of entries.slice(start)) {
    for (const block of assistantContent(entry)) {
      if (!isRecord(block)) continue;
      const thought = shownThinking(entry, block);
      if (block.type === "tool_use") {
        passages.push(...pending.map((text) => ({ kind: "report" as const, text })));
        pending = [];
      } else if (block.type === "text" && typeof block.text === "string") {
        pending.push(block.text);
      } else if (thought !== null) {
        passages.push({ kind: "report", text: thought });
      }
    }
  }
  passages.push(...pending.map((text) => ({ kind: "final" as const, text })));
  return passages;
}

/** 書き直しの頼みに引用する、本文の最初の英語の行（80 字まで）。英語の行が無ければ最初の行を引用する。 */
export function headLine(text: string): string {
  const lines = text.replace(HARNESS_BLOCK, " ").split("\n");
  const fenced = fencedLines(lines);
  // コードブロック・引用・空の行は引用しない。英語の行（ラテン文字が日本語の文字より多い行）があれば、その最初の行を引用する。
  const candidates = lines
    .filter((l, i) => !fenced[i] && !/^\s*>/.test(l))
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const line =
    candidates.find((l) => judge(l, { minLatin: 1, ratio: 1 }).english) ?? candidates[0] ?? "";
  const chars = Array.from(line);
  return chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : line;
}

const MAX_QUOTES = 5;

export function rewriteRequest(hits: Passage[]): string {
  const quotes = hits
    .slice(0, MAX_QUOTES)
    .map((hit) => `- ${hit.kind === "report" ? "（途中の報告）" : ""}${headLine(hit.text)}`);
  if (hits.length > MAX_QUOTES) quotes.push(`- ほか ${hits.length - MAX_QUOTES} 件`);
  return [
    "response-language-check: 人への応答に、日本語で書いていない箇所があります（AGENTS.md「人への応答は日本語で書く」）。",
    ...quotes,
    "上に挙げた箇所だけを日本語で書き直してください。日本語で書けていた部分は利用者に届いているので、再掲しないでください。" +
      "言い訳や原因の説明は書かないでください。コード・コマンド・識別子はそのままでかまいません。",
  ].join("\n");
}

export const WRAP_UP_REQUEST =
  "response-language-check: 次の一手の箱（wrap_up）の文言が日本語ではありません（AGENTS.md「人への応答は日本語で書く」）。" +
  "箱に出る文言をすべて日本語で書き直して、もう一度呼んでください。コード・コマンド・識別子はそのままでかまいません。";

/** デスクトップアプリの「次の一手」の箱を出すツールか。MCP のツールなので、名前は mcp__<サーバ>__wrap_up になる。 */
function isWrapUp(toolName: unknown): boolean {
  return typeof toolName === "string" && /^mcp__.+__wrap_up$/.test(toolName);
}

/**
 * wrap_up の入力から、箱に出る文字列を集める。入力の形は公開の文書が無く、手元の transcript にも呼び出しが無かったので、
 * 欄の名前に頼らず、すべての文字列の値を集める。JSON の文字列で渡された配列やオブジェクトも開いて読む。
 */
function wrapUpText(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return wrapUpText(JSON.parse(trimmed), depth + 1);
      } catch {
        // JSON でなければ、そのまま文言として読む。
      }
    }
    return [value];
  }
  if (isArray(value)) return value.flatMap((item) => wrapUpText(item, depth + 1));
  if (isRecord(value)) return Object.values(value).flatMap((item) => wrapUpText(item, depth + 1));
  return [];
}

function checkWrapUp(payload: Record<string, unknown>): number {
  if (!isWrapUp(payload.tool_name)) return 0;
  // 文字列ごとに判定する。まとめて数えると、日本語の recap の字数で英語のボタンの文言が通ってしまう。
  if (!wrapUpText(payload.tool_input).some((text) => judge(text).english)) return 0;
  console.error(WRAP_UP_REQUEST);
  return 2;
}

/** transcript から、最後の本文（last_assistant_message）より前の本文を読む。読めなければ空にし、そのことを stderr に出す。 */
function earlierPassages(transcriptPath: unknown, message: string): Passage[] {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return [];
  let transcript: string;
  try {
    transcript = readFileSync(transcriptPath, "utf8");
  } catch (error) {
    console.error(
      `${HOOK}: transcript を読めないので、途中報告を確かめていない: ${errorMessage(error)}`,
    );
    return [];
  }
  // 最後の本文が transcript に書き込まれていれば、last_assistant_message と同じものを 2 回数えない。
  return turnPassages(transcript).filter(
    (p) => !(p.kind === "final" && p.text.trim() === message.trim()),
  );
}

function checkStop(payload: Record<string, unknown>, markerDir: string): number {
  // Copilot から呼ばれた・既に止めた・本文が無いときは、確かめずに終える（stop-input.ts）。
  const response = stopResponseOf(HOOK, payload, markerDir);
  if (typeof response === "number") return response;
  const { message } = response;
  // JSON の値だけの最後の本文は確かめない。途中報告は人が読んでいるので確かめる。
  const passages = [
    ...earlierPassages(payload.transcript_path, message),
    ...(isJsonOnly(message) ? [] : [{ kind: "final" as const, text: message }]),
  ];
  const hits = passages.filter((p) =>
    p.kind === "report" ? isEnglishReport(p.text) : judge(p.text).english,
  );
  if (hits.length === 0) return 0;
  console.error(rewriteRequest(hits));
  recordBlocked(HOOK, payload, markerDir);
  return 2;
}

/** Hook として実行する。戻り値は終了コード（0: 通す、2: 書き直させる、1: 入力を読めない）。 */
export function main(input: string, markerDir: string = tmpdir()): number {
  if (process.env[DISABLE_ENV] === "1") return 0;
  const payload = parseHookInput(HOOK, input);
  if (typeof payload === "number") return payload;
  if (payload.hook_event_name === "PreToolUse") {
    // Copilot の呼び出しでは何もしない（stop-input.ts の isCopilotClaudeSettingsPayload）。
    return isCopilotClaudeSettingsPayload(payload) ? 0 : checkWrapUp(payload);
  }
  return checkStop(payload, markerDir);
}

if (isCliEntry(import.meta.url)) process.exit(main(readFileSync(0, "utf8")));
