# Skill Benchmark: parity-suite

**Model**: claude-opus-4-8
**Date**: 2026-07-18T00:28:32Z
**Evals**: 1, 2, 3, 4, 5 (1 run each per configuration)

## Summary

| Metric | With Skill | Config B | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 51.9s ± 6.7s | 0.0s ± 0.0s | +51.9s |
| Tokens | 14421 ± 1062 | 0 ± 0 | +14421 |

> 注: 軽量方式（with_skill のみ・各 eval 1 run）。baseline (without_skill) は省略しており、Config B / Delta 列は参考にならない。方式の根拠は benchmark.json の methodology を参照。
>
> iteration-1（レビュー反映前）比: eval-4 が 1/3 → 3/3 に改善し、全体 pass rate 0.867 → 1.0。iteration-2 は code-review 指摘反映後の再測定。
