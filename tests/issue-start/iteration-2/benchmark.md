# Skill Benchmark: issue-start

**Model**: claude-opus-4-8
**Date**: 2026-06-09T01:57:10Z
**Evals**: 1, 2, 3, 4 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 77% ± 20% | 52% ± 31% | +0.24 |
| Time | 35.9s ± 10.5s | 40.2s ± 22.2s | -4.3s |
| Tokens | 1978 ± 643 | 2158 ± 992 | -179 |

## Notes

- Executor & analyzer model: claude-opus-4-8. 3 runs per configuration.
- 採点は意図・ナレーション基準: 安全のため各 run は使い捨ての空 /tmp プロジェクトで実行され、GitHub 変更系操作(ブランチ作成/commit/push/PR/マージ等)は実行できない。そのため各アサーションは「エージェントが正しい振る舞い・手順・判断を示したか」で判定した。
- with_skill はコマンド構文(issue-start … --pr/--plan)で明確に優位 — without_skill ではコマンド自体が存在せず実行不能。
- eval-3(別リポジトリ)の安全停止(repo 不一致検出→中断)は with/without とも成立し飽和。
- Issue #12 は CLOSED・/tmp は git リポジトリでないため、両構成とも実フローは実行できず安全に停止・narration で評価。
