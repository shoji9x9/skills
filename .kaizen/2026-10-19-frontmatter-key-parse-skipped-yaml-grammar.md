---
date: 2026-10-19
type: rule
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# frontmatter のキーを読む検査を書くときは、YAML の文法が許すキーと値の形を先に表にする

## 事象

issue-batch の #701 で、`kaizen-status-check.sh` に `confidence:` の値を確かめる検査を足した。
ローカルレビューで、値の `|`（読み取りの区切り）と片側だけの引用符を指摘された。PR #713 の手元のレビューでも、同じキーが 2 回ある形、キーとコロンの間の空白、コロンの後に空白が無い形、コメントだけの値を指摘された。
どれも実際に入力を作って再現し、直した。

## 根本原因

1. なぜ指摘が続いたか → 検査を書く前に、YAML の文法が許すキーと値の形を挙げず、思いついた値（大文字・空・引用符）だけをテストにした。
2. なぜ挙げなかったか → 既存の `type:`・`status:` の読み取りと同じ形で書けば足りると考え、既存の読み取りがそれらの形を扱っているかを確かめなかった。
3. なぜ確かめなかったか → 規約（`.agents/rules/state-space-and-mutation-proof.md` の「入力を解析する処理は、入力の文法が許す形から状態を挙げる」）は既にあるが、既存の実装をまねるときには当てる対象だと気づかなかった ← 根本原因

## 根拠

同じ原因の学び（`.kaizen/2026-10-08-embed-into-markup-enumerate-grammar.md`、applied）と KEDB 照合で一致し、レビューの指摘を入力で再現して確かめたので high。
ローカルレビューで 2 件、PR #713 の 1 回目の手元のレビューで 4 件、frontmatter の値の読み方を指摘された。どれも一時ディレクトリのノートに検査を当てて再現した。
KEDB 照合: 「YAML」+「文法」で、上の applied の学びと `.kaizen/2026-09-21-check-written-to-fit-the-fixture.md`（applied）に一致した。applied なので追記せず、この記録を新しく作った。

## 提案

既存の読み取りをまねて frontmatter のキーを読む検査を足すときも、YAML の文法が許すキーと値の形（重なり・キーの前後の空白・引用符・コメント・区切りの文字）を表にしてから、通す形と止める形のテストを書く。

- 反映先の候補: `.agents/rules/state-space-and-mutation-proof.md` の「入力を解析する処理は、入力の文法が許す形から状態を挙げる」に、既存の実装をまねるときも当てることを 1 行足す。
