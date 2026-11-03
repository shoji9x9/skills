# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #866 の 6 回目のレビュー（medium）を受け、利用者と相談して、スキル作成手順 2 のコピーの条件を書き足すのをやめた。
コピーを作る前に、作り方・利用者の環境との違い・片付けの方法を利用者に示して確かめ、依頼で既に決まっていれば確かめ直さない形にした。
eval 1 の prompt に、コピーの作り方と片付けを利用者が決めた文を足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | prompt に文を追加・スキル本文 | 4/4 | 1/4 | 比べない（prompt を変えたので） |

with_skill は、prompt で決まった作り方（毎回 `mktemp -d` で試験用のプロジェクトを作り直す）で、スキル無しで項目が起きないことを確かめてから SKILL.md とリンクを作り、スキル有りの 3 回すべてで項目が起きることを確かめた。
without_skill の最後の応答は、バックグラウンドの処理の報告だけだった。

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
