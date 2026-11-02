// 応答を書き直させる Stop の Hook（response-language-check・response-word-check）が共有する、入力の読み方。
// 入力を JSON として読み、確かめる応答の本文を返す。確かめずに終えるときは、返す終了コードを返す。
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import { alreadyBlocked } from "./stop-marker.ts";

/**
 * GitHub Copilot CLI が、Claude Code 用の登録（`.claude/settings.json`）として Hook を呼んだかを判定する。
 * Copilot は `.claude/settings.json` の Hook も実行する。出典は https://docs.github.com/en/copilot/reference/hooks-configuration である。
 * このリポジトリの方式では、`.claude/settings.json` に登録した Hook は Copilot から呼ばれたら何もせずに exit 0 で終える。
 * 方式と条件の理由は、multiagent-setup の references/hooks.md「Copilot は Claude Code の設定ファイルの Hook も実行する」にある。
 *
 * 次の 3 つがすべて成り立つときだけ true を返す。
 * - 環境変数 COPILOT_CLI が空でない（Copilot CLI 1.0.105 が Hook に COPILOT_CLI=1 を渡すことを実測した）
 * - 入力の最上位に `timestamp` がある（Copilot は入れ、Claude Code は入れない。https://code.claude.com/docs/en/hooks）
 * - 入力の最上位に `hook_event_name` がある。Copilot は PascalCase のイベント名で書いた登録にだけ入れ、
 *   camelCase の `.github/hooks/` の登録には入れない（https://docs.github.com/en/copilot/reference/hooks-reference。1.0.105 で確かめた）
 * Copilot のシェルから起動した Claude Code は COPILOT_CLI を引き継ぎうるが、その入力には `timestamp` が無いので false になる。
 */
function isCopilotClaudeSettingsPayload(payload: Record<string, unknown>): boolean {
  return Boolean(process.env.COPILOT_CLI) && "timestamp" in payload && "hook_event_name" in payload;
}

export type StopResponse = { payload: Record<string, unknown>; message: string };

/**
 * Stop の入力から、確かめる応答を返す。確かめずに終えるときは終了コードを返す。
 * - 入力を読めないときは 1。Stop で 2 を返すと書き直しを求めることになるので、読めない入力では求めず、エラーとして見えるようにする
 * - Copilot から呼ばれたときは 0。Copilot の Stop の入力には応答の本文が無く、印も Claude Code のセッションだけに使う
 * - この一続きで既に自分が止めた後は 0（理由は stop-marker.ts）
 * - ツールの呼び出しだけで終わったターンなど、本文が無ければ 0
 */
export function stopResponse(
  hook: string,
  input: string,
  markerDir: string,
): StopResponse | number {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch (error) {
    console.error(`${hook}: 入力の JSON を読めない: ${errorMessage(error)}`);
    return 1;
  }
  if (!isRecord(payload)) {
    console.error(`${hook}: 入力がオブジェクトでない`);
    return 1;
  }
  if (isCopilotClaudeSettingsPayload(payload)) return 0;
  if (alreadyBlocked(hook, payload, markerDir)) return 0;
  const message = payload.last_assistant_message;
  if (typeof message !== "string" || message.trim() === "") return 0;
  return { payload, message };
}
