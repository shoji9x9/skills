# Skill Benchmark: parity-replace

**Model**: claude-opus-5
**Date**: 2026-07-29T04:03:58Z
**Evals**: 6, 7 (1 run per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 81.8s ± 5.1s | 131.3s ± 0.0s | -49.5s |
| Tokens | 153708 ± 36124 | 198086 ± 0 | -44378 |

## Notes

- eval 7（新規・with/without 各 1 run）と eval 6（回帰・with_skill のみ 1 run）。without_skill は eval 7 のみのため Without Skill 欄は eval 7 の値。
- eval 7 の with_skill はレビュー修正後のスキル本文で再実走している（修正前も 4/4、修正後も 4/4）。eval 6 は修正前の run（対象箇所はレビュー修正の影響を受けない成果物表の追記のみ）。
- without_skill の run はスキル資産への参照が無いことを result.json の grep で確認済み（クリーン）で、Delta は弁別測定として有効。
- eval 6 は実行フローの手順番号を繰り下げた（部品の洗い出しを手順 3 に挿入）ことによる回帰確認。応答も「手順 2・3・4・6・7 をスキップ」と改訂後の番号を用いている。
