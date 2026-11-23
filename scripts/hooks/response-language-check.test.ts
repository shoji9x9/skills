// 応答の言語を確かめる Stop の Hook の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                                   |
// | -------------- | ------------------------------------------------------------------------------------ |
// | 入力           | 正常な Hook JSON / 不正な JSON / オブジェクトでない JSON                               |
// | 続けさせた後か | stop_hook_active が true / false / 欠落                                               |
// | 止めた印       | 無い（別の Hook が続けさせた後）/ 在る（この Hook が止めた後）                          |
// | 本文           | 欠落 / 文字列でない / 空白だけ / 英語 / 日本語 / 識別子の多い日本語 / 短い英語         |
// | 除外する部分   | コードブロック / インラインコード / URL / ハーネスのタグの塊（中が英語）/ Markdown のリンク |
// | 応答の形       | 文章 / JSON の値だけ（フェンスあり・なし）/ JSON に見えて読めない / JSON の後に文章        |
// | 無効にする変数 | 未設定 / 1 / 1 以外の値                                                               |
// | transcript     | 無い / 読めない / 不正な行を含む / 前のターンの本文 / 途中報告（text・thinking）/ 最後の本文 |
// | 途中報告の形   | 1 行の前置き / 1 行の長い段落 / 複数行 / thinkingDisplay が updates でない / サブエージェント・API のエラー |
// | イベント       | Stop / PreToolUse（wrap_up の名前・それ以外のツール・入力の形）                         |
//
// 通す入力が止める入力と同じ数以上あることが要点である。止める入力だけのテストでは、「全部止める実装」と区別できない。
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { blockedMarker } from "./stop-marker.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import {
  DISABLE_ENV,
  WRAP_UP_REQUEST,
  headLine,
  judge,
  main,
  prose,
  rewriteRequest,
} from "./response-language-check.ts";

// 止めた印は、テストごとの一時ディレクトリに置く（OS の一時ディレクトリの実物に触らない）。
let markerDir = "";
beforeEach(() => {
  markerDir = makeTempDir("response-language-check-marker-");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(markerDir, { recursive: true, force: true });
});

const hook = (fields: Record<string, unknown>) =>
  JSON.stringify({ hook_event_name: "Stop", session_id: "s", ...fields });

const ENGLISH =
  "I've applied the review fixes and the runner tests pass. The full mutation proof is now running in the background.";
const JAPANESE =
  "レビューの指摘を直し、ランナーのテストが通りました。ミューテーションテストの全件をバックグラウンドで実行しています。";

// COPILOT_CLI はテストごとに決める。テストを実行するシェル（Copilot の中など）の値を引き継がない。
function run(input: string, copilotCli = ""): { status: number; stderr: string } {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
  vi.stubEnv("COPILOT_CLI", copilotCli);
  vi.stubEnv(DISABLE_ENV, "");
  const status = main(input, markerDir);
  return { status, stderr: errors.join("\n") };
}

// --- Copilot が .claude/settings.json の登録として呼んだとき（Issue #858） ---
//
// Copilot CLI は `.claude/settings.json` の Stop も応答のたびに実行する。その呼び出しでは、判定もせず、印も消さずに通す。
// Copilot CLI 1.0.105 の Stop の入力には last_assistant_message が無いが、判定によって通したことを区別するため、英語の本文を入れる。
// 入力の形は記録したものに合わせる。PascalCase の登録だけが hook_event_name を持ち、timestamp は文字列になる。
const COPILOT_TIMESTAMP = "2026-11-02T11:47:43.154Z";

test("通す: Copilot の .claude/settings.json の登録なら、英語でも判定せず、前の印も消さない", () => {
  const marker = blockedMarker("response-language-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  writeFileSync(marker, "");
  const input = hook({ timestamp: COPILOT_TIMESTAMP, last_assistant_message: ENGLISH });
  expect(run(input, "1")).toEqual({ status: 0, stderr: "" });
  expect(existsSync(marker)).toBe(true);
});

test.each([
  [
    "COPILOT_CLI が空（Claude Code が呼んだ）",
    hook({ timestamp: COPILOT_TIMESTAMP, last_assistant_message: ENGLISH }),
    "",
  ],
  [
    "timestamp が無い（Copilot のシェルから起動した Claude Code）",
    hook({ last_assistant_message: ENGLISH }),
    "1",
  ],
  [
    "hook_event_name が無い（camelCase の .github/hooks の登録の形）",
    JSON.stringify({ sessionId: "s", timestamp: 1793620063154, last_assistant_message: ENGLISH }),
    "1",
  ],
])("書き直させる: %s なら、英語の応答を確かめる", (_label, input, copilotCli) => {
  expect(run(input, copilotCli).status).toBe(2);
});

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
    "詳細はhttps://code.claude.com/docs/en/hooks#stopを参照してください。Stop hook input fields are documented.",
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
])("通す: %s", (_label, fields) => {
  expect(run(hook(fields)).status).toBe(0);
});

