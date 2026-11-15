# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-15
**Evals**: 1（`with_skill` を 3 run）

## 目的

Issue #1033 で、`SKILL.md` の停止条件の表（行の追加と「最大反復到達」の行の括弧）と「反復の段階と effort」を変えた。
最後の反復で止まり方を問う eval 21 が変わらないかを、3 run で確かめる。prompt・fixture・assertion は変えていない。
iteration-25 で、同じ assertion の 1 run が fail していたので、1 run どうしでなく 3 run で見る。

## Summary

| run | 結果 |
|------|------|
| run-1 | 7/7 |
| run-2 | 6/7 |
| run-3 | 7/7 |

run-2 は「指摘を直さずに見送ってよい根拠を、4 つに限ると述べている」が fail した。
「4 つがどれも当てはまりません」と書いたが、挙げたのは 3 つで、「基準で人に回さないと決まって推奨の案で見送った」が抜けた。iteration-25 の fail と同じ形である。
今回の変更は見送りの根拠の節を変えていない。この assertion は run-1 と run-3 で pass し、iteration-22 の 1 run でも pass している。
前回のどの記録でも pass した assertion が 3 run すべてで fail したものは無いので、下がったとは扱わない。

## 実行し直した run

無し。

## 集計から外したもの

無し。すべての run は `sandboxed` で、`invalid_run` は無い。
