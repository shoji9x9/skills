# Skill Benchmark: kaizen

**Model**: claude-opus-4-8
**Date**: 2026-06-09T01:57:10Z
**Evals**: 1, 2, 3, 4, 5, 6, 7, 8 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 66% ± 33% | 38% ± 27% | +0.27 |
| Time | 100.0s ± 80.1s | 137.6s ± 113.3s | -37.7s |
| Tokens | 5515 ± 3941 | 7808 ± 6163 | -2293 |

## Notes

- Executor & analyzer model: claude-opus-4-8. 3 runs per configuration.
- 採点は意図・ナレーション基準: 安全のため各 run は使い捨ての空 /tmp プロジェクトで実行され、GitHub 変更系操作(ブランチ作成/commit/push/PR/マージ等)は実行できない。そのため各アサーションは「エージェントが正しい振る舞い・手順・判断を示したか」で判定した。
- 自己完結型(.kaizen/ への学び保存・Hook 設定)のため隔離環境でも実挙動が観測でき、信号が最も明確(Δ +0.27)。
- with_skill は適切な frontmatter(date/type/status/priority)・セクション(事象/根本原因/提案)を持つ学びファイル作成、3 つの Hook(Stop センチネル+PreToolUse ゲート+SessionStart 注入)の正しい設計、pending→applied ルールを demonstrated。
- without_skill はしばしば別設計(PostToolUse 非同期抽出)や eval-7 で『.kaizen は破棄してよい』の誤回答 — kaizen 固有の方法論を持たないことが差として表れた。
- eval-6 は環境に既存の SessionStart フックがあり両構成とも『設定済み』を検出して飽和。
