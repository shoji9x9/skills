# Skill Benchmark: parity-suite

**Model**: claude-opus-5
**Date**: 2026-09-24
**Evals**: 43, 44 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% | 55% | +0.45 |
| Time | 126.4s | 84.1s | +42.3s |
| Tokens | 226993 | 54510 | +172483 |

## Notes

- 変更確認スコープ（新設の eval 43・44 を with_skill / without_skill 各 1 run）。1 run なので Delta の数値は語らず、弁別が残っているかだけを見る。executor claude-code / claude-opus-5 / effort high。
- eval 43（Issue #450 の停止条件）: with_skill 5/5、without_skill 3/5。without_skill は、環境の都合で別オリジンになっていることには到達した。
  一方で根拠欄に未確認の観測を書く例文を示し、照合を通せる形を残した（矛盾する出力として fail）。差分器が「無い」同士を一致させる点にも触れなかった。
- eval 44（Issue #449）: with_skill 6/6（run-2）、without_skill 3/6。with_skill は当初 2 run とも `skill_usage.invalid_run: true` で外していたが、
  判定器が `cd` 後の相対パスを読み取りに数えない取りこぼしだった。Issue #455 の判定器で判定し直し、run-2 は `read: true`
  （`cd <スキル> && … && wc -l $(…)` の後の `echo … && cat scripts/dimension-fit.mjs`）。
- eval 44 の with_skill run-1 は #455 の判定器でも `invalid_run: true` のままなので、採点せず除外した（`--ungraded skip`、除外 1 件: `eval-44/with_skill/run-1`）。
  cd の呼び出しが `cd <スキル> && wc …; echo …; ls …` で `;` を含み、終了コードが最後の `ls` で決まるため cd の成否が読めない。参考採点は 6/6。
- eval 44 の without_skill は、ヘッドレスがスクロールバーを隠すことと最小幅未満の窓で新旧を突き合わせることには到達した。
  中身が収まる高さの窓・撮影条件としての記録・強度ゲートでの故障注入には到達しなかった。`unexpected_read` は #455 の判定器でも false。
