---
date: 2026-09-27
type: doc
priority: low
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

## 根本原因

- なぜ FAIL? 変異ごとの `expect_failing` は「その時点のテスト集合」で落ちるテストの一覧で、テストを足すと既存変異の落ちる集合が広がる
- なぜ気付かなかった? 追加した変異の id だけを `--only` で測り、既存変異を測り直さなかった
- なぜ? 規約（`.agents/rules/state-space-and-mutation-proof.md` §5）は「assertion を書き換えたら取り直す」とだけ書き、テストの追加を取り直しの契機に数えていない

## 提案

テストファイルにテストを足したら、その test_file を持つ宣言は --only で絞らず全件を取り直す（追加したテストが既存の変異を検出すると expect_failing の外で落ちる）。

- `.agents/rules/state-space-and-mutation-proof.md` §5 の「assertion を書き換えたら〜」に「テストを足したとき」も含める
- CI の `--changed-since` は test_file の変更で全件を測るので最終的には捕まる（手元での手戻りを減らす規律）
