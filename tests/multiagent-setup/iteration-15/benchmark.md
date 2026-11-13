# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus、reasoning effort high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 1（`with_skill` を 1 run）

## 何を変えたか

Issue #1005 で、`SKILL.md` の基本原則に、プロジェクトの `.codex/` を対象に含むことと、そこに書くのは Hooks の設定だけであることを書いた。
eval の入力（prompt・fixture・assertion）は変えていない。エージェントが読む文書を変えたので、Codex を対象に含む eval 2 を `with_skill` で実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 2 | なし | 4/4 | iteration-14（4/4） |

文が同じ assertion で、前回満たして今回満たさなかったものは無い。
前回の記録は reasoning effort を指定していない run で、今回は high を指定した。

run は `.codex/` を作らず、Hooks を作るときは `.claude/settings.json` と `.codex/hooks.json` の両方に登録すると案内した。基本原則に書いた扱いと合っている。

## 実行し直した run

なし。
