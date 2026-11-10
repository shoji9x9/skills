# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #918 の 1 の変更確認である。
`decision_policy_doc` を設定した fixture で、PR を作る前の仮の決定にプロジェクトの基準を当てる場面を、eval 20 として足した。
設定と文書がベースブランチと同じ状況・作業ブランチが文書を変えた状況・ベースブランチを取得できない状況の 3 つを、1 つの prompt で問う。

## 入力の変更

- eval 20 を足した。`requires_skills` に `pr-finalize-loop` を置き、`review-response.md` の「PR がまだ無いとき」を読める状態にする
- fixture `decision-policy-doc` を足した。`common.jsonc` の `decision_policy_doc` が `docs/decision-policy.md` を指し、文書は migration を足す変更を担当者に確認すると定める

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 20 | 7/7 | 3/7 |

## 前回より下がったものと、その原因

- 無し（eval 20 は新規なので、比べる記録は無い）

## 気付いたこと

- without_skill は、状況 b でベースブランチの文書に従って状況 a と同じに扱い、状況 c でも migration だけを確かめた。2 つの決定をすべて利用者に確認することはしなかった。
- without_skill は、状況 a で担当者の返事を待たずに migration を実装して PR を作ると答えた。節の名前も「仮に決めたこと」ではなかった。
- 差が出たのは、状況 b・状況 c の扱い・確認と実装の順序・節の名前の 4 本である。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
