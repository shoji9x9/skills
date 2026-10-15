// 使わない語の規則を設定から取り出す処理と、ダッシュの並びを探す規則の回帰テスト。
//
// | 軸           | 値                                                                          |
// | ------------ | --------------------------------------------------------------------------- |
// | 設定         | 語の規則と他の規則を持つ合成の設定 / 規則の無い設定 / 設定ファイルが無い    |
// | 辞書         | ダッシュの項目が在る / 無い / message が無い / 辞書が無い                  |
//
// 規則が無い設定を 0 件の規則として返すと、使う側（lint-prose・応答の Hook）がエラーにならずに通す。それを例外にすることが要点である。
// 設定は実リポジトリの .textlintrc.json を読まずに合成する。実リポジトリの設定が変わると、変異を検出できるかが変わるからである。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLinter, loadTextlintrc } from "textlint";
import { afterEach, beforeEach, expect, test } from "vitest";
import { isRecord } from "./guards.ts";
import { makeTempDir } from "./test-tmpdir.ts";
import {
  DASH_RULE,
  DASH_TERM,
  dashMessage,
  dashRule,
  WORD_RULE,
  WORDS_PATH,
  wordRules,
} from "./textlint-word-rule.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let dir = "";
beforeEach(() => {
  dir = makeTempDir("textlint-word-rule-");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合成した設定を読む。規則のモジュールは実リポジトリの node_modules から読む。 */
async function load(rules: Record<string, unknown>) {
  const config = join(dir, ".textlintrc.json");
  writeFileSync(config, JSON.stringify({ rules }));
  return loadTextlintrc({
    configFilePath: config,
    node_modulesDir: join(repoRoot, "node_modules"),
  });
}

function writeWords(entries: unknown[]) {
  mkdirSync(join(dir, ".textlint"), { recursive: true });
  writeFileSync(join(dir, ".textlint/words.json"), JSON.stringify({ entries }));
}

test("語の規則と他の規則を持つ設定から、使わない語の規則だけを 1 件取り出す", async () => {
  const descriptor = await load({
    "preset-ai-words-ja": { "no-ai-words": true },
    "preset-ja-technical-writing": { "sentence-length": { max: 150 } },
  });
  expect(descriptor.rule.toKernelRulesFormat().length).toBeGreaterThan(1);
  expect(wordRules(descriptor).map((r) => r.ruleId)).toEqual([WORD_RULE]);
});

test.each([
  ["規則の無い設定", true],
  ["設定ファイルが無い", false],
])("%s なら、0 件として返さずに例外を投げる", async (_name, write) => {
  const config = join(dir, ".textlintrc.json");
  if (write) writeFileSync(config, JSON.stringify({ rules: {} }));
  const descriptor = await loadTextlintrc({ configFilePath: config });
  expect(() => wordRules(descriptor)).toThrow(
    `${WORD_RULE} の規則が .textlintrc.json で有効になっていない`,
  );
});

test("辞書のダッシュの項目の message を、ダッシュの規則の指摘に使う", () => {
  writeWords([
    { term: "x", message: "別の項目", tokens: [{ surface_form: "x" }] },
    { term: DASH_TERM, message: "ダッシュでつながない", tokens: [{ surface_form: DASH_TERM }] },
  ]);
  expect(dashMessage(dir)).toBe("ダッシュでつながない");
  expect(dashRule(dir).ruleId).toBe(DASH_RULE);
});

test.each([
  ["ダッシュの項目が無い", [{ term: "x", message: "m", tokens: [{ surface_form: "x" }] }]],
  ["ダッシュの項目に message が無い", [{ term: DASH_TERM, tokens: [{ surface_form: DASH_TERM }] }]],
])("%s なら、規則を作らずに例外を投げる", (_name, entries) => {
  writeWords(entries);
  expect(() => dashRule(dir)).toThrow("message を持つ項目が無い");
});

test("実リポジトリ: .textlintrc.json の dictionaryPath は WORDS_PATH を指す", () => {
  const rc: unknown = JSON.parse(readFileSync(join(repoRoot, ".textlintrc.json"), "utf8"));
  const preset = isRecord(rc) && isRecord(rc.rules) ? rc.rules["preset-ai-words-ja"] : undefined;
  const rule = isRecord(preset) ? preset["no-ai-words"] : undefined;
  const path = isRecord(rule) ? rule.dictionaryPath : undefined;
  if (typeof path !== "string") throw new Error("no-ai-words の dictionaryPath を読めない");
  expect(resolve(repoRoot, path)).toBe(resolve(repoRoot, WORDS_PATH));
});

// ダッシュの並びはテストの文字列に直接書かない（このファイルも textlint の対象である）。
const BOX2 = "\u2500".repeat(2);
const FULL2 = "\uff0d".repeat(2);

test.each([
  ["罫線（U+2500）", `判定する${BOX2}終了コードは使えない。`, 1],
  ["全角のハイフン（U+FF0D）", `判定する${FULL2}終了コードは使えない。`, 1],
  ["ディレクトリの木（├）", `\u251c${BOX2} benchmark.json`, 0],
  ["ディレクトリの木（└）", `\u2514${BOX2} eval-1/`, 0],
  ["罫線だけの区切りの行", `結果\n\n${BOX2}${BOX2}\n\n次`, 0],
  ["行頭の罫線の区切り", `- ${BOX2}${BOX2}`, 0],
  ["全角のハイフンだけの区切り", `${FULL2}${FULL2}`, 0],
  ["矢印の図（▶）", `フローは A${BOX2}\u25b6B の順である。`, 0],
  ["矢印の図（→）", `main${BOX2}\u2192feature の順に取り込む。`, 0],
  ["全角のハイフンの矢印", `A${FULL2}>B の順である。`, 0],
])("ダッシュの規則: %s の件数", async (_name, text, count) => {
  writeWords([{ term: DASH_TERM, message: "m", tokens: [{ surface_form: DASH_TERM }] }]);
  const descriptor = (await load({})).shallowMerge({ rules: [dashRule(dir)] });
  const result = await createLinter({ descriptor }).lintText(text, join(dir, "a.md"));
  expect(result.messages.filter((m) => m.ruleId === DASH_RULE)).toHaveLength(count);
});

test("辞書が無ければ、規則を作らずに例外を投げる", () => {
  expect(() => dashRule(dir)).toThrow();
});
