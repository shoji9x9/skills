// Stop の Hook。人への応答（最後のアシスタントのメッセージ）に、使わない語（`.textlint/words.json`）が含まれていないかを確かめ、
// 含まれていれば exit 2 で書き直させる（docs/writing-style.md の対象「エージェントが人へ返す応答」）。
//
// 応答はファイルではないので、pre-commit と CI の textlint（scripts/gates/prose/lint-prose.ts）が届かない。
// 一覧は AGENTS.md から `@` で取り込んでいるが、読み込むだけでは従ったかを確かめられない。応答を確定する前に、決定論的に確かめる。
//
// 判定は textlint の no-ai-words の規則（.textlintrc.json の設定と同じ辞書）に任せ、語の照合を自前で書かない。
// 辞書は形態素で照合するので、文字列の一致で近似すると、同じ字面を含む別の語まで止めてしまう。
// 同じ設定の他の規則（「である」調・文の長さなど）は文書の規約なので、応答には当てない。
// 応答の本文の取り出し（コードブロック・インラインコード・引用・URL・ハーネスのタグの塊を外す）は、
// response-language-check.ts と同じ関数を使う。語そのものを説明するときは、インラインコードで書けば止めない。
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLinter, loadTextlintrc } from "textlint";
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import { wordRules } from "../lib/textlint-word-rule.ts";
import { prose } from "./response-language-check.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 応答の本文から、使わない語の指摘（辞書の message）を返す。 */
export async function findWords(message: string, root: string = REPO_ROOT): Promise<string[]> {
  const body = prose(message);
  if (body.trim() === "") return [];
  const loaded = await loadTextlintrc({ configFilePath: join(root, ".textlintrc.json") });
  // 設定が無い・規則が外れていると、textlint は規則なしで成功し、どの応答も通してしまう。wordRules がそれを例外にする。
  const rules = wordRules(loaded);
  // 他の規則は実行しない（応答ごとに文書の規約の規則まで動かさない）。
  // filter の規則も外す。応答に `<!-- textlint-disable -->` を書くだけで確かめずに通すことを防ぐ。
  const descriptor = loaded.shallowMerge({ rules, filterRules: [] });
  const linter = createLinter({ descriptor, cwd: root });
  const result = await linter.lintText(body, join(root, "response.md"));
  return result.messages.map((m) => m.message);
}

export const REWRITE_REQUEST =
  "response-word-check: 人への応答に、使わない語（.textlint/word-list.md）が含まれています。" +
  "次の指摘に従って、同じ内容を言い換えて書き直してください。" +
  "語そのものを説明するときは、インラインコードで囲めば対象から外れます。";

/** Hook として実行する。戻り値は終了コード（0: 通す、2: 書き直させる、1: 入力を読めない・判定できない）。 */
export async function main(input: string, root: string = REPO_ROOT): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch (error) {
    // Stop で 2 を返すと書き直しを求めることになる。読めない入力では求めず、エラーとして見えるようにする。
    console.error(`response-word-check: 入力の JSON を読めない: ${errorMessage(error)}`);
    return 1;
  }
  if (!isRecord(payload)) {
    console.error("response-word-check: 入力がオブジェクトでない");
    return 1;
  }
  // 既に Stop の Hook で続けさせた後なら通す。書き直しても判定が変わらない応答で、止め続けないためである。
  if (payload.stop_hook_active === true) return 0;
  const message = payload.last_assistant_message;
  if (typeof message !== "string" || message.trim() === "") return 0;
  let findings: string[];
  try {
    findings = await findWords(message, root);
  } catch (error) {
    // textlint を読み込めないときは、書き直しを求めずに、確かめていないことを見えるようにする。
    console.error(`response-word-check: textlint で判定できない: ${errorMessage(error)}`);
    return 1;
  }
  if (findings.length === 0) return 0;
  console.error([REWRITE_REQUEST, ...findings.map((f) => `- ${f}`)].join("\n"));
  return 2;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`response-word-check: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(await main(readFileSync(0, "utf8")));
