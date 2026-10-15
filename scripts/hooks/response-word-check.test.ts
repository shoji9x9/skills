// 応答の使わない語を確かめる Stop の Hook の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                            |
// | -------------- | ----------------------------------------------------------------------------- |
// | 入力           | 正常な Hook JSON / 不正な JSON / オブジェクトでない JSON                        |
// | 続けさせた後か | stop_hook_active が true / false / 欠落                                        |
// | 止めた印       | 無い / 在る（この一続きで止めた）/ session_id が使えない形 / 消せない |
// | ダッシュ       | `——` の後に「「」「（」「。」/ `――`（U+2015）/ 1 文字の `—`                      |
// | 本文           | 欠落 / 文字列でない / 空白だけ / 使わない語が 0 個・1 個・2 個                    |
// | 語の位置       | 本文 / コードブロック / インラインコード / 引用 / ハーネスのタグの塊             |
// | 止める指示     | textlint-disable のコメント（応答では従わない）                                  |
// | 他の規則       | 「ですます」調・150 字を超える文（文書の規約で、応答には当てない）               |
// | 設定           | 読める / .textlintrc.json が無い                                               |
//
// 通す入力が止める入力と同じ数以上あることが要点である。止める入力だけのテストでは、「全部止める実装」と区別できない。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isNonEmptyString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { makeTempDir } from "../lib/test-tmpdir.ts";
import { DASH_TERM } from "../lib/textlint-word-rule.ts";
import { blockedMarker } from "../lib/stop-marker.ts";
import { REWRITE_REQUEST, main } from "./response-word-check.ts";

// 止めた印は、テストごとの一時ディレクトリに置く（OS の一時ディレクトリの実物に触らない）。
let markerDir = "";
beforeEach(() => {
  markerDir = makeTempDir("response-word-check-marker-");
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(markerDir, { recursive: true, force: true });
});

const hook = (fields: Record<string, unknown>) =>
  JSON.stringify({ hook_event_name: "Stop", session_id: "s", ...fields });

const PLAIN = "レビューの指摘を直し、テストが通りました。";
// 使わない語はテストの文字列に直接書かず（このファイルも textlint の対象である）、辞書の先頭の 2 語の例文と指摘を使う。
type Entry = { term: string; example: string; message: string };
const isEntry = (e: unknown): e is Entry =>
  isRecord(e) &&
  isNonEmptyString(e.term) &&
  isNonEmptyString(e.example) &&
  isNonEmptyString(e.message);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dictionary: unknown = JSON.parse(
  readFileSync(join(repoRoot, ".textlint/words.json"), "utf8"),
);
const entries =
  isRecord(dictionary) && isArray(dictionary.entries) ? dictionary.entries.filter(isEntry) : [];
// 辞書を読めずに 2 語が揃わなければ、止める側のテストが空の文字列で動かないよう、ここで失敗させる。
if (entries.length < 2) throw new Error(".textlint/words.json から term を持つ語を 2 つ読めない");
const [FIRST, SECOND] = entries;
const WITH_WORD = FIRST.example;
const DASH = entries.find((e) => e.term === DASH_TERM);
if (!DASH) throw new Error(".textlint/words.json にダッシュの項目が無い");
// ダッシュの並びもテストの文字列に直接書かない（このファイルも textlint の対象である）。
const EM2 = "\u2014".repeat(2);
const BAR2 = "\u2015".repeat(2);

async function run(input: string, root?: string): Promise<{ status: number; stderr: string }> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
  const status = await main(input, root, markerDir);
  return { status, stderr: errors.join("\n") };
}

// --- 誤検知しないことの確認（通す） ---

test.each([
  ["使わない語の無い応答", PLAIN],
  ["コードブロックの中の使わない語", `次の出力です。\n\n\`\`\`text\n${WITH_WORD}\n\`\`\`\n`],
  ["インラインコードの中の使わない語", `\`${FIRST.term}\` は使わない語なので、言い換えました。`],
  ["引用の中の使わない語", `レビューの指摘です。\n\n> ${WITH_WORD}\n\n直しました。`],
  [
    "ハーネスのタグの塊の中の使わない語",
    `${PLAIN}\n\n<system-reminder>\n${WITH_WORD}\n</system-reminder>`,
  ],
  [
    "「ですます」調で 150 字を超える文",
    `${"確認した内容を順に説明すると、".repeat(12)}テストは通りました。`,
  ],
])("通す: %s", async (_name, message) => {
  const { status, stderr } = await run(hook({ last_assistant_message: message }));
  expect(stderr).toBe("");
  expect(status).toBe(0);
});

