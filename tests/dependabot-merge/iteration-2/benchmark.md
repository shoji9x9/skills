# Skill Benchmark: dependabot-merge

**Model**: claude-opus-4-8
**Date**: 2026-06-09T01:57:10Z
**Evals**: 1, 2, 3, 4, 5, 6 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 49% ± 34% | 55% ± 27% | -0.05 |
| Time | 64.1s ± 63.2s | 100.9s ± 98.7s | -36.9s |
| Tokens | 2775 ± 1989 | 4669 ± 4409 | -1894 |

## Notes

- Executor & analyzer model: claude-opus-4-8. 3 runs per configuration.
- 採点は意図・ナレーション基準: 安全のため各 run は使い捨ての空 /tmp プロジェクトで実行され、GitHub 変更系操作(ブランチ作成/commit/push/PR/マージ等)は実行できない。そのため各アサーションは「エージェントが正しい振る舞い・手順・判断を示したか」で判定した。
- 対象 PR(#42/#51/#73/#60)は不在、--all は open Dependabot PR ゼロ、other-org は解決不可。実マージ判断は行えず narration 評価。
- プロンプト記述シナリオ(0.x 影響・behind・CI 失敗)に対し base モデルが柔軟に対応する一方、with_skill は repo 一致ガードで停止することがあり、総合では拮抗(Δ −0.05)。CI 失敗時にマージしない判断(eval-3)では with_skill が明確に優位。
