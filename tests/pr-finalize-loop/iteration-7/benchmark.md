# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #681 で、残っている反復の回数が少ないことを理由に妥当な指摘を見送らないことと、直さない根拠にしてよい 3 つを閉じた一覧で手順 4 の 2 に書いた。
これを測る eval 21 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 21 | 新規 | 6/6 | 3/6 |

## 備考

- PR のレビューの指摘を受けて、prompt に `review_tool` を足し、2 つの主張を持つ assertion を分けた。
- 「最大反復到達」の行の書き換えは、Issue が既存の扱いとしている範囲を超えたので元の版に戻し、対応する assertion（未レビューの HEAD の報告）も外した。
  そのうえで、最後の版の SKILL.md と eval 21 で、with_skill と without_skill をやり直した。
