---
date: 2026-10-28
type: skill
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 書いた学びが文章の lint に当たり、学びを入れる commit が止まった

## 事象

`kaizen extract --current --record-pending` で書いた学びを commit すると、pre-commit の文章の lint（lint-prose）が、1 文が 150 字を超えるとして止めた。
抽出の手順どおり整形のコマンド（markdownlint-cli2 --fix）は通していたが、文の長さは整形では直らない。

## 根本原因

- なぜ止まったか: 学びの 1 文が、文章の lint の上限を超えていた。
- なぜ書いた時点で気付かなかったか: kaizen の `references/extract.md` の手順 7 は、書いた記録に整形のコマンドを当てるとだけ定めている。整形では直らない lint（文の長さ・使わない語）を、commit の前に当てる段が無い。
- なぜその段が無いか: 手順 7 は、記録が次の commit の書式の検査に当たることへの対策として書かれ、書式を自動で直すコマンドだけを想定していた。

## 根拠

1 回の観測だが、止めたのが lint-prose の文の長さの規則だと出力で確かめたので medium とする。
文を 2 つに分けると、同じ commit が通った。
KEDB 照合は「lint-prose」と「.kaizen」で行い、一致したのは Issue の番号が行頭に来る別の学び（2026-10-17-issue-number-at-line-start-becomes-heading.md）だけで、原因は違った。

## 提案

学びを書いたら、整形のコマンドに加えて、そのリポジトリが commit の前に当てる文章の lint も書いた記録に当て、通してから commit する。

- kaizen の `references/extract.md` の手順 7 の「整形のコマンドを通す」に、自動で直らない lint（文章の lint など）も当てて直すことを足す。
- 機構は作らない。pre-commit がその場で止めて理由を示すので、手順の追記で足りる。
