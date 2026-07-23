# Skill Benchmark: dependabot-merge

**Model**: claude-opus-4-8
**Date**: 2026-07-23T02:40:15Z
**Evals**: 1, 2, 3, 4, 5, 6, 7, 8, 9 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 58% ± 20% | +0.42 |
| Time | 96.6s ± 17.3s | 82.5s ± 11.8s | +14.2s |
| Tokens | 43580 ± 1032 | 31578 ± 751 | +12001 |

（± は eval 間のばらつき。1 config あたり 1 run のため run 内分散は測っていない。iteration-1/2 は 6 eval・3 run/config で with-skill 49%。本 iteration-3 は eval 7–9 を追加し 9 eval・1 run/config。eval 2・6 は弱弁別だったため skill 固有アサーションを追加して再採点した）

## 前回比較

| iteration | evals | runs/config | With Skill | Without Skill | Delta |
|-----------|-------|-------------|-----------|---------------|-------|
| 2 | 1–6 | 3 | 49% ± 34% | 55% ± 27% | −0.05 |
| 3（初回集計） | 1–9 | 1 | 100% ± 0% | 66% ± 27% | +0.34 |
| 3（eval 2・6 弁別強化後） | 1–9 | 1 | 100% ± 0% | 58% ± 20% | +0.42 |

## Per-eval pass rate（with / without）

| eval | 概要 | with | without |
|------|------|------|---------|
| 1 | vitest 4.1.7→4.2.0（>=1.0 マイナー） | 1.00 | 0.75 |
| 2 | oxfmt 0.52→0.53（0.x 影響確認・merge_method 設定参照）★弁別強化 | 1.00 | 0.67 |
| 3 | CI 失敗でマージしない | 1.00 | 0.75 |
| 4 | --all 全 open 逐次＋収束ループ | 1.00 | 0.83 |
| 5 | 別リポジトリ owner/repo ガード | 1.00 | 0.33 |
| 6 | behind→rebase→CI 再確認＋--watch 罠回避・状態空間網羅 ★弁別強化 | 1.00 | 0.67 |
| **7** | **rebase 後 --watch exit0 を信用せずポーリング（新）** | **1.00** | **0.50** |
| **8** | **rebase 拒否→@dependabot recreate（新）** | **1.00** | **0.25** |
| **9** | **supersede/close→後継 PR 切替・再利用（新）** | **1.00** | **0.50** |

## Notes

- Executor / grader モデル: claude-opus-4-8。1 config あたり 1 run。
- 採点は意図・ナレーション基準: 各 run は使い捨ての空 /tmp プロジェクトで実行し、GitHub 変更系操作（merge/comment/rebase/recreate/push 等）は禁止。参照 PR（#42/#51/#73/#60/#82/#90/#95 等）は架空題材。各アサーションは「エージェントが正しい振る舞い・手順・判断を narration で示したか」で判定した。
- **弁別強化（B）**: eval 2・6 は初回集計で with/without とも 1.00 と弱弁別だった。skill 固有の深さを捉えるアサーションを追加し、同一 output を再採点した:
  - eval-2 追加: 「マージ方式を設定 `.config/skills/shoji9x9/skills.yml` の `merge_method`（無ければ squash 既定）から決める」。without は設定を参照せず「squash 運用が一般的」と推測に留まり FAIL（1.00→0.67）。
  - eval-6 追加: 「head 差し替え後の `--watch` exit0 を信用せず mergeStateStatus / 必須チェック行の pending 解消までポーリング」
    「待機終了条件に rebase 拒否（→recreate）と supersede/close の両方を含める」。without は premature race とポーリング述語・supersede 追跡を欠き 2 項目 FAIL（1.00→0.67）。
- **新規 eval 7–9（Issue #119 の修正対象）で最大の差**: without は exit0 の premature race を stale としか捉えない（7）、`The base commit has not changed` を rebase 不要と真逆に解釈（8）、
  後継 PR への状態遷移監視・確認済み内容の再利用を欠く（9）。with-skill はいずれも明示し 1.00。skill 追記が状態空間網羅の判断を実際に付与できている。
- 収束系（4 手順5）・cross-repo ガード（5）・判断コメント記録（1/3）も without が取りこぼしやすく、skill の定型化が効いている。
