// 応答の言語を確かめる Stop の Hook の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                                   |
// | -------------- | ------------------------------------------------------------------------------------ |
// | 入力           | 正常な Hook JSON / 不正な JSON / オブジェクトでない JSON                               |
// | 続けさせた後か | stop_hook_active が true / false / 欠落                                               |
// | 本文           | 欠落 / 文字列でない / 空白だけ / 英語 / 日本語 / 識別子の多い日本語 / 短い英語         |
// | 除外する部分   | コードブロック / インラインコード / URL / ハーネスのタグの塊（中が英語）                |
//
// 通す入力が止める入力と同じ数以上あることが要点である。止める入力だけのテストでは、「全部止める実装」と区別できない。
import { afterEach, expect, test, vi } from "vitest";
import { MIN_LATIN_LETTERS, REWRITE_REQUEST, judge, main } from "./response-language-check.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const hook = (fields: Record<string, unknown>) =>
  JSON.stringify({ hook_event_name: "Stop", session_id: "s", ...fields });

const ENGLISH =
  "I've applied the review fixes and the runner tests pass. The full mutation proof is now running in the background.";
const JAPANESE =
  "レビューの指摘を直し、ランナーのテストが通りました。ミューテーションテストの全件をバックグラウンドで実行しています。";

function run(input: string): { status: number; stderr: string } {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
  const status = main(input);
  return { status, stderr: errors.join("\n") };
}

// --- 誤検知しないことの確認（通す） ---

test.each([
  ["日本語の応答", JAPANESE],
  [
    "識別子とコマンドの多い日本語の応答",
    "`scripts/hooks/response-language-check.ts` を足し、`pnpm exec vitest run scripts/hooks/response-language-check.test.ts` と `node scripts/mutation/check-mutation-proof.ts` で通しました。",
  ],
  ["短い英語（判定の対象外）", "OK, done."],
  [
    "コードブロックだけの応答",
    "```bash\npnpm exec vitest run scripts/hooks/response-language-check.test.ts --reporter=verbose\n```",
  ],
  [
    "英語のコードブロックを含む日本語の応答",
    `次のコマンドで確かめました。\n\n\`\`\`text\n${ENGLISH}\n${ENGLISH}\n${ENGLISH}\n${ENGLISH}\n\`\`\`\n\n結果は上のとおりです。`,
  ],
  [
    "英語の URL を含む日本語の応答",
    "出典: https://code.claude.com/docs/en/hooks#stop-hook-input-fields-and-decision-control https://docs.github.com/en/rest/repos/repos#get-a-repository",
  ],
  [
    "後ろに英語の通知のタグの塊が付いた日本語の応答",
    `完了の通知を待っています。\n\n<system-reminder>\n${ENGLISH}\n</system-reminder>`,
  ],
  [
    "後ろに英語のタスク完了通知が付いた日本語の応答",
    `完了しました。\n\n<task-notification>\n${ENGLISH}\n</task-notification>`,
  ],
  [
    "リストの中で字下げした英語のコードブロックを含む日本語の応答",
    `- 次の出力で失敗しました。\n\n  \`\`\`text\n  ${ENGLISH}\n  ${ENGLISH}\n  \`\`\`\n`,
  ],
  [
    "開きより長い記号で閉じた英語のコードブロックを含む日本語の応答",
    `出力は次のとおりです。\n\n\`\`\`\n${ENGLISH}\n${ENGLISH}\n\`\`\`\`\n`,
  ],
  [
    "閉じていない英語のコードブロックで終わる日本語の応答",
    `出力は次のとおりです。\n\n\`\`\`\n${ENGLISH}\n${ENGLISH}`,
  ],
  [
    "英語のレビューコメントを引用した日本語の応答",
    `次の指摘に対応しました。\n\n> ${ENGLISH}\n> ${ENGLISH}\n`,
  ],
  [
    "漢字の多い表で英語の説明を並べた日本語の応答",
    "| 変更 | 対象 |\n| --- | --- |\n| 判定修正 | scanner script |\n| 試験追加 | hook test file |\n| 文書更新 | tooling docs and agents |\n| 設定追加 | stop hook settings |",
  ],
  [
    "空白で区切らずに URL の後ろへ日本語が続く応答",
    "詳細はhttps://code.claude.com/docs/en/hooks#stopを参照してください。Stop hook input fields and decision control are documented in detail.",
  ],
])("通す: %s", (_label, message) => {
  const res = run(hook({ stop_hook_active: false, last_assistant_message: message }));
  expect(res.status).toBe(0);
  expect(res.stderr).toBe("");
});

test.each([
  ["本文の欠落", {}],
  ["本文が文字列でない", { last_assistant_message: 42 }],
  ["本文が空白だけ", { last_assistant_message: " \n " }],
  [
    "stop_hook_active が true なら英語でも通す",
    { stop_hook_active: true, last_assistant_message: ENGLISH },
  ],
])("通す: %s", (_label, fields) => {
  expect(run(hook(fields)).status).toBe(0);
});

// --- 検出されることの確認（書き直させる） ---

test.each([
  [
    "英語の応答（stop_hook_active が false）",
    { stop_hook_active: false, last_assistant_message: ENGLISH },
  ],
  ["英語の応答（stop_hook_active が欠落）", { last_assistant_message: ENGLISH }],
  [
    "日本語の識別子を少し含む英語の応答",
    {
      last_assistant_message: `${ENGLISH} The note is \`.kaizen/学び.md\`, and the branch is ready.`,
    },
  ],
  ["ハーネスのものでないタグで囲んだ英語の応答", { last_assistant_message: `<p>${ENGLISH}</p>` }],
])("書き直させる: %s", (_label, fields) => {
  const res = run(hook(fields));
  expect(res.status).toBe(2);
  expect(res.stderr).toBe(REWRITE_REQUEST);
});

// --- 入力を読めない ---

test.each([
  ["不正な JSON", "{"],
  ["オブジェクトでない JSON", "[]"],
])("入力を読めなければ書き直させずにエラーにする: %s", (_label, input) => {
  const res = run(input);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/^response-language-check: /);
});

// --- 境界 ---

test("ラテン文字がしきい値ちょうどの英語は判定の対象に入る", () => {
  expect(judge("a".repeat(MIN_LATIN_LETTERS)).english).toBe(true);
  expect(judge("a".repeat(MIN_LATIN_LETTERS - 1)).english).toBe(false);
});

test("日本語の文字の割合がしきい値ちょうどなら日本語として通す", () => {
  // 日本語の文字 10 ÷（10 ＋ 90）＝ 0.1 は「0.1 未満」に当たらない。
  expect(judge(`${"あ".repeat(10)}${"a".repeat(90)}`).english).toBe(false);
  expect(judge(`${"あ".repeat(9)}${"a".repeat(91)}`).english).toBe(true);
});

test("ひらがな・カタカナ・漢字のどれも日本語の文字として数える", () => {
  expect(judge("あア亜").japanese).toBe(3);
  expect(judge(`${"ア".repeat(10)}${"a".repeat(90)}`).english).toBe(false);
  expect(judge(`${"亜".repeat(10)}${"a".repeat(90)}`).english).toBe(false);
});
