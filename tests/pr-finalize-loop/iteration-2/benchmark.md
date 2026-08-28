# Skill Benchmark: pr-finalize-loop

**Model**: Codex CLI account default (model not exposed)
**Date**: 2026-08-28T03:15:26Z
**Evals**: 14 (1 with-skill run; no baseline)

## Summary

| Metric | With Skill |
|--------|------------|
| Pass Rate | 100% (5/5) |
| Time | 31.8s |
| Tokens | 105,006 |

## Scope

Eval #14 only. GitHub and PR operations were disabled, so this validates the state-query strategy in the final response rather than the live API workflow.
The baseline was intentionally omitted to limit rate usage; therefore no delta is reported.

The 105,006-token total sums input, cached-input, cache-write input, output, and reasoning tokens. The generic aggregator's output-character proxy was not used.
