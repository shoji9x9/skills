---
date: 2026-09-26
type: rule
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 手順提示型の eval prompt で「何も実行しないで」と書くと、スキルの読み込みまで止まる

## 事象

parity-replace eval 24 を「…何も実行せず、判断と記録の仕方を説明して」で実走した。
with_skill が Skill を起動せず、ファイルも 1 件も読まずに答え、`skill_usage.invalid_run: true` になった（「スキル定義も開いていない」と自述）。prompt を「コマンドの実行やファイルの変更はせず」に直して 2 run 測り直した（計 8 run）。

2026-11-02（#705）: GitHub につながらない eval の prompt に「gh や git のコマンドは実行せず」と足した。
with_skill の 4 run（pr-finalize-loop#9・#10、pr-review-handle#7・#8）が、同梱の `resolve-review-tool.sh` も実行せず、fixture の設定を読まずに copilot を前提にした。
禁止を GitHub に接続するコマンドに絞り、同梱のスクリプトの実行を許す文に直して、14 run を実行し直した。

## 根本原因

- なぜ読まなかったか → 「何も実行しない」を「ツールを一切使わない」と解釈し、Skill 起動・読み取りまで控えた
- なぜその文言にしたか → 既存 eval（issue-start 等）の dry-run 形をコピーした。そちらは偶然読んでいた
- なぜ実行する前に気付けないか → 「禁止するのは副作用だけで、スキルの読み取りは禁じない」という prompt の書き方が eval の規約（`eval-assertion-discrimination.md`・`skill-development.md`）に無く、機械検査も無い ← 根本原因

## 根拠

2026-11-02 の再発は同じ原因である。禁止の対象を、副作用ではなくツールの名前（gh・git）で書いた。
raw/ で、直す前は `resolve-review-tool.sh` を呼んでおらず、直した後は呼んで fixture の値を得たことを確かめた。

## 提案

手順提示型 eval の prompt は、禁じる対象を副作用（GitHub への接続・ファイルの変更）で書き、スキルの読み取りと同梱のスクリプトの実行は許すと明記する規約を `.agents/rules/eval-assertion-discrimination.md` に足す。

- 強制点: `scripts/gates/packaging/check-eval-reachability.ts` に「何も実行しないで／何も実行せず」を含む prompt を警告する検査を足す案（既存 eval は backlog に入れる）
- 横断: `evals/issue-start` の eval 2/7/9/10/11/12 も同じ文言。実走時に `invalid_run` を確かめる
