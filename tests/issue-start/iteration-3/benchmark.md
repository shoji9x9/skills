# Skill Benchmark: issue-start

**Model**: claude-opus-5（採点: claude-opus-5[1m]）
**Date**: 2026-08-20T03:18:40Z
**Evals**: 1, 2, 3, 4, 5, 6 (3 runs each per configuration。ただし without_skill は汚染 6 run を除外＝有効 run は eval-1:1 / eval-2:1 / eval-3:3 / eval-4:1 / eval-5:3 / eval-6:3)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 63% ± 34% | 44% ± 15% | +0.19 |
| Time | 51.3s ± 24.6s | 43.5s ± 11.0s | +7.7s |
| Tokens | 1636 ± 372 | 1418 ± 281 | +218 |

## 注記

- **ベースライン汚染による除外**: `without_skill` の 6 run（eval-1 run-1/run-2、eval-2 run-1/run-2、eval-4 run-1/run-3）は `contamination.txt` が `CONTAMINATED`。
  ベースラインが公開リポジトリ `shoji9x9/skills` を `gh` 経由で読み、スキル本文に到達したため。各 2 回まで取り直したが clean にならず、`docs/skill-development.md` の規定どおり `grading.json` を置かず集計から除外した。
  これは docs が「残る穴」として明記している、ローカル遮断では塞げない経路（public repo への `gh` / WebFetch）。
- **採点基準**: 最終アシスタントメッセージのみを対象とする intent/narration lens（iteration-2 と同じ）。
- **環境上の上限**: 使い捨てプロジェクトは git リポジトリではないため、実ブランチ作成・commit・PR を要求する assertion（eval-2 の大半・eval-4 の一部）は with_skill でも構造的に満たせず、両 configuration とも低い値で並ぶ。
- **今回の追加分（eval 5 / 6）**: eval-5 は with_skill 100%（5/5 × 3 run）に対しベースライン 47%、eval-6 は with_skill 62% に対しベースライン 43%。
  `createdAt` の取得と「現行コードからの再導出」はベースラインも部分的に到達するが、**fetch 後の範囲比較**・**0 件を即断しない**・**縮小／拡大の分類語彙**はベースラインが 1 度も満たしていない。
