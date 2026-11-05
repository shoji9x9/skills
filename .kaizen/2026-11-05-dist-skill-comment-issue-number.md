---
date: 2026-11-05
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 配布スキルのコードコメントに Issue 番号を書き、doc-refs のチェックが commit を止めた

## 事象

issue-batch の run の #906 で、`skills/kaizen/scripts/kaizen-precommit-gate.sh` のコメントの末尾に Issue の番号を書いた。
pre-commit の `doc-refs` が `dist-issue` として commit を止めたので、番号を消して commit し直した。
同じ PR のテスト（`scripts/skills/kaizen/`）のコメントには番号を書いてよく、こちらは止まらなかった。

## 根本原因

配布スキルの中のファイルは、Issue と PR の番号を書かない取り決めがある（導入先のリポジトリでは別の Issue を指す）。
テストのコメントと同じ書き方を、同じ変更の中で配布スキルのスクリプトにも当てた。
取り決めは `doc-refs` のチェックが持ち、書く前に参照する文書には目立たない。

## 根拠

1 回の観測で、原因はコメントに番号を書いたことに絞れる。
KEDB 照合では `dist-issue`・`doc-refs`・`Issue 番号` を照合し、一致する学びは無かった。

## 提案

配布スキル（`skills/<name>/`）のコードコメントには Issue と PR の番号を書かず、経緯は PR の本文と配布しないテストのコメントに書く。

- チェックが commit の前に止めるので、新しい機構は要らない。`.agents/rules/distributed-skill-stack-independence.md` の「直すもの」に 1 行足すかを、再発したときに決める
