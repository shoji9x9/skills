# Skill Benchmark: pr-finalize-loop

**Model**: claude-opus-5
**Date**: 2026-08-26T11:19:27Z
**Evals**: 13 (3 runs each per configuration)

## Summary

| Metric | With Skill | Config B | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 0.0s ± 0.0s | 0.0s ± 0.0s | +0.0s |
| Tokens | 0 ± 0 | 0 ± 0 | +0 |

## Notes

- **スコープ**: Issue #230 で追加した新規 eval（id 13）**のみ**を 1 run 実行。既存 eval は再実行していない。
- **ベースライン未実施**: レートリミット配慮で `without_skill` を実行していない。上表の Config B（0%）は未実施を 0 として表示したもので、**Delta +1.00 は無効**（比較値として読まない）。
- **採点基準**: 使い捨ての空 /tmp プロジェクト（bwrap 隔離、`isolation.txt` は `sandboxed`）で実行され GitHub の実データにアクセスできないため、各アサーションは「エージェントが正しい手順・判断を示したか」で判定した。
- 結果: with_skill 4/4（pr-review-handle）/ 5/5（pr-finalize-loop）— スレッド 0 件・`reviews[].body` 空でも収束と判定せず、`issues/<番号>/comments` を切り詰めずに読む方針を示した。
