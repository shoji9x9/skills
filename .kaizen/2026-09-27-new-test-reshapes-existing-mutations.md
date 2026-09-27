---
date: 2026-09-27
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# テストを足したら、同じテストファイルの変異は --only で絞らず全件取り直す

## 事象

`scripts/capture-scope-check.test.js` にテストを足した後、新しい変異だけを
`check-mutation-proof.js --only <新 id>` で実証して済ませた。宣言ファイル全件を回すと、
既存・別の変異 3 件が「宣言外で落ちた」で FAIL した
（後から足したテンプレートのテスト・全ページ `not_applicable` のテストが既存の変異も検出したため）。2 回繰り返した。

再発（同日・PR #491 のレビュー対応）: Codex 指摘に対応するテスト 3 件を足した直後、新しい判定（`display-axis-variant-no-pages`）が
既存テスト「全ページ `not_applicable`」の期待値（findings の完全一致）も変え、基準 run が赤くなった（mutation-proof exit 2）。
直した後も既存の変異 4 件の `expect_failing` が増減して FAIL した。テストの追加だけでなく**判定の追加**でも、
既存の変異・既存テストの期待値が動く。

## 根本原因

- なぜ FAIL? 変異ごとの `expect_failing` は「その時点のテスト集合」で落ちるテストの一覧で、テストを足すと既存変異の落ちる集合が広がる
- なぜ気付かなかった? 追加した変異の id だけを `--only` で測り、既存変異を測り直さなかった
- なぜ? 規約（`.agents/rules/state-space-and-mutation-proof.md` §5）は「assertion を書き換えたら取り直す」とだけ書き、テストの追加を取り直しの契機に数えていない

## 提案

テストファイルにテストを足したら、その test_file を持つ宣言は --only で絞らず全件を取り直す（追加したテストが既存の変異を検出すると expect_failing の外で落ちる）。

- `.agents/rules/state-space-and-mutation-proof.md` §5 の「assertion を書き換えたら〜」に「テストを足したとき」も含める
- 判定（finding）を足したときも同じ: 既存テストの `toEqual` の期待値と、既存変異の `expect_failing` が動く。`--only` で絞らず宣言ファイル全件を取り直す
- CI の `--changed-since` は test_file の変更で全件を測るので最終的には捕まる（手元での手戻りを減らす規律）
