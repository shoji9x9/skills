# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #901 で書き直した eval 3 の fixture を替えたので、変更確認として両方の configuration を実行した。

## 入力の変更

eval 3 の prompt は、スレッド A の方針がリポジトリの `docs/retry.md` に書かれていると述べる。iteration-20 の fixture（`review-tool-copilot`）には、その文書が無かった。
文書を読みに行った run は、方針が見つからず、調べても決まらないとしてスレッド A を人に回しうる。
`docs/retry.md`（再試行の間隔を指数的に延ばす方針）を置いた fixture（`retry-policy-doc`）に替えた。prompt と assertion は変えていない。

## Summary

| eval | with_skill | without_skill |
|------|------------|---------------|
| 3（人に回すかを基準で決める） | 7/7 | 6/7 |

## 前回より下がったものと、その原因

無し。iteration-20 と同じ結果になった。

## 気付いたこと

差が出たのは「利用者の答えを反映した後も、ループを打ち切らずに収束まで続ける」の 1 本だけで、without_skill は判断待ちとしてループを止めるとした。
残りの 6 本は、prompt の場面（取り消せないメール、方針を書いた文書）から一般の判断で答えられるので、後退の検出のための assertion である（`evals/pr-finalize-loop/README.md`）。

## 実行し直した run

無し。

## 集計から外したもの

無し。
