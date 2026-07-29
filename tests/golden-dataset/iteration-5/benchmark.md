# Skill Benchmark: golden-dataset

**Model**: claude-opus-5
**Date**: 2026-07-29T06:41:22Z
**Evals**: 9 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 83.1s ± 0.0s | 166.9s ± 0.0s | -83.8s |
| Tokens | 119453 ± 0 | 85271 ± 0 | +34182 |

## Notes

- eval 9 のみ（本イテレーションの対象）。Issue #146 で追加した「フェーズ B の現新一致検証を逆写像の往復で書かない」の回帰。
- without_skill は要求どおり往復形を採用し、`phase-b-roundtrip-verification.md` を実際に生成した（0/4）。
  限界として挙げたのは「写像表自体が業務的に誤っていれば往復は一致する」だけで、**宣言外の正規化が素通りする**という本質には到達していない。
- with_skill は 4/4。「写像表を import しない」と明記した設計を提示し、`missing` / `extra` を差として扱う点と、
  強度確認で注入する正規化は実データに効くものを選ぶ必要（データに前後空白が無いのに `trim()` を足しても列挙結果が変わらない）まで示した。
