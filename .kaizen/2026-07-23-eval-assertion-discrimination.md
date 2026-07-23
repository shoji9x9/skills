---
date: 2026-07-23
type: rule
priority: medium
status: pending
session: claude-code
---

# 回帰 eval のアサーションは skill 固有の弁別項目にする

## 事象

dependabot-merge の回帰評価 iteration-3 で、eval 2・6 が with-skill / without-skill（baseline）とも
pass_rate 1.00 となり、スキルの有無を弁別できなかった（Delta に寄与しない空振り）。グレーダーも
「一般知識で満たせる」と指摘した。後からアサーションを skill 固有（設定ファイル
`.config/skills/shoji9x9/skills.yml` の `merge_method` 参照・`--watch` exit0 罠回避の終了条件）へ
強化して同一 output を再採点し、初めて baseline が落ちて弁別した（without 1.00→0.67）。

## 根本原因

アサーションを「スキルが正しく動けば true になるか」だけで書き、「baseline（スキル無し）でも
true になるか（＝スキル固有か）」を確認していなかった。eval 作成ワークフロー
（`skills/*/evals/evals.json`）に「一般的なベストプラクティスをなぞるアサーションはスキルの有無を
弁別せず信号にならない」という指針・検証手順が明文化されていなかった。

## 提案

回帰 eval のアサーションは、baseline（スキル無し）が満たせない skill 固有の具体を検査項目にする。
一般的な振る舞い（behind を検出、changelog を見る等）は baseline も自力で満たすため弁別しない。
スキル固有の設定パス・正確な述語・固有コマンド・固有ガードを検査し、可能なら with/without 両
output を grep で突き合わせて「with だけが満たす」ことを確認してから確定する。

`.agents/rules/` に `paths: skills/*/evals/evals.json` で絞ったルールとして追加する（eval 編集時に
確定ロード）。skill-creator の `grader.md`「Critique the Evals」は採点後の批評だが、本指針は
アサーションを書く時点に効かせる。関連: [[2026-07-20-eval-grading-schema-contract]]。
