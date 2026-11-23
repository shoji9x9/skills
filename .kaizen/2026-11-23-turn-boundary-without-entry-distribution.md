---
date: 2026-11-23
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# transcript のターンの境界を、user のエントリの種類を全件で数えずに決めた

## 事象

Issue #1121 で、Stop の Hook が transcript から最後のターンの途中報告を読む処理を書いた。
ターンの境界（人の発言）は、type が user で、isMeta でなく、tool_result を含まないエントリとした。
確かめたのは、Hook のフィードバックが isMeta になることと、ツールの結果が tool_result になることだけだった。
push の前の code-review が、自動の compact の要約（isCompactSummary）も同じ条件に当たり、ターンの途中で境界を移すと指摘した。英語の途中報告をそのまま通す誤りで、テストを足して直した。

## 根本原因

- なぜ要約を境界にしたか: 境界の条件を、知っている種類のエントリ（Hook のフィードバック・ツールの結果）が外れるかだけで確かめた
- なぜ知っている種類だけを見たか: user のエントリを、全件で欄（isMeta・isCompactSummary・isSidechain・content の型）ごとに数えなかった。忘却した学び（2026-10-16-midturn-text-language-unchecked.md）が挙げた種類と、grep で当たった種類だけを確かめ、ほかの種類は無いとみなした
- なぜ数えなかったか: AGENTS.md「確かめ方」は、ログの欄の意味を全件で値の分布を数えてから述べると求めている。挙がった種類を確かめた時点で足りると考え、規約を当てる場面だと気付かなかった

## 根拠

確信度は medium。このセッションで 1 回観測し、原因は境界の条件を決めた手順の 1 つに絞れる。
KEDB 照合（「境界」「transcript」「isCompactSummary」）で一致したのは .kaizen/2026-10-16-midturn-text-language-unchecked.md（forgotten）だけである。この学びは境界の見分け方を決めることを求めていたが、要約は挙げていなかった。

## 既存の規約

- 扱い: 明確
- 場所: AGENTS.md「確かめ方」（ログや API のフィールドの意味は、全件で値の分布を数えてから述べる）、docs/agent-workflow.md「確かめ方」
- 照合した範囲: AGENTS.md・docs/agent-workflow.md を「全件で値の分布」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

AGENTS.md「確かめ方」の全件の分布を数える箇条に、「既に挙がった種類を確かめたので足りる」という言い訳への反論を足す。

- 言い訳: 「指摘や記録に挙がった種類（Hook のフィードバック・ツールの結果）が外れることは確かめたので、境界の条件は決まる」
- 従う理由: 挙がった種類は、見つかったものの一覧であって、全部の一覧ではない。条件に使う欄（isMeta・isCompactSummary・isSidechain など）ごとに全件で数えれば、挙がっていない種類（compact の要約）が 1 回で見つかる
