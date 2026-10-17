# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #681 で、反復の回数の残りを理由に妥当な指摘を見送らないことと、直さない根拠にしてよい 3 つを閉じた一覧で手順 4 の 2 に書いた。
これを測る eval 21 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 21 | 新規 | 7/7 | 4/7 |

## 備考

- PR を作る前のレビューの指摘で、prompt に `review_tool` を足し、2 つの主張を持つ assertion を分けて、eval 21 をやり直した。
- without_skill は、最後の反復でも直すことは自力で答えたが、直さない根拠を 3 つに限ること、この指摘がどれにも当たらないこと、「最大反復到達」の語は満たさなかった。
