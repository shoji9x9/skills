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

`scripts/skills/parity-suite/capture-scope-check.test.js` にテストを足した後、新しい変異だけを
`check-mutation-proof.js --only <新 id>` で実証して済ませた。宣言ファイル全件を回すと、
既存・別の変異 3 件が「宣言外で落ちた」で FAIL した
（後から足したテンプレートのテスト・全ページ `not_applicable` のテストが既存の変異も検出したため）。2 回繰り返した。

再発（同日・PR #491 のレビュー対応）: Codex 指摘に対応するテスト 3 件を足した直後、新しい判定（`display-axis-variant-no-pages`）が
既存テスト「全ページ `not_applicable`」の期待値（findings の完全一致）も変え、基準 run が赤くなった（mutation-proof exit 2）。
直した後も既存の変異 4 件の `expect_failing` が増減して FAIL した。テストの追加だけでなく**判定の追加**でも、
既存の変異・既存テストの期待値が動く。

再発（2026-09-28・Issue #500）: `reaction-check.test.js` にテストを足した後、手元で全件を取り直すつもりで
`check-mutation-proof.js --changed-since origin/main` を実行した。未コミットの変更は `git diff <ref>...HEAD` に入らないため
「この差分に当たる宣言は無い」で exit 0 になり、1 件も測らずに終わった（出力を読んで気づき、全 id を `--only` で渡して取り直した）。
全件では 5 件が「宣言外で落ちた」で FAIL し、追加テストが既存変異を検出していた（本ノートの事象そのもの）。

## 根本原因

- なぜ FAIL? 変異ごとの `expect_failing` は「その時点のテスト集合」で落ちるテストの一覧で、テストを足すと既存変異の落ちる集合が広がる
- なぜ気付かなかった? 追加した変異の id だけを `--only` で測り、既存変異を測り直さなかった
- なぜ? 規約（`.agents/rules/state-space-and-mutation-proof.md` §5）は「assertion を書き換えたら取り直す」とだけ書き、テストの追加を取り直しの契機に数えていない
- なぜ手元の全件が 0 件? `--changed-since` は commit 済みの差分（`ref...HEAD`）だけを見る
- なぜ使った? 規律は「全件を取り直す」だけで、手元での全件の測り方（宣言ファイルを位置引数で渡す）が書かれていない
- なぜ気づきにくい? 0 件選択が exit 0 で、合格と「何も測っていない」が同じ終了コードになる

## 提案

テストファイルにテストを足したら、その test_file を持つ宣言は --only で絞らず全件を取り直す（追加したテストが既存の変異を検出すると expect_failing の外で落ちる）。

- `.agents/rules/state-space-and-mutation-proof.md` §5 の「assertion を書き換えたら〜」に「テストを足したとき」も含める
- 判定（finding）を足したときも同じ: 既存テストの `toEqual` の期待値と、既存変異の `expect_failing` が動く。`--only` で絞らず宣言ファイル全件を取り直す
- CI の `--changed-since` は test_file の変更で全件を測るので最終的には捕まる（手元での手戻りを減らす規律）
- 手元での全件は `node scripts/mutation/check-mutation-proof.js scripts/<name>.mutations.json`（宣言ファイルを位置引数）で取る。`--changed-since` は commit 前の手元では使わない
- 実行器側: `--changed-since` で作業ツリーに未コミットの変更がある場合は警告を出す（または未コミット分も差分に含める）。0 件選択を exit 0 の合格と区別できる出力にする
