---
date: 2026-09-26
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手順提示型の eval prompt で「何も実行しないで」と書くと、スキルの読み込みまで止まる

## 事象

parity-replace eval 24 を「…何も実行せず、判断と記録の仕方を説明して」で実走したところ、with_skill が Skill を起動せずファイルも 1 件も読まずに答え、
`skill_usage.invalid_run: true` になった（「スキル定義も開いていない」と自述）。prompt を「コマンドの実行やファイルの変更はせず」に直して 2 run 取り直した（計 8 run）。

## 根本原因

- なぜ読まなかった? 「何も実行しない」を「ツールを一切使わない」と解釈し、Skill 起動・読み取りまで控えた
- なぜその文言にした? 既存 eval（issue-start 等）の dry-run 形を写した。そちらは偶然読んでいた
- なぜ走らせる前に気付けない? 「禁止するのは副作用だけで、スキルの読み取りは禁じない」という prompt の書き方が eval の規約（`eval-assertion-discrimination.md`・`skill-development.md`）に無く、機械検査も無い ← 根本原因

## 提案

手順提示型 eval の prompt は「何も実行しないで」ではなく「コマンドの実行やファイルの変更はせず」のように禁止対象を副作用に限る規約を `.agents/rules/eval-assertion-discrimination.md` に足す。

- 強制点: `scripts/check-eval-reachability.js` に「何も実行しないで／何も実行せず」を含む prompt を警告する検査を足す案（既存 eval は backlog に入れる）
- 横断: `evals/issue-start` の eval 2/7/9/10/11/12 も同じ文言。実走時に `invalid_run` を確かめる
