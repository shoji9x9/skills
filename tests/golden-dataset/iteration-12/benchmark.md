# Skill Benchmark: golden-dataset

**Model**: gpt-5.6-sol (medium)
**Date**: 2026-08-31T04:39:22Z
**Evals**: 8, 15, 16, 17, 18 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate (mean per-eval) | 100% ± 0% | 64% ± 25% | +0.36 |
| Time | 83.5s ± 95.4s | 78.7s ± 77.4s | +4.8s |
| Tokens | 392447 ± 550143 | 187801 ± 218914 | +204646 |

## Analyst observations

- With-skill passed all 24 formal assertions (24/24); without-skill passed 16 of 24. The 64%/+36.3pp figures above are the mean per-eval pass rate, not the raw assertion-count ratio (16/24 = 66.7%).
- Eval 15 did not discriminate in this run: both configurations passed all assertions.
- Eval 16 separated the explicit migration contract; without-skill omitted one `changes` entry per version with `affects: ["*"]`.
- Eval 17 separated evidence provenance and the complete consumer-parameters record.
- Eval 18 separated fail-closed execution; without-skill allowed a diagnostic diff and proposed contract-incompatible empty/no-op changes.
- Eval 8 with-skill passed formally, but its generated design says page size 6 and tag/page behavior were assumed because source and observations were absent.
  The current assertions do not detect this conflict with the no-guessing contract.