test("通す: この Hook が止めた後（stop_hook_active が true で印が在る）は、英語でも通す", () => {
  const marker = blockedMarker("response-language-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  writeFileSync(marker, "");
  expect(run(hook({ stop_hook_active: true, last_assistant_message: ENGLISH })).status).toBe(0);
});

test("書き直させる: 別の Hook が続けさせた後（stop_hook_active が true で印が無い）の英語の応答も確かめ、印を残す", () => {
  const res = run(hook({ stop_hook_active: true, last_assistant_message: ENGLISH }));
  expect(res.status).toBe(2);
  expect(res.stderr).toBe(rewriteRequest([{ kind: "final", text: ENGLISH }]));
  expect(existsSync(blockedMarker("response-language-check", "s", markerDir) ?? "")).toBe(true);
});

test("通す: 新しい一続きの最初の Stop は、前の一続きの印を消す", () => {
  const marker = blockedMarker("response-language-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  writeFileSync(marker, "");
  expect(run(hook({ stop_hook_active: false, last_assistant_message: JAPANESE })).status).toBe(0);
  expect(existsSync(marker)).toBe(false);
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
  expect(res.stderr).toBe(rewriteRequest([{ kind: "final", text: fields.last_assistant_message }]));
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

// しきい値は docs/tooling.md の取り決め（ラテン文字が 25 字以上あり、日本語の文字の 5 倍を超えると書き直させる）から決める。
// judge の english は、Hook が書き直させる（exit 2）か通す（exit 0）かの判定と同じ意味を持つ。
const status = (message: string) => run(hook({ last_assistant_message: message })).status;

test("ラテン文字がしきい値ちょうどの英語は判定の対象に入る", () => {
  expect(judge("a".repeat(25)).english).toBe(true);
  expect(judge("a".repeat(24)).english).toBe(false);
});

test("ラテン文字が日本語の文字のちょうど 5 倍なら日本語として通す", () => {
  // 50 は 10 の 5 倍を「超える」に当たらない。
  expect(judge(`${"あ".repeat(10)}${"a".repeat(50)}`).english).toBe(false);
  expect(judge(`${"あ".repeat(10)}${"a".repeat(51)}`).english).toBe(true);
});

test("ひらがな・カタカナ・漢字のどれも日本語の文字として数える", () => {
  expect(status(`${"ア".repeat(10)}${"a".repeat(50)}`)).toBe(0);
  expect(status(`${"亜".repeat(10)}${"a".repeat(50)}`)).toBe(0);
  expect(status(`${"ア".repeat(10)}${"a".repeat(51)}`)).toBe(2);
});

// --- 書き直しの頼み（Issue #1121） ---

test("書き直させる: 頼みに英語の箇所の最初の行を引用し、日本語で書けた部分の再掲と言い訳を求めない", () => {
  const res = run(hook({ last_assistant_message: `${ENGLISH}\n\n${ENGLISH}` }));
  expect(res.status).toBe(2);
  expect(res.stderr).toContain(`\n- ${ENGLISH}`.slice(0, 83));
  expect(res.stderr).toContain("上に挙げた箇所だけを日本語で書き直してください");
  expect(res.stderr).toContain("再掲しないでください");
  expect(res.stderr).toContain("言い訳や原因の説明は書かないでください");
});

test("引用は最初の空でない行を 80 字までにし、ハーネスのタグの塊を外す", () => {
  expect(headLine(`\n\n  short line  \nnext`)).toBe("short line");
  expect(headLine("a".repeat(81))).toBe(`${"a".repeat(80)}…`);
  expect(headLine("a".repeat(80))).toBe("a".repeat(80));
  expect(headLine("<system-reminder>\nnotice\n</system-reminder>\nbody")).toBe("body");
});

test.each([
  ["1 行目が日本語の見出し", `## 結果\n\n${ENGLISH}`, ENGLISH.slice(0, 40)],
  ["1 行目がコードブロック", `\`\`\`text\nlog line\n\`\`\`\n${ENGLISH}`, ENGLISH.slice(0, 40)],
  ["1 行目が引用", `> quoted review text\n${ENGLISH}`, ENGLISH.slice(0, 40)],
  ["英語の行が無い", "## 結果\n\n日本語の本文", "## 結果"],
])("引用は英語の行を選ぶ: %s", (_label, input, expected) => {
  expect(headLine(input)).toContain(expected);
});

test("引用は 5 件までにし、残りは件数で書く", () => {
  const hits = Array.from({ length: 7 }, (_, i) => ({
    kind: "report" as const,
    text: `item ${i}`,
  }));
  const request = rewriteRequest(hits);
  expect(request).toContain("- （途中の報告）item 4");
  expect(request).not.toContain("item 5");
  expect(request).toContain("- ほか 2 件");
});

// --- 途中報告（transcript）---

const MULTILINE_REPORT = `${ENGLISH}\n${ENGLISH}`;
const ONE_LINE_PREFACE = "Checking the current state of the branch before pushing.";
const LONG_ONE_LINE = `${ENGLISH} ${ENGLISH} ${ENGLISH}`;

const human = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { role: "assistant", content },
  ...extra,
});
const text = (t: string) => ({ type: "text", text: t });
const toolUse = { type: "tool_use", id: "t1", name: "Bash", input: { command: "git status" } };
const toolResult = {
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
};
const thinking = (t: string) => ({ type: "thinking", thinking: t, signature: "x" });

function transcript(entries: unknown[], raw: string[] = []): string {
  const path = `${markerDir}/transcript.jsonl`;
  writeFileSync(path, [...entries.map((e) => JSON.stringify(e)), ...raw].join("\n"));
  return path;
}

const stop = (path: string, message = JAPANESE) =>
  run(hook({ transcript_path: path, last_assistant_message: message }));

test.each([
  ["複数行の英語の text", [assistant([text(MULTILINE_REPORT), toolUse])]],
  ["1 行でも長い英語の text", [assistant([text(LONG_ONE_LINE), toolUse])]],
  [
    "thinkingDisplay が updates の複数行の英語の thinking",
    [assistant([thinking(MULTILINE_REPORT)], { thinkingDisplay: "updates" }), assistant([toolUse])],
  ],
  [
    "ツールの結果と Hook のフィードバック（isMeta）より前の英語の text",
    [
      assistant([text(MULTILINE_REPORT), toolUse]),
      toolResult,
      { type: "user", isMeta: true, message: { role: "user", content: "Stop hook feedback" } },
      assistant([text(JAPANESE)]),
    ],
  ],
  [
    "最後のツールの呼び出しより後で、最後の本文の前に書いた英語の text",
    [assistant([toolUse]), toolResult, assistant([text(MULTILINE_REPORT)])],
  ],
])(
  "書き直させる: 途中報告が %s なら、最後の本文が日本語でも止め、その箇所を引用する",
  (_label, entries) => {
    const res = stop(transcript([human("作業して"), ...entries]));
    expect(res.status).toBe(2);
    expect(res.stderr).toContain(ENGLISH.slice(0, 40));
  },
);

test("書き直させる: 途中報告は「（途中の報告）」を付けて引用する", () => {
  const res = stop(transcript([human("作業して"), assistant([text(MULTILINE_REPORT), toolUse])]));
  expect(res.stderr).toContain(`- （途中の報告）${ENGLISH.slice(0, 40)}`);
});

test.each([
  ["1 行の英語の前置き", [assistant([text(ONE_LINE_PREFACE), toolUse])]],
  ["複数行のしきい値は超えるが 1 行の英語の前置き", [assistant([text(ENGLISH), toolUse])]],
  ["日本語の途中報告", [assistant([text(`${JAPANESE}\n${JAPANESE}`), toolUse])]],
  [
    "thinkingDisplay が updates でない英語の thinking",
    [assistant([thinking(MULTILINE_REPORT)], { thinkingDisplay: "omitted" }), assistant([toolUse])],
  ],
  [
    "1 行の英語の thinking（updates）",
    [assistant([thinking(ONE_LINE_PREFACE)], { thinkingDisplay: "updates" }), assistant([toolUse])],
  ],
  [
    "サブエージェントの英語の text",
    [assistant([text(MULTILINE_REPORT), toolUse], { isSidechain: true })],
  ],
  [
    "ハーネスが書いた API のエラーの行",
    [assistant([text(MULTILINE_REPORT)], { isApiErrorMessage: true }), assistant([toolUse])],
  ],
])("通す: 途中報告が %s なら止めない", (_label, entries) => {
  expect(stop(transcript([human("作業して"), ...entries]))).toEqual({ status: 0, stderr: "" });
});

test("通す: 人が入力した最後の発言より前のターンの英語の本文は見ない", () => {
  const path = transcript([
    human("前の依頼"),
    assistant([text(MULTILINE_REPORT), toolUse]),
    toolResult,
    assistant([text(ENGLISH)]),
    human("次の依頼"),
    assistant([text(JAPANESE)]),
  ]);
  expect(stop(path)).toEqual({ status: 0, stderr: "" });
});

test("書き直させる: 人の発言が content の配列（画像付きなど）でも境界にする", () => {
  const path = transcript([
    human("前の依頼"),
    assistant([text(MULTILINE_REPORT), toolUse]),
    { type: "user", message: { role: "user", content: [{ type: "text", text: "次の依頼" }] } },
    assistant([text(MULTILINE_REPORT), toolUse]),
  ]);
  const res = stop(path);
  expect(res.status).toBe(2);
  expect(res.stderr.match(/（途中の報告）/g)).toHaveLength(1);
});

test("書き直させる: transcript に書き込まれた最後の本文と last_assistant_message が同じなら 1 回だけ引用する", () => {
  const path = transcript([
    human("作業して"),
    assistant([toolUse]),
    toolResult,
    assistant([text(ENGLISH)]),
  ]);
  const res = stop(path, ENGLISH);
  expect(res.status).toBe(2);
  expect(res.stderr).toBe(rewriteRequest([{ kind: "final", text: ENGLISH }]));
});

test("書き直させる: 最後の本文が JSON の値だけでも、英語の途中報告は止める", () => {
  const path = transcript([human("作業して"), assistant([text(MULTILINE_REPORT), toolUse])]);
  const res = stop(path, '{"ok": true}');
  expect(res.status).toBe(2);
  expect(res.stderr).toContain("（途中の報告）");
  expect(res.stderr).not.toContain('{"ok"');
});

test("書き直させる: サブエージェントへの指示（isSidechain の user）はターンの境界にしない", () => {
  const path = transcript([
    human("作業して"),
    assistant([text(MULTILINE_REPORT), toolUse]),
    { type: "user", isSidechain: true, message: { role: "user", content: "subagent prompt" } },
  ]);
  expect(stop(path).status).toBe(2);
});

test("書き直させる: ターンの途中の compact の要約（isCompactSummary の user）はターンの境界にしない", () => {
  const path = transcript([
    human("作業して"),
    assistant([text(MULTILINE_REPORT), toolUse]),
    {
      type: "user",
      isCompactSummary: true,
      message: { role: "user", content: "This session is being continued" },
    },
    assistant([text(JAPANESE)]),
  ]);
  expect(stop(path).status).toBe(2);
});

test("通す: transcript の不正な行は読み飛ばす", () => {
  const path = transcript([human("作業して"), assistant([text(JAPANESE)])], ["{", "[]", "42"]);
  expect(stop(path)).toEqual({ status: 0, stderr: "" });
});

test("transcript を読めなければ、最後の本文だけを確かめ、そのことを stderr に出す", () => {
  const missing = `${markerDir}/missing.jsonl`;
  const pass = stop(missing);
  expect(pass.status).toBe(0);
  expect(pass.stderr).toMatch(/^response-language-check: transcript を読めないので/);
  expect(stop(missing, ENGLISH).status).toBe(2);
});

// --- 言語に数えない形（Issue #1121） ---

const LINK =
  "[Fix how the parity suite runner reads the expected status](https://github.com/o/r/pull/1)";

test.each([
  [
    "英語の題の Markdown のリンクを並べた日本語の応答",
    `次の PR を作りました。\n\n- ${LINK}\n- ${LINK}`,
  ],
  ["JSON のオブジェクトだけの応答", `{"summary": "${ENGLISH}", "status": "done"}`],
  ["JSON の文字列だけの応答", JSON.stringify(ENGLISH)],
  [
    "リンク先に括弧とタイトルを持つ英語のリンクだけの応答",
    '[A very long English link label](https://example.test/a_(b) "A very long English title for review")',
  ],
  [
    "タイトル付きの英語のリンクを並べた日本語の応答",
    `次の PR を作りました。\n\n- ${LINK.replace(")", ' "Open the pull request for review")')}\n- ${LINK.replace(")", " 'Open the pull request for review')")}`,
  ],
  ["JSON の配列だけの応答", `["${ENGLISH}", "${ENGLISH}"]`],
  ["json のフェンスで囲んだ JSON だけの応答", `\`\`\`json\n{"summary": "${ENGLISH}"}\n\`\`\``],
])("通す: %s", (_label, message) => {
  expect(run(hook({ last_assistant_message: message }))).toEqual({ status: 0, stderr: "" });
});

test.each([
  ["リンクの外に英語の文がある応答", `${LINK} ${ENGLISH}`],
  ["JSON の後に英語の文が続く応答", `{"status": "done"}\n\n${ENGLISH}`],
  ["JSON に見えて読めない英語の応答", `{ ${ENGLISH}`],
  ["引用符で始まるが JSON の文字列でない英語の応答", `"${ENGLISH}" and ${ENGLISH}`],
  ["タイトルの後ろに英語の文が続く応答", `${LINK.replace(")", ' "title")')} ${ENGLISH}`],
])("書き直させる: %s", (_label, message) => {
  expect(run(hook({ last_assistant_message: message })).status).toBe(2);
});

test("prose はリンクの文字を残す（response-word-check はリンクの文字の使わない語も確かめる）", () => {
  expect(prose(LINK)).toContain("Fix how the parity suite runner");
});

// --- 無効にする環境変数 ---

test("通す: 無効にする環境変数が 1 なら、英語の応答も wrap_up も確かめず、印も消さない", () => {
  const marker = blockedMarker("response-language-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  writeFileSync(marker, "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv(DISABLE_ENV, "1");
  expect(main(hook({ last_assistant_message: ENGLISH }), markerDir)).toBe(0);
  expect(main(wrapUp({ recap: ENGLISH }), markerDir)).toBe(0);
  expect(existsSync(marker)).toBe(true);
});

test.each(["0", "true", " 1"])("書き直させる: 無効にする環境変数が %j なら確かめる", (value) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("COPILOT_CLI", "");
  vi.stubEnv(DISABLE_ENV, value);
  expect(main(hook({ last_assistant_message: ENGLISH }), markerDir)).toBe(2);
});

// --- wrap_up（PreToolUse） ---

function wrapUp(
  toolInput: unknown,
  toolName = "mcp__ccd_turn__wrap_up",
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "s",
    tool_name: toolName,
    tool_input: toolInput,
    ...extra,
  });
}

