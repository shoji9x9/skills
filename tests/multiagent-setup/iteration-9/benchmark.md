# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #866 の 3 回目のレビューを受けて、スキル作成手順のコピーの作り方を、コマンドではなく満たす条件（同じ初期状態・利用者と同じ前提・スキルが無いこと）で書く形にした。
4 の追加の実行で起きない項目が出たときもやり直しに数え、`skill-creator` が無くても確認を飛ばさない文を手順 4 に戻した。
eval 1 の期待する振る舞いを、スキル無しでは起きにくいもの（整形の前に対象の一覧を示して承認を待つ）に変えた。
eval 9 から、without_skill も満たす assertion を外した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | prompt の書き換え・スキル本文 | 4/4 | 1/4 | 比べない（prompt を変えたので） |
| 9 | assertion の削除・スキル本文 | 2/2 | 0/2 | 2/2（iteration-8。文が同じ 2 本） |

eval 1 の with_skill は、スキル無しの 3 回のうち 2 回で手でファイルを書き換えたことを確かめてからスキルを書き、スキル有りの 3 回すべてで期待する振る舞いが起きることを確かめて、SKILL.md とリンクを作った。

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
