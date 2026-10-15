// 使わない語の規則を設定から取り出す処理と、ダッシュの並びを探す規則の回帰テスト。
//
// | 軸           | 値                                                                          |
// | ------------ | --------------------------------------------------------------------------- |
// | 設定         | 語の規則と他の規則を持つ合成の設定 / 規則の無い設定 / 設定ファイルが無い    |
// | 辞書         | ダッシュの項目が在る / 無い / message が無い / 辞書が無い                  |
//
// 規則が無い設定を 0 件の規則として返すと、使う側（lint-prose・応答の Hook）がエラーにならずに通す。それを例外にすることが要点である。
// 設定は実リポジトリの .textlintrc.json を読まずに合成する。実リポジトリの設定が変わると、変異を検出できるかが変わるからである。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTextlintrc } from "textlint";
import { afterEach, beforeEach, expect, test } from "vitest";
import { makeTempDir } from "./test-tmpdir.ts";
import {
  DASH_RULE,
  DASH_TERM,
  dashMessage,
  dashRule,
  WORD_RULE,
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

test("辞書が無ければ、規則を作らずに例外を投げる", () => {
  expect(() => dashRule(dir)).toThrow();
});
