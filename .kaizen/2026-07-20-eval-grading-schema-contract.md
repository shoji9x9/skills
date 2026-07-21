---
date: 2026-07-20
type: doc
priority: medium
status: applied
session: claude-code
---

# 採点成果物は集計ツールが実際に読むスキーマを一次情報で確認してから生成する

## 事象

parity-replace の回帰テストで、(1) aggregate_benchmark.py の集計が 0.0% になった
（grading.json にトップレベル pass_rate のみで、スクリプトが読む
summary.{pass_rate,passed,failed,total} が無かった）、(2) generate_review.py が
「No runs found」になった（run 配下に outputs/ と eval_metadata.json が無い）。
どちらも後追いのブリッジ（summary 補完・outputs/response.md 抽出・metadata 生成）で解消した。

## 根本原因

1. なぜ 0.0% / No runs → 採点者・ハーネス出力が skill-creator 集計/ビューアの期待スキーマを満たしていなかった
2. なぜ満たさなかった → docs/skill-development.md は「grading.json を残す」とだけ書き、必須フィールドと
   run レイアウトの契約を明文化していない（skill-creator の references/schemas.md への参照も無い）
3. なぜ明文化されていない → 過去 iteration では通る形をたまたま書いており、契約として docs に固定されなかった
   ← 根本原因（対策可能）

横断スコープ: 全スキルの回帰テストが同じ手順を使うため今後の全 iteration に波及する。

## 提案

外部ツールへ渡す成果物（採点結果・集計入力）は、ツールが実際に読むスキーマを一次情報
（スキーマ定義・ソース）で確認してから生成する。docs/skill-development.md の採点手順に
grading.json の必須フィールド（summary.{pass_rate,passed,failed,total} と expectations の
text/passed/evidence）と、ビューア利用時の run レイアウト（outputs/ と eval_metadata.json）を
明記し、skill-creator の references/schemas.md を正本として参照する。
