// 使わない語の textlint の規則（辞書は `.textlint/words.json`）の ID と、設定で有効になっているかの確認。
//
// ID は `.textlintrc.json` の preset の名前と規則名から決まる。preset の名前が変わると ID も変わり、
// 指摘をこの ID で絞る処理（lint-prose の文字列・応答の Hook）は、エラーにならずに 0 件を返して通してしまう。
// そのため ID をここで 1 か所に定義し、使う側は、設定にこの規則が在ることを先に確かめる。
//
// 辞書の `——` の項目だけは、辞書の照合では検出しきれない。辞書は形態素の surface_form で照合するが、
// kuromoji は記号の連続を 1 つのトークンにまとめるので、`——「`・`——（`・`——。` は `——` のトークンにならない。
// 字形の違う `――`（U+2015）・`──`（U+2500）・`－－`（U+FF0D）も辞書には一致しない。そこで、2 文字以上続くダッシュを文字列で探す規則（DASH_RULE）を足す。
// `─` と `－` は、ディレクトリの木（`├──`）・区切りの線（`────`）・矢印の図（`A──▶B`・`A──→B`）にも使う。
// そのため、前後の両方に文字が続く並びだけを拾う。前後の文字からは、罫線・図形・矢印（`<` `>` を含む）を除く（ARROWS・FIGURES）。
// 指摘は辞書の `——` の項目の message で出す。textlint は位置と message が同じ指摘を 1 件にまとめるので、
// 辞書でも検出できる形は 2 件にならない。1 文字の `—` は、表の空欄や英語の区切りに使うので対象にしない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { loadTextlintrc } from "textlint";
import { isNonEmptyString, isRecord } from "../guards.ts";
import { isArray } from "../is-array.ts";

/** `.textlintrc.json` の preset の id と規則名を `/` でつないだもの。 */
export const WORD_RULE = "ai-words-ja/no-ai-words";
/** 2 文字以上続くダッシュ（`——`・`――`・`──`・`－－`）を検出する規則の ID。設定ファイルには書かず、使う側が足す。 */
export const DASH_RULE = "local/no-dash-emphasis";
/** 使わない語として扱う規則の ID（文字列と応答には、これだけを当てる）。 */
export const WORD_RULE_IDS: readonly string[] = [WORD_RULE, DASH_RULE];
/** 辞書の項目のうち、DASH_RULE の指摘に message を使う項目の term。 */
export const DASH_TERM = "\u2014\u2014";

type Descriptor = Awaited<ReturnType<typeof loadTextlintrc>>;

type KernelRules = ReturnType<Descriptor["rule"]["toKernelRulesFormat"]>;
type KernelRule = KernelRules[number];

// 矢印の図（`A──▶B`・`A－－＞B`・`A——→B`・`B＜－－A`）で、ダッシュの並びの前後に来る文字。
// 矢印（U+2190〜U+21FF・U+2794〜U+27BF の Dingbats・U+27F0〜U+27FF・U+2900〜U+297F・U+2B00〜U+2BFF）と、半角・全角の `<` `>`。
const ARROWS = "\\u2190-\\u21ff\\u2794-\\u27bf\\u27f0-\\u27ff\\u2900-\\u297f\\u2b00-\\u2bff<>＜＞";
// 罫線・ブロック要素・図形（U+2500〜U+25FF）。ディレクトリの木・区切りの線・`▶` を含む。
const FIGURES = "\\u2500-\\u25ff";
const DASH_RE = new RegExp(
  [
    // `——`・`――` は文末（`——。`）でも拾うので、前後に文字を求めず、矢印の図の形だけを除く。
    `(?<![—―${ARROWS}])[—―]{2,}(?![—―${ARROWS}])`,
    `(?<=[^\\s${FIGURES}${ARROWS}])─{2,}(?=[^\\s${FIGURES}${ARROWS}])`,
    `(?<=[^\\s－${FIGURES}${ARROWS}])－{2,}(?=[^\\s－${FIGURES}${ARROWS}])`,
  ].join("|"),
  "g",
);

/** 設定から使わない語の規則だけを取り出す。規則が無ければ、0 件として通さずに例外を投げる。 */
export function wordRules(descriptor: Descriptor): KernelRules {
  const rules = descriptor.rule.toKernelRulesFormat().filter((r) => r.ruleId === WORD_RULE);
  if (rules.length === 0) {
    throw new Error(`${WORD_RULE} の規則が .textlintrc.json で有効になっていない`);
  }
  return rules;
}

/** 使わない語の辞書のパス（リポジトリ相対）。`.textlintrc.json` の dictionaryPath と同じであることをテストで確かめる。 */
export const WORDS_PATH = ".textlint/words.json";

/** 辞書（`<root>/WORDS_PATH`）から `——` の項目の message を読む。無ければ例外を投げる。 */
export function dashMessage(root: string): string {
  const path = join(root, WORDS_PATH);
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  const entries = isRecord(data) && isArray(data.entries) ? data.entries : [];
  const entry = entries.find((e) => isRecord(e) && e.term === DASH_TERM);
  if (!isRecord(entry) || !isNonEmptyString(entry.message)) {
    throw new Error(`${path} に term が「${DASH_TERM}」で message を持つ項目が無い`);
  }
  return entry.message;
}

/** DASH_RULE を textlint の規則の形で返す。message は辞書の `——` の項目から読む。 */
export function dashRule(root: string): KernelRule {
  const message = dashMessage(root);
  return {
    ruleId: DASH_RULE,
    options: true,
    rule: (context) => ({
      [context.Syntax.Str](node) {
        const text = context.getSource(node);
        for (const m of text.matchAll(DASH_RE)) {
          context.report(node, new context.RuleError(message, { index: m.index }));
        }
      },
    }),
  };
}

/** 設定の規則に DASH_RULE を足した設定を返す（filter の規則などは変えない）。 */
export function withDashRule(descriptor: Descriptor, root: string): Descriptor {
  return descriptor.shallowMerge({
    rules: [...descriptor.rule.toKernelRulesFormat(), dashRule(root)],
  });
}
