# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #889 の変更確認である。PR #896 で、実装の途中で仮に決めたことを PR の本文の「仮に決めたこと」の節に記録し、人に回す決定は PR を作る前に確認する取り決めを足した。
節の形と、元に戻せない決定を PR の前に確認するかを確かめる eval 18 を足して実行した。
この結果は e6f18623 の規則で取った。

## 入力の変更

- eval 18 を足した（prompt・assertion とも新規）

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 18 | 4/4 | 1/4 |

## 前回より下がったものと、その原因

- 無し（eval 18 は新規なので、比べる記録は無い）

## 気付いたこと

- with_skill の sandbox には `pr-finalize-loop` と `pr-review-handle` が無いので、人に回す基準を読めず、取り決めどおり 2 つの選択をすべて利用者に確認した。基準を読める場合の振り分け（文字コードの選択は人に回さない）は、この eval では確かめていない。
- without_skill は、通知の設定を「マージ前に判断が必要」として PR の本文に書くだけで、PR を作る前には確認しなかった。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
