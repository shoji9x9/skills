# Skill Benchmark: parity-suite

**Model**: claude-opus-5
**Date**: 2026-09-24
**Evals**: 43 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% | 60% | +0.40 |
| Time | 118.8s | 69.2s | +49.5s |
| Tokens | 212654 | 64652 | +148002 |

## Notes

- 変更確認スコープ（新設の eval 43・44 を with_skill / without_skill 各 1 run）。1 run なので Delta の数値は語らず、弁別が残っているかだけを見る。executor claude-code / claude-opus-5 / effort high。
- eval 43（Issue #450 の停止条件）: with_skill 5/5、without_skill 3/5。without_skill は、環境の都合で別オリジンになっていることには到達した。
  一方で根拠欄に未確認の観測を書く例文を示し、照合を通せる形を残した（矛盾する出力として fail）。差分器が「無い」同士を一致させる点にも触れなかった。
- eval 44（Issue #449）はこの iteration から外した。with_skill の 2 run がどちらも `skill_usage.invalid_run: true` になったため。
  raw では `cd <スキル> && find …` の後に、相対パスの `cat SKILL.md` / `grep … references/baseline.md` でスキルを読んでいる。
  回答も SKILL.md・baseline.md の行番号を引いており、読まなかった run ではない（判定器が `cd` 後の相対パスを読み取りに数えない取りこぼし）。
  参考採点は with_skill 6/6 × 2、without_skill 3/6。判定器を直したら（Issue #455）判定し直して benchmark に戻す。
