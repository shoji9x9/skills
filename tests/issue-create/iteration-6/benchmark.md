# Skill Benchmark: issue-create

**Model**: opus（claude-code）
**Evals**: 10（PR #943 のレビューの指摘で `references/parent.md` と 4 つ目の assertion を直した後の変更確認。configuration ごとに 1 run）

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% | 100% | +0.00 |
| Time | 42.8s | 35.5s | +7.3s |
| Tokens | 109286 | 110485 | -1199 |

| eval | with_skill | without_skill |
|------|------------|---------------|
| 10（作った Issue を既存の Issue の sub-issue にする） | 5/5 | 5/5 |

## 前回の記録との比べ方

比べる記録は `iteration-5` である。4 つ目の assertion は文を変えたので比べない。
文が同じ残りの 4 つは、with_skill・without_skill とも前回と同じく満たした。

## 差が出なかった項目

without_skill も、REST の `sub_issues` に Issue の `id` を渡し、紐付ける前に親を確かめ、別の親を置き換えなかった。
紐付けた後は、親の sub-issue の一覧で確かめた。直した 4 つ目の assertion はこの方法も通す。
eval 10 は、手順を消したり変えたりしたときの後退の検出のために置く。
