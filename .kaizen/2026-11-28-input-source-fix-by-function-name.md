---
date: 2026-11-28
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 入力を読む場所の指摘は、指摘された関数ではなく、チェックが読むすべての入力で直す

## 事象

PR #1159 で、Copilot は 3 回続けて、`check-eval-split.ts` が作業ツリーから読む入力を指摘した（`evals.json`、スキルのディレクトリ、共通のコピーの台帳の順）。
エージェントは 1 回目を直した後に同じ形を探したが、探す鍵は関数名（`readStagedOrWorking`）だった。
そのため `statSync` と `loadGroups` を見つけられず、指摘 1 件ごとに再レビューを 1 往復待った。

## 根本原因

- なぜ残ったか: 指摘を「作業ツリーから読む入力」として一般化せず、指摘された関数を呼ぶ箇所だけを grep した
- なぜ関数名で探したか: `state-space-and-mutation-proof.md` §6 は「誤りの種類として一般化して grep する」と書くが、種類を何で表すかは書いていない。エージェントは、指摘された実装を探す鍵にした
- なぜ種類を表す指示が要るか: 入力を読む場所の誤りは、読む方法（`readFileSync`・`statSync`・別のモジュールの読み込み関数）の数だけ形があり、1 つの関数名では全部に当たらない

## 根拠

確信度は medium である。根拠はこのセッションの 1 回の観測で、3 回の指摘とそれぞれの修正の commit（589f86de・2af98ae5・この学びの後の commit）が残っている。
KEDB 照合（「作業ツリー」「check-eval-split」「レビュー」「同じ形」）は、どれも一致しなかった。
近い学びに `.kaizen/2026-10-18-regex-boundary-review-churn.md`（forgotten）がある。レビューの指摘ごとに 1 方向ずつ直して反復を使った、という同じ形である。

## 既存の規約

- 扱い: 明確
- 場所: `.agents/rules/state-space-and-mutation-proof.md`「6. レビューの指摘は、同じ種類の誤りをまとめて探す」
- 照合した範囲: `.agents/rules/`・`docs/agent-workflow.md`・`.kaizen/` を「同じ種類」「まとめて探す」「同じ形」で検索した
- 守られなかった理由: 規約に、誤りの種類を入力の単位で数える指示が無かった

## 食い違い

- 相手: なし

## 提案

チェックが入力を読む場所（index・作業ツリー・環境）を指摘されたら、そのチェックが読むすべての入力（fs と git の読み取り・別のモジュールの読み込み関数）を一覧にし、読む場所をそろえてから返信する。

- 適用先: `.agents/rules/state-space-and-mutation-proof.md` §6 の箇条に 1 文足す
