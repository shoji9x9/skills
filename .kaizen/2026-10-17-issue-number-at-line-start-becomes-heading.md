---
date: 2026-10-17
type: doc
priority: high
status: pending
applied-to: []
session: claude-code
---

# Markdown の行を Issue の番号（`#` と数字）で書き始めない

## 事象

同じセッションで 2 回、Markdown の段落の行を「#633 の…」「#632 で…」のように Issue の番号で書き始めた。
1 回目は PR の本文で、markdownlint の自動修正が見出し（`# 633`）に書き換えた。
2 回目は `.kaizen/` の学びで、pre-commit の markdownlint が MD022・MD025・MD026 で commit を止めた。

### 2026-10-18 の再発（Issue #625: kaizen の学びの本文）

kaizen の学びの「## 事象」の段落を「#625 で、…」で書き始め、整形のために `markdownlint-cli2 --fix` を当てた。
`--fix` は警告を出さずに行を見出し（`# 625 で、…`）に書き換え、その後の検査が MD022・MD025・MD026 で失敗した。
同じ学びが pending のまま注入されていたが、書くときに当てなかった。

## 根本原因

- なぜ見出しになったか → 行頭の `#` の後に空白が無くても、markdownlint の `--fix` は空白を足して ATX 見出しにする（MD018）
- なぜ繰り返したか → 1 回目は言い換えて直しただけで、書き方の規約として残さなかった
- なぜ書く時点で気づかないか → 文として読むと自然で、Markdown の構文としての意味が見えない
- なぜ 3 回目が起きたか → 規約は pending の提案のままで、書く時点で機械が止めない。`--fix` は書き換えを報告しないので、検査が失敗するまで気づかない

## 提案

Markdown の行頭の `#` と数字（`#625`）を、`--fix` の前に検出して止める lint（textlint の規則か lefthook の検査）を足す。

- 書き方は「Issue #632 の作業で…」のように語を前に置く
- 適用先候補: `scripts/gates/prose/lint-prose.ts`（textlint）。markdownlint の `--fix` より前に実行される検査にする
- 横断: commit message と Issue のタイトルは Markdown として整形されないので対象外
