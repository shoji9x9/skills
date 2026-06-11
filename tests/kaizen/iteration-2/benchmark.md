# Skill Benchmark: kaizen

**Model**: claude-opus-4-8
**Date**: 2026-06-04T10:01:23Z
**Evals**: 1, 2, 3, 4, 5, 6, 7, 8 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 65% ± 37% | +0.35 |
| Time | 3993.2s ± 84.9s | 99.3s ± 69.5s | +3893.8s |
| Tokens | 0 ± 0 | 0 ± 0 | +0 |

## 補足・注意（手動追記）

- 各構成 **1 run**（ヘッダ・`runs_per_configuration` と整合）。
- **Time 列は比較に使えない**: with_skill の 8 run は同一ターンで並列起動したため待ち時間込みの wall-clock（≈4000s）で膨らんでいる。実 CPU 時間ではない。Tokens は集計スクリプトが拾えず 0 表示（実値は各 run の timing.json 参照）。
- **判定の主指標は Pass Rate**: with_skill **100%** vs without_skill **65%**（delta **+0.35**）。Issue #3 の新挙動（RCA 強化 / SessionStart 注入 / status フロー / setup 分離 / 自己改変ガード）はすべて with_skill で合格。

### 構成別の所見（with/without 差の解釈）

| eval | with | without | 差の要因 |
|------|------|---------|---------|
| 1 extract-current | 6/6 | 6/6 | 既存 .kaizen 形式を模倣でき baseline も通過。skill は 3why/KEDB/横断で質が高い |
| 2 extract-all | 3/3 | 2/3 | baseline は extract.md の --all 形式に非準拠（独自 retrospective 1ファイル） |
| 3 apply | 4/4 | 1/4 | baseline は 1件ずつ確認/ multiagent-setup 参照/branch・Issue確認をせず一括適用 |
| 4 setup-gate | 5/5 | 5/5 | **baseline は contaminated**: worktree=HEAD に Stop+PreToolUse が既にコミット済みで「確認しただけ」で通過 |
| 5 rca | 4/4 | 3/4 | baseline は KEDB 照合を欠く（3why/横断は実施。偶発的に gate 誤検知も発見） |
| 6 sessionstart | 4/4 | 2/4 | baseline はバンドル context-inject 未使用・注入可否の但し書きなし |
| 7 status-advice | 2/2 | 2/2 | 一般助言で baseline も正答（skill の優位が出にくい設問） |
| 8 setup-self-mod | 4/4 | 0/4 | baseline は SessionStart 追加・自己改変節・! cp 案内・setup.md 参照をすべて欠く |

### ベンチで surface した発見

1. install 先 `.agents/skills/kaizen/scripts/` に `kaizen-context-inject.sh` が無いとフックが動かない → 再インストールで解消（本リポジトリは対応済み）。
2. `kaizen-precommit-gate.sh` の **jq 依存** → 本セッションで多段フォールバック化して**修正・検証済み**。
3. gate の生JSONフォールバック時のクォート境界による**誤検知**（`grep "...git commit..."` 等を誤ブロック）を baseline eval-5 が独立に指摘。PR #8 のレビュー対応で修正済み（command フィールド値が git commit で始まる場合に限定）。
