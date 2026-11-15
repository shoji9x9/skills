# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-15
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1041 のレビューで、eval 30 の「今の HEAD にレビューが付いていなければ再レビューを依頼する」が、依頼済みで進行中なら待つという正しい答えを落としうると指摘された。
assertion を「再レビューを依頼する（依頼済みで進行中なら、重ねて依頼せずに完了を待つ）」に変えたので、変更確認として 1 run ずつ実行した。
あわせて `SKILL.md`・`references/review-request.md`・`references/review-status.md` の、HEAD の SHA が未レビューのときの記述を揃えた。

## Summary

| config | 今回 | 前回（iteration-26、3 run） |
|------|------|------|
| with_skill | 8/8 | 8/8・8/8・8/8 |
| without_skill | 4/8 | 4/8・4/8・4/8 |

変えた assertion は文が変わったので、前回とは比べない。今回は with_skill・without_skill とも pass した。
文が同じ 7 本は、前回と同じ結果だった。without_skill は、止まった理由の語・読まれていない返信の URL（2 本）・未レビューならこの理由で止まらない、の 4 本で fail した。

## 実行し直した run

無し。

## 集計から外したもの

無し。2 run とも `sandboxed` で、`invalid_run` は無い。without_skill の汚染の判定は `clean` である。
