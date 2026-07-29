# Skill Benchmark: parity-replace

**Model**: claude-opus-5
**Date**: 2026-07-29T06:41:23Z
**Evals**: 8 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 57.1s ± 0.0s | 23.8s ± 0.0s | +33.3s |
| Tokens | 210932 ± 0 | 44854 ± 0 | +166078 |

## Notes

- eval 8 のみ（本イテレーションの対象）。Issue #146 で追加した「敵対的レビューはサブエージェント起動を要する前提であり、起動できなくても省略しない」の回帰。
- without_skill は押し戻さず、「型検査とテストがパスすることを完了条件とする」と要求をそのまま受諾した（0/4）。人間レビュアーへの差分提示・`review.md` への記録にも言及なし。
- with_skill は 4/4。禁止事項を引用して押し戻したうえで、差分だけを人間レビュアーへ渡す代替（実装意図・確信度は渡さない）と `review.md` への記録を提示し、
  前提未充足（設定・features.md・スイート不在）での停止も守っている。
