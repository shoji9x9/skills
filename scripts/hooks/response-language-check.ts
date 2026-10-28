// Stop の Hook。人への応答（最後のアシスタントのメッセージ）が日本語で書かれているかを確かめ、
// 英語で書かれていれば exit 2 で書き直させる（AGENTS.md「人への応答は日本語で書く」）。
//
// 指示を文書に書いても、英語のツール出力・通知・出力スタイルの指示が続いた後に応答が英語へ切り替わった（3 回再発）。
// 記憶に頼らず、応答を確定する前に決定論的に確かめる。
//
// 入力は Stop の Hook の JSON（https://code.claude.com/docs/en/hooks の Stop）。
// - `last_assistant_message` を読む。transcript は Stop の時点で最後のメッセージを含まないことがある。
// - `stop_hook_active` が true でも、この Hook が止めた印が無ければ（別の Stop の Hook が続けさせた後なら）確かめる。
//   印が在れば、書き直しても判定が変わらない応答で止め続けないように通す（scripts/hooks/stop-marker.ts）。
//
// 判定: 応答の言語に数えない部分（コードブロック・インラインコード・引用・URL・ハーネスのタグの塊）を除いた本文で、
// 日本語の文字（ひらがな・カタカナ・漢字）とラテン文字を数え、日本語の文字が極めて少ない応答を英語とみなす。
// ラテン文字が少ない応答（「OK」やコマンドだけ）は判定の対象から外す。
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { blankInlineCode, fencedLines } from "../lib/doc-scan.ts";
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import { alreadyBlocked, recordBlocked } from "./stop-marker.ts";
import { isCliEntry } from "../lib/cli/entry.ts";

const HOOK = "response-language-check";

/** ラテン文字がこれより少ない応答は、言語を判定しない（短い返事・識別子だけの応答）。 */
const MIN_LATIN_LETTERS = 40;
/** 日本語の文字 ÷（日本語の文字 ＋ ラテン文字）がこれ未満なら、英語の応答とみなす。 */
const MIN_JAPANESE_RATIO = 0.1;

/**
 * 応答の言語に数えない部分を除いた本文を返す。
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

export type Verdict = { english: boolean; japanese: number; latin: number };

export function judge(message: string): Verdict {
  const body = prose(message);
  const japanese = (body.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? [])
    .length;
  const latin = (body.match(/[A-Za-z]/g) ?? []).length;
  const english = latin >= MIN_LATIN_LETTERS && japanese / (japanese + latin) < MIN_JAPANESE_RATIO;
  return { english, japanese, latin };
}

export const REWRITE_REQUEST =
  "response-language-check: 人への応答が日本語ではありません（AGENTS.md「人への応答は日本語で書く」）。" +
  "同じ内容を日本語で書き直してください。コード・コマンド・識別子はそのままでかまいません。";

/** Hook として実行する。戻り値は終了コード（0: 通す、2: 書き直させる、1: 入力を読めない）。 */
export function main(input: string, markerDir: string = tmpdir()): number {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch (error) {
    // Stop で 2 を返すと書き直しを求めることになる。読めない入力では求めず、エラーとして見えるようにする。
    console.error(`response-language-check: 入力の JSON を読めない: ${errorMessage(error)}`);
    return 1;
  }
  if (!isRecord(payload)) {
    console.error("response-language-check: 入力がオブジェクトでない");
    return 1;
  }
  if (alreadyBlocked(HOOK, payload, markerDir)) return 0;
  const message = payload.last_assistant_message;
  // ツールの呼び出しだけで終わったターンなど、本文が無ければ判定しない。
  if (typeof message !== "string" || message.trim() === "") return 0;
  if (!judge(message).english) return 0;
  console.error(REWRITE_REQUEST);
  recordBlocked(HOOK, payload, markerDir);
  return 2;
}

if (isCliEntry(import.meta.url)) process.exit(main(readFileSync(0, "utf8")));
