# Skill Benchmark: current-environment-bootstrap

**Model**: codex default (not reported by CLI)
**Date**: 2026-09-08T11:02:06Z
**Evals**: 6 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 33% ± 14% | +0.67 |
| Time | 193.4s ± 16.6s | 150.6s ± 0.9s | +42.8s |
| Tokens | 592 ± 103 | 467 ± 117 | +125 |

## Analyst observations

- With-skill は 3 ランすべて 4/4、without-skill は 25%、50%、25% だった。
- CoE／ベンダー窓口への依頼と被覆表の資料不足は、baseline も一部のランで自力に到達した。
- 3 種のベンダー資料の個別分類と、`app-ui` を代替受領資産として扱わない判断は、with-skill 3/3 pass、without-skill 0/3 pass で安定して弁別した。
- Without-skill は 3 ランすべて `app-ui` を観測範囲の代替資産として認め、スキル契約と反対の結論を出した。
