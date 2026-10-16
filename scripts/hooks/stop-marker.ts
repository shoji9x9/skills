// Stop の Hook が「この一続きで自分が止めた」ことを残す印。応答を書き直させる Hook（response-language-check・response-word-check）が共有する。
//
// Stop の Hook の入力の `stop_hook_active` は、どれかの Stop の Hook が続けさせた後なら true になる。
// どの Hook が続けさせたかは書かれていないので、true で一律に通すと、別の Hook が書き直させた応答をこの Hook が一度も確かめない。
// 一方で、自分が止めた後も確かめ続けると、書き直しても判定が変わらない応答で止め続ける。
// そこで、止めたときに session ごとの印を一時ディレクトリに置き、true のときは自分の印が在るときだけ通す。
// 印は 0 バイトのファイルで、一続きの最後を Hook から知る方法が無いので、次の一続きの最初の Stop で消す。
import { lstatSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../lib/errors.ts";

/** Hook が止めたことを残す印のパス。session_id が使えない形なら null（続けさせた後の応答は確かめずに通す）。 */
export function blockedMarker(
  hook: string,
  sessionId: unknown,
  dir: string = tmpdir(),
): string | null {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return null;
  return join(dir, `${hook}-${sessionId}.blocked`);
}

/**
 * 判定する前に呼ぶ。この一続きで既に自分が止めた（か、印を置けない）なら true を返し、呼び出し側は確かめずに通す。
 * 新しい一続きの最初の Stop（stop_hook_active が true でない）なら、前の一続きの印を消して false を返す。
 */
export function alreadyBlocked(
  hook: string,
  payload: Record<string, unknown>,
  dir: string = tmpdir(),
): boolean {
  const marker = blockedMarker(hook, payload.session_id, dir);
  if (payload.stop_hook_active !== true) {
    // 消せなくても判定は続ける（印が残ると、この一続きで続けさせた後の応答を確かめずに通すだけである）。
    try {
      if (marker) rmSync(marker, { force: true });
    } catch (error) {
      console.error(`${hook}: 前の印を消せない: ${errorMessage(error)}`);
    }
    return false;
  }
  // existsSync はシンボリックリンクを辿るので、リンク先の無いリンクを「無い」と判定する。印の名前に何か在れば在るとみなす。
  return !marker || lstatSync(marker, { throwIfNoEntry: false }) !== undefined;
}

/** 書き直させるときに呼び、止めた印を残す。残せなくても例外にしない（次の Stop で同じ判定ならもう一度止める）。 */
export function recordBlocked(
  hook: string,
  payload: Record<string, unknown>,
  dir: string = tmpdir(),
): void {
  const marker = blockedMarker(hook, payload.session_id, dir);
  try {
    // 共有の tmpdir に置くので、同じ名前のシンボリックリンクやファイルが先に在れば書かない（wx は辿らずに失敗する）。
    if (marker) writeFileSync(marker, "", { flag: "wx" });
  } catch (error) {
    console.error(`${hook}: 止めた印を残せない: ${errorMessage(error)}`);
  }
}
