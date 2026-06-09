# Skill Benchmark: pr-review-handle

**Model**: claude-opus-4-8
**Date**: 2026-06-09T01:57:10Z
**Evals**: 1, 2, 3, 4, 5 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 54% ± 25% | 48% ± 32% | +0.06 |
| Time | 34.6s ± 6.7s | 34.7s ± 12.9s | -0.1s |
| Tokens | 1793 ± 375 | 1879 ± 828 | -86 |

## Notes

- Executor & analyzer model: claude-opus-4-8. 3 runs per configuration.
- 採点は意図・ナレーション基準: 安全のため各 run は使い捨ての空 /tmp プロジェクトで実行され、GitHub 変更系操作(ブランチ作成/commit/push/PR/マージ等)は実行できない。そのため各アサーションは「エージェントが正しい振る舞い・手順・判断を示したか」で判定した。
- 対象 PR #42 はリポジトリに存在しない(実在は最大 #15)ため、未解決スレッド取得→返信→解決のフローは実行できず、両構成とも PR 不在の検出・安全ガードで停止。
- 差は限定的(Δ +0.06)。主な差別化は eval-2 のコマンド認識(without_skill 一部で『pr-review-handle というコマンドは無い』)。eval-4(別リポジトリ)の安全停止は両者成立。
