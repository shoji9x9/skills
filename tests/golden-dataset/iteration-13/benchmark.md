# Skill Benchmark: golden-dataset

**Model**: gpt-5.6-sol (medium)
**Date**: 2026-08-31T05:17:33Z
**Evals**: 8 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 78% ± 0% | +0.22 |
| Time | 222.4s ± 0.0s | 146.2s ± 0.0s | +76.2s |
| Tokens | 1149566 ± 0 | 629936 ± 0 | +519630 |

## Analyst observations

- With-skill passed all 9 assertions; without-skill passed 7 of 9.
- Both configurations read `current-site/src/works-list.ts` and grounded page size, filtering, ordering, and page retention in the fixture source.
- Without-skill still recorded the feature slug `works-list` instead of the changed static data unit `content/works` in `changes[].affects`.
- Without-skill did not advise rerunning the affected `parity-suite` baseline.
