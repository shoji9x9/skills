# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #681 で、残っている反復の回数が少ないことを理由に妥当な指摘を見送らないことと、直さない根拠にしてよい 3 つを閉じた一覧で手順 4 の 2 に書いた。
停止条件の表の「最大反復到達」の行には、止まった時点の HEAD が未レビューならそのことを、その HEAD の CI が終わっていなければそのことを書く 1 文を足した。
これらを測る eval 21 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 21 | 新規 | 7/7 | 4/7 |

## 備考

- PR のレビューの指摘を受けて、prompt に `review_tool` を足し、2 つの主張を持つ assertion を分けた。
- 「最大反復到達」の行の書き換えは、レビューで場合分けの抜けを指摘され続けたので一度元の版に戻し、対応する assertion（未レビューの HEAD の報告）も外した。
- PR #693 の判断で、行に 1 文だけ足す案（A）に決まった。外した assertion と prompt の問い（何を報告するか）を戻し、最後の版の SKILL.md と eval 21 で、with_skill と without_skill をやり直した。
- 未レビューの HEAD の報告の assertion は、場面の説明から推測できるので without_skill も pass する。報告から未レビューの記述が消えた後退を検出するために置く。
- 範囲の書き方の例に「変えた設定を読むテスト」を足した変更は、d6946dc8 に含まれる。eval 21 の入力には関わらない。