test.each([
  ["recap と ask が英語", { recap: ENGLISH, ask: "Shall I open the PR now?" }],
  ["ボタンの文言が英語", { recap: "", actions: [{ label: "Open the PR", message: ENGLISH }] }],
  [
    "ボタンが JSON の文字列で渡された英語",
    { actions: JSON.stringify([{ label: "Merge", message: ENGLISH }]) },
  ],
  ["知らない欄に英語", { summary: ENGLISH }],
  [
    "10 階層の入れ子の奥に英語",
    Array.from({ length: 10 }).reduce<unknown>((inner) => ({ nested: inner }), ENGLISH),
  ],
  [
    "recap は日本語でもボタンの文言が英語",
    { recap: JAPANESE.repeat(3), actions: [{ label: "Open", message: ENGLISH }] },
  ],
])("止める: wrap_up の %s なら、PreToolUse で止めて日本語で呼び直させる", (_label, input) => {
  const res = run(wrapUp(input));
  expect(res.status).toBe(2);
  expect(res.stderr).toBe(WRAP_UP_REQUEST);
});

test("止める: wrap_up を止めても、Stop の印は残さない", () => {
  run(wrapUp({ recap: ENGLISH }));
  expect(existsSync(blockedMarker("response-language-check", "s", markerDir) ?? "")).toBe(false);
});

test.each([
  [
    "日本語の wrap_up",
    wrapUp({ recap: JAPANESE, actions: [{ label: "PR を作る", message: "PR を作って" }] }),
  ],
  [
    "英語の識別子だけのボタン",
    wrapUp({ recap: JAPANESE, actions: [{ label: "merge", message: "`gh pr merge`" }] }),
  ],
  ["入力が無い wrap_up", wrapUp(undefined)],
  ["名前が wrap_up だけのツール", wrapUp({ recap: ENGLISH }, "wrap_up")],
  ["名前が wrap_up で終わらないツール", wrapUp({ recap: ENGLISH }, "mcp__ccd_turn__wrap_up_draft")],
  ["別のツール", wrapUp({ command: ENGLISH }, "Bash")],
  [
    "Copilot の .claude/settings.json の登録",
    wrapUp({ recap: ENGLISH }, "mcp__ccd_turn__wrap_up", { timestamp: COPILOT_TIMESTAMP }),
  ],
])("通す: %s", (label, input) => {
  expect(run(input, label.startsWith("Copilot") ? "1" : "")).toEqual({ status: 0, stderr: "" });
});