test("通す: この一続きで既に止めた後（stop_hook_active が true で印が在る）は、使わない語があっても通す", async () => {
  const marker = blockedMarker("response-word-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  writeFileSync(marker, "");
  const { status } = await run(hook({ stop_hook_active: true, last_assistant_message: WITH_WORD }));
  expect(status).toBe(0);
});

test("通す: session_id が使えない形なら、続けさせた後の応答は確かめない", async () => {
  const { status } = await run(
    hook({ session_id: "../x", stop_hook_active: true, last_assistant_message: WITH_WORD }),
  );
  expect(status).toBe(0);
});

test("通す: 1 文字の — は対象にしない（表の空欄や英語の区切り）", async () => {
  const { status, stderr } = await run(hook({ last_assistant_message: "結果 — 成功です。" }));
  expect(stderr).toBe("");
  expect(status).toBe(0);
});

test("通す: 新しい一続きの最初の Stop は、前の一続きの印を消す", async () => {
  const marker = blockedMarker("response-word-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  writeFileSync(marker, "");
  const { status } = await run(hook({ stop_hook_active: false, last_assistant_message: PLAIN }));
  expect(status).toBe(0);
  expect(existsSync(marker)).toBe(false);
});

test("通す: 前の印を消せなくても、例外で終わらずに判定を続ける", async () => {
  const marker = blockedMarker("response-word-check", "s", markerDir);
  if (!marker) throw new Error("印のパスを作れない");
  // ディレクトリは recursive なしの rmSync で消せないので、消せない印の代わりに置く。
  mkdirSync(marker);
  const { status, stderr } = await run(
    hook({ stop_hook_active: false, last_assistant_message: PLAIN }),
  );
  expect(status).toBe(0);
  expect(stderr).toContain("前の印を消せない");
});

test.each([
  ["欠落", {}],
  ["文字列でない", { last_assistant_message: 1 }],
  ["空白だけ", { last_assistant_message: " \n " }],
])("通す: 本文が%s", async (_name, fields) => {
  const { status } = await run(hook(fields));
  expect(status).toBe(0);
});

// --- 検出されることの確認（止める） ---

test("止める: 本文の使わない語を、辞書の言い換えとともに示す", async () => {
  const { status, stderr } = await run(
    hook({ stop_hook_active: false, last_assistant_message: WITH_WORD }),
  );
  expect(status).toBe(2);
  expect(stderr).toContain(REWRITE_REQUEST);
  expect(stderr).toContain(FIRST.message);
});

test("止める: 別の Hook が続けさせた後（stop_hook_active が true で印が無い）の応答も確かめ、止めた印を残す", async () => {
  const { status, stderr } = await run(
    hook({ stop_hook_active: true, last_assistant_message: WITH_WORD }),
  );
  expect(status).toBe(2);
  expect(stderr).toContain(FIRST.message);
  expect(existsSync(blockedMarker("response-word-check", "s", markerDir) ?? "")).toBe(true);
});

test.each([
  ["後に「「」が続く", `同じ族${EM2}「検査」と同じである。`],
  ["後に「（」が続く", `判定する${EM2}（終了コードは使えない）。`],
  ["後に「。」が続く", `判定する${EM2}。`],
  ["U+2015 の 2 文字", `判定する${BAR2} 終了コードは使えない。`],
])("止める: ダッシュの強調（%s）を、辞書の言い換えとともに示す", async (_name, message) => {
  const { status, stderr } = await run(hook({ last_assistant_message: message }));
  expect(status).toBe(2);
  expect(stderr).toContain(DASH.message);
});

test("止める: 辞書でも検出できるダッシュの強調は、1 件だけ示す", async () => {
  const { status, stderr } = await run(hook({ last_assistant_message: DASH.example }));
  expect(status).toBe(2);
  expect(stderr.split(DASH.message).length - 1).toBe(1);
});

test("止める: textlint-disable のコメントを書いても、使わない語を示す", async () => {
  const { status, stderr } = await run(
    hook({ last_assistant_message: `<!-- textlint-disable -->\n\n${WITH_WORD}` }),
  );
  expect(status).toBe(2);
  expect(stderr).toContain(FIRST.message);
});

test("止める: 使わない語が 2 つなら 2 つとも示す", async () => {
  const { status, stderr } = await run(
    hook({ last_assistant_message: `${WITH_WORD}${SECOND.example}` }),
  );
  expect(status).toBe(2);
  expect(stderr).toContain(FIRST.message);
  expect(stderr).toContain(SECOND.message);
});

// --- 判定できない入力（書き直しを求めずに、エラーとして見せる） ---

test.each([
  ["不正な JSON", "{"],
  ["オブジェクトでない JSON", "[]"],
])("エラー: %s", async (_name, input) => {
  const { status, stderr } = await run(input);
  expect(status).toBe(1);
  expect(stderr).toMatch(/^response-word-check: /);
});

test("エラー: textlint の設定が無ければ、書き直しを求めずに 1 を返す", async () => {
  const empty = makeTempDir("response-word-check-");
  try {
    const { status, stderr } = await run(hook({ last_assistant_message: WITH_WORD }), empty);
    expect(status).toBe(1);
    expect(stderr).toContain("textlint で判定できない");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("エラー: 設定で使わない語の規則が無効なら、書き直しを求めずに 1 を返す", async () => {
  // 辞書は在るので、ダッシュの規則だけは作れる。語の規則が無いことを、0 件の指摘として通さないことを確かめる。
  const root = makeTempDir("response-word-check-");
  try {
    mkdirSync(join(root, ".textlint"), { recursive: true });
    writeFileSync(join(root, ".textlintrc.json"), JSON.stringify({ rules: {} }));
    writeFileSync(join(root, ".textlint/words.json"), JSON.stringify({ entries: [DASH] }));
    const { status, stderr } = await run(hook({ last_assistant_message: WITH_WORD }), root);
    expect(status).toBe(1);
    expect(stderr).toContain("textlint で判定できない");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
