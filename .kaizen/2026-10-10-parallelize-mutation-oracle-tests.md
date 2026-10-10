---
date: 2026-10-10
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# ミューテーションテストの判定に使うテストを並列化するときは、変異が起こす副作用まで隔離する

## 事象

check-mutation-proof.test.js を describe.concurrent にした後、ランナーの宣言の全件で CHILD-GUARD が 2 回続けて「宣言外で落ちた」になった。
変異が子の vitest の globalSetup の掃除を有効にし、並んで実行中の他のテストの fixture を消した。
1 回目の対策では e2e を最後の describe.concurrent に移したが、concurrent な suite は隣の suite とも並ぶので直らなかった。全件の再実行（約 4 分）を 2 回失った。

## 根本原因

- なぜ落ちた: 変異が、通常の実行では起きない共有資源への副作用（fixture の掃除）を起こした
- なぜ見落とした: 並列化で隔離したのは通常の実行が触る状態（ロック・復元情報・fixture）だけで、各変異が触りうる共有資源を列挙しなかった
- なぜ 2 回目も: 「最上位の describe は順に実行される」をツールの仕様で確かめずに順序の前提にした

## 提案

ミューテーションテストの判定に使うテストファイルを並列化するときは、各変異が起こしうる共有資源への副作用（掃除・実ファイルの書き換え・ロック）を列挙して隔離し、並びの範囲をツールの仕様と実測で確かめてから順序に頼る。

- 置き場所: .agents/rules/state-space-and-mutation-proof.md の §5 に 1 項目足す
- 並列化の後は、その test_file を持つ宣言を --only で絞らずに全件実行し直す（既存の規約の適用範囲に並列化も含める）
