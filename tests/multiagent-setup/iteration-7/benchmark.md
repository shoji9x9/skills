# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

iteration-6 の eval 1 で、with_skill が期待する振る舞いを自分で決め、スキル無しでも取る振る舞いを選んで、スキルを作らずに止まった。
スキル作成手順の 1 に、依頼に期待する振る舞いが書かれていなければ利用者に確かめる文を足した。
eval 1 の assertion を、利用者に確かめる場合と、スキルの有無で比べてから作る場合の両方を合格にする形に変えた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | assertion の書き換え・スキル本文 | 4/4 | 1/4 | 比べない（assertion の文を変えたので） |

with_skill は、非対話の環境で利用者に確かめられないことを明示したうえで、期待する振る舞いを 3 項目決めた。
スキル無しで 1 項目（実行できないときに手で整形しない）が起きなかったので、その指示を書き、スキルを入れた状態で 3 項目すべてが起きることを確かめた。

## 前回より下がった eval の切り分け

- 無し（assertion の文を変えたので、前回と比べない）

## 集計から外したもの

- 無し
