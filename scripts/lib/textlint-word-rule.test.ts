// 使わない語の規則を設定から取り出す処理の回帰テスト。
//
// | 軸           | 値                                                       |
// | ------------ | -------------------------------------------------------- |
// | 設定         | 実リポジトリの .textlintrc.json / 規則の無い設定 / 設定ファイルが無い |
//
// 規則が無い設定を 0 件の規則として返すと、使う側（lint-prose・応答の Hook）がエラーにならずに通す。それを例外にすることが要点である。
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTextlintrc } from "textlint";
import { expect, test } from "vitest";
import { makeTempDir } from "./test-tmpdir.ts";
import { WORD_RULE, wordRules } from "./textlint-word-rule.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("リポジトリの .textlintrc.json から、使わない語の規則だけを 1 件取り出す", async () => {
  const descriptor = await loadTextlintrc({ configFilePath: join(repoRoot, ".textlintrc.json") });
  expect(wordRules(descriptor).map((r) => r.ruleId)).toEqual([WORD_RULE]);
});

test.each([
  ["規則の無い設定", true],
  ["設定ファイルが無い", false],
])("%s なら、0 件として返さずに例外を投げる", async (_name, write) => {
  const dir = makeTempDir("textlint-word-rule-");
  try {
    const config = join(dir, ".textlintrc.json");
    if (write) writeFileSync(config, JSON.stringify({ rules: {} }));
    const descriptor = await loadTextlintrc({ configFilePath: config });
    expect(() => wordRules(descriptor)).toThrow(
      `${WORD_RULE} の規則が .textlintrc.json で有効になっていない`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
