# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #866 の 7 回目のレビュー（medium）を受けて、スキル作成手順 2 を直した。
コピーは作業ツリーの外に作る。環境との違いに commit していない変更と依存・信頼の設定を足す。利用者のレベルの同じ振る舞いのスキルを残すと決めたら「スキルは要らない」とは判断しない。
作り方・環境との違い・片付けのうち、依頼で決まっていないものだけを確かめる。
eval 1 と eval 8 の prompt に、コピーの作り方・環境との違いの扱い・片付けを決めた文を入れた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | prompt に文を追加・スキル本文 | 4/4 | 2/4 | 比べない（prompt を変えたので） |
| 8 | prompt に文を追加・スキル本文 | 3/3 | 1/3 | 比べない（prompt を変えたので） |

eval 1 の without_skill は、skill-creator の流れでスキルの有無を比べたので、比べた結果を示す assertion を満たした。置き場所とリンクの 2 本は満たさなかった。
eval 8 の with_skill は、スキル無しの 3 回すべてで日本語で答えたので、スキルを書かずに止まった。利用者の `~/.claude/CLAUDE.md` の設定が影響した可能性も述べている。

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
