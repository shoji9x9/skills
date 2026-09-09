# Skill Benchmark: parity-suite

**Model**: gpt-5.6-sol
**Date**: 2026-09-09T09:52:11Z
**Evals**: 29 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 60% ± 0% | +0.40 |
| Time | 80.1s ± 0.0s | 61.6s ± 0.0s | +18.6s |
| Tokens | 130331 ± 0 | 87192 ± 0 | +43139 |

## Result

- `with_skill`: 5/5。即時読み取り・固定待機・retries の拒否、自動リトライ assertion、遅延描画の故障注入、同梱 `auto-wait-check.mjs` まで到達
- `without_skill`: 3/5。assertion を通さない `textContent()` の禁止と、同梱検査＋変異を伴う故障注入には未到達
- プロンプトを強めた後も pass-rate delta は +0.40 を維持

変更確認スコープのため分散は評価していない。
