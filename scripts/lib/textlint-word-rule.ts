// 使わない語の textlint の規則（辞書は `.textlint/words.json`）の ID と、設定で有効になっているかの確認。
//
// ID は `.textlintrc.json` の preset の名前と規則名から決まる。preset の名前が変わると ID も変わり、
// 指摘をこの ID で絞る処理（lint-prose の文字列・応答の Hook）は、エラーにならずに 0 件を返して通してしまう。
// そのため ID をここで 1 か所に定義し、使う側は、設定にこの規則が在ることを先に確かめる。
import type { loadTextlintrc } from "textlint";

/** `.textlintrc.json` の preset の id と規則名を `/` でつないだもの。 */
export const WORD_RULE = "ai-words-ja/no-ai-words";

type Descriptor = Awaited<ReturnType<typeof loadTextlintrc>>;

type KernelRules = ReturnType<Descriptor["rule"]["toKernelRulesFormat"]>;

/** 設定から使わない語の規則だけを取り出す。規則が無ければ、0 件として通さずに例外を投げる。 */
export function wordRules(descriptor: Descriptor): KernelRules {
  const rules = descriptor.rule.toKernelRulesFormat().filter((r) => r.ruleId === WORD_RULE);
  if (rules.length === 0) {
    throw new Error(`${WORD_RULE} の規則が .textlintrc.json で有効になっていない`);
  }
  return rules;
}
