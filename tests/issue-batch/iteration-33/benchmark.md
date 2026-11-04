# Skill Benchmark: issue-batch

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #889 の変更確認である。PR #896 で、run manifest の `self_decisions` のうち解釈・値・形を選んだ項目を、各 Issue の PR の本文の「仮に決めたこと」の節に書く取り決めを足した。
どの項目を節に載せ、どれを最終報告にだけ載せるかを確かめる eval 33 を足して実行した。
この結果は e6f18623 の規則で取った。

## 入力の変更

- eval 33 を足した（prompt・assertion とも新規）

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 33 | 4/4 | 3/4 |

## 前回より下がったものと、その原因

- 無し（eval 33 は新規なので、比べる記録は無い）

## 気付いたこと

- without_skill は、Issue の番号で絞ることと #141 の項目を除くことは自力で答えたが、反復の上限で直さなかった指摘も節に載せた。区別できたのはこの 1 本である。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
