# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #901 の変更確認である。
PR #895 で人に回すかの基準を `references/review-response.md` にまとめたが、eval 3 の文言は「コードだけでは判断できない」のままで、基準と食い違っていた。
eval 3 を基準に合わせて書き換え、`decision_policy_doc` から基準の文書を読む分岐を確かめる eval 26 を足して実行した。

## 入力の変更

- eval 3 の prompt・expected_output・assertion を書き換え、`reachability` を足した。実在の PR を前提にする形から、場面を書いて説明させる形に変え、fixture `review-tool-copilot` を付けた
- eval 26 を足した。fixture `decision-policy-doc` に、`decision_policy_doc` の設定と、プロキシの設定の変更を担当者に確認するとした文書を置く

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 3 | 7/7 | 6/7 |
| 26 | 6/6 | 4/6 |

## 前回より下がったものと、その原因

- 無し。eval 3 は assertion の文をすべて変えたので、前回の記録と比べない。eval 26 は新規なので、比べる記録は無い

## 気付いたこと

- eval 3 の without_skill は、調べて決まる設計の判断を人に回さず、取り消せないメールを人に回すところまで自力で答えた。
  差が出たのは「答えを反映した後もループを打ち切らずに続ける」の 1 本だけで、without_skill は判断待ちでループを止めて報告すると答えた。
  残りの 6 本は後退の検出のために置く（`evals/pr-finalize-loop/README.md` に書いた）。
- eval 26 の without_skill は、`common.jsonc` から文書の場所を読み、プロキシの設定の変更を人に回すところまで答えた。
  PR が設定と文書を変えていないことを確かめる工程と、base branch の commit から読む工程は答えなかった。この 2 本で差が出た。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
