---
# Copilot のレビューに読ませる範囲。理由は check-rule-symlinks.ts の DOC_INSTRUCTIONS にある。
applyTo: "**,**/.*/**,**/.*"
---

# 文章の書き方

配布スキル `writing-style` の規則を、このリポジトリ向けに拡張する文書。
規則の本文はスキルにあり、このリポジトリでもそれに従う（「規則と読み直しの手順」）。

## 対象

- 人が読む Markdown
  - `AGENTS.md`、`README.md`、`SECURITY.md` の日本語の節、`docs/`、`.agents/rules/`
  - `skills/` の文書と、private skill（`.agents/skills/<name>/` のうち `.private-skill` を持つもの）の文書
  - `evals/` の README と fixtures、`.kaizen/` の学び
- コードコメント（設定ファイルのコメントを含む）
- スクリプトが利用者に表示するメッセージ
- エージェントが人へ返す応答

次のものは対象にしない。

- `SKILL.md` の `description`。エージェントがスキルを選ぶための文で、言い換えると呼び出しの精度が変わる
- `.kaizen/archive/` の学びと `tests/` の結果。過去の記録として書き換えない
- インストール済みのスキルのコピー（`.agents/skills/<name>/`）とエージェント用のリンク（`.claude/`）。`skills/` と同じ中身なので、`skills/` を直す
- 英語で書くスライドの文書（`docs/slides/storylines/en/` と `docs/slides/prompts/`）。規則は日本語の文章向けである
- `SECURITY.md` の英語の節。外部の報告者向けに日本語の節と同じ内容を英語で書く。規則は日本語の文章向けである。ただし `lint-prose.ts` は節で分けずにファイル全体を見る

スクリプトが解析する見出し・列名や、eval の assertion が依存する節名を変えると、スクリプトや eval が動かなくなる。
これらに当たる変更は、そのつど人に確認してから行う。

## 規則と読み直しの手順

規則 1〜10、要約として読まれる文の読み直し、書き換えで変えないものは、配布スキル `writing-style` の [`skills/writing-style/references/rules.md`](../skills/writing-style/references/rules.md) で定義する。ここへ転記しない。
`.config/skills/shoji9x9/writing-style.jsonc` が、`style_docs` にこの文書を、`word_list` に `.textlint/word-list.md` を、`lint_command` に `lint-prose.ts` を指定している。
スキルを使うエージェントは、この設定から規約・一覧・チェックのコマンドを読む。
使わない語の原本は `.textlint/words.json`（言い換え先は各エントリの `message`）で、`.textlint/word-list.md` はそこから生成する。

機械的なチェック（textlint・使わない語の辞書・応答の Hook）の仕組みと、辞書に語を足す手順は、[`tooling.md`](tooling.md)「文章のチェック」にある。

## 用語

手順や処理の一区切り（GitHub Actions の step、スキルの手順の一区切り、処理を順に通す流れの 1 つ）は「ステップ」と書き、「段」と書かない。
前後のものは「前のステップ」「後のステップ」と書き、「前段」「後段」と書かない。
入れ子や階層の深さ（「1 段下の子」「4 段まで辿る」）と、熟語（多段・段落・段階・手段）は、この用語に当たらないのでそのまま書く。

使わない語の辞書には載せない。形態素解析は、ステップの意味の「段」と深さの意味の「段」を同じ名詞として返すので、辞書に載せると深さの意味の「段」も検出するからである。
