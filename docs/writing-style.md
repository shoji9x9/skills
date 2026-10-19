---
# Copilot のレビューに読ませる範囲。理由は check-rule-symlinks.ts の DOC_INSTRUCTIONS にある。
applyTo: "**,**/.*/**,**/.*"
---

# 文章の書き方

配布スキル `writing-style` の規則を、このリポジトリ向けに拡張する文書。
規則の本文はスキルにあり、このリポジトリでもそれに従う（「規則と読み直しの手順」）。

## 対象

- 人が読む Markdown
  - `AGENTS.md`、`README.md`、`docs/`、`.agents/rules/`
  - `skills/` の文書と、private skill（`.agents/skills/<name>/` のうち `.private-skill` を持つもの）の文書
  - `evals/` の README と fixtures、`.kaizen/` の学び
- コードコメント（設定ファイルのコメントを含む）
- スクリプトが利用者に表示するメッセージ
- エージェントが人へ返す応答

次のものは対象にしない。

- `SKILL.md` の `description`。エージェントがスキルを選ぶための文で、言い換えると呼び出しの精度が変わる
- `.kaizen/archive/` の学びと `tests/` の結果。過去の記録として書き換えない
- インストール済みのスキルのコピー（`.agents/skills/<name>/`）とエージェント用のリンク（`.claude/`）。`skills/` と同じ中身なので、`skills/` を直す

スクリプトが解析する見出し・列名や、eval の assertion が依存する節名を変えると、スクリプトや eval が動かなくなる。
これらに当たる変更は、そのつど人に確認してから行う。

## 規則と読み直しの手順

規則 1〜10、要約として読まれる文の読み直し、書き換えで変えないものは、配布スキル `writing-style` の [`skills/writing-style/references/rules.md`](../skills/writing-style/references/rules.md) で定義する。ここへ転記しない。
`.config/skills/shoji9x9/writing-style.jsonc` が、`style_docs` にこの文書を、`word_list` に `.textlint/word-list.md` を、`lint_command` に `lint-prose.ts` を指定している。
スキルを使うエージェントは、この設定から規約・一覧・チェックのコマンドを読む。
使わない語の原本は `.textlint/words.json`（言い換え先は各エントリの `message`）で、`.textlint/word-list.md` はそこから生成する。
このリポジトリで決めた用語を使うときは、最初に出てくる箇所で意味を書く。

機械的なチェック（textlint・使わない語の辞書・応答の Hook）の仕組みと、辞書に語を足す手順は、[`tooling.md`](tooling.md)「文章のチェック」にある。
