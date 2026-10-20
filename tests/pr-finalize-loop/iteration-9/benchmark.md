# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-19
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #697 で、`--defer-decisions` で判断待ちにするかを、利用者への影響の大きさと merge の後に覆せるかで決めるようにした。
影響が小さく覆せる指摘は推奨の案で進め、残りを別の Issue に回してよい場合の基準を書いた。
レビューの指摘だけが残って段階の回数を使い切ったら、effort を 1 段下げて半分の回数を反復する「反復の段階と effort」を足した。

入力が変わったのは、新しく足した eval 22 だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 22 | 新規 | 7/7 | 3/7 | 無し |

without_skill は、影響の小さいスレッド A を自分で決めて解決し、影響と覆せるかで分ける判断も自力で書いた。
判断待ちの印を残すことと、effort を下げて反復を足すこと（medium 2 回 → low 1 回 → 最大反復到達）は書かなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
