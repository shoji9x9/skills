# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #866 の 4 回目のレビューを受けて、スキル作成手順のコピーの条件を直した。
コピーは作業ツリーの外に置き、前提には commit していない変更を含む読むファイルと信頼の設定の例を書いた。
利用者のレベルに同じ名前のスキルがあれば、消さずに利用者に確かめる。
eval 9 に、止まると言いながら比べる実行に進む食い違いが無いことを見る assertion を戻した（後退の検出用で、Delta には寄与しない）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 9 | assertion の追加・スキル本文 | 3/3 | 1/3 | 2/2（iteration-9。文が同じ 2 本はどちらも pass のまま） |

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
