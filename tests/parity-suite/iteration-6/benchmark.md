# Skill Benchmark: parity-suite

**Model**: claude-opus-5
**Date**: 2026-07-29T06:41:22Z
**Evals**: 8, 9 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 75.4s ± 39.5s | 211.0s ± 223.0s | -135.6s |
| Tokens | 221341 ± 80988 | 442698 ± 495307 | -221357 |

## Notes

- eval 8（現側専用スペックの `testIgnore` 除外）と eval 9（ドキュメントレベル要素のカバレッジ）。いずれも Issue #146 で追加した回帰。
- eval 8 の without_skill は、**「new プロジェクト」を Playwright の `projects` ではなく skill-creator の eval 群と解釈**して別物の強度ゲートを構築した（0/4・368.7s・792k トークン）。
  弁別としては有効だが、baseline の失敗は「規約を知らない」ではなく「文脈語を取り違えた」ことによる部分を含む。プロンプトに Playwright の文脈語を足すと弁別の質が上がる。
- eval 9 の without_skill は head を見るべきという結論自体には到達したが、favicon に一言も触れず、検出経路（画素・特性照合・aria のどれにも写らない）にも
  テンプレート既定値の残存という退行クラスにも至らなかった（0/4）。
- with_skill は両 eval とも 4/4。eval 8 は `testIgnore: '**/current-only/**'` の config・`projects` 側で除外する理由・`suite.current_only` への記録まで提示している。
