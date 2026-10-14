---
date: 2026-10-14
type: hook
priority: low
status: pending
applied-to: []
session: claude-code
---

# pre-commit の自動修正が skills/ を変えると skills-sync が必ず失敗する

## 事象

Issue #602 の最初のコミットで、pre-commit の pinact が `skills/agent-usage/assets/review-usage-steps.yml` の `uses:` を SHA に固定した。
インストール済みのコピーは古いままだったので、同じ実行の skills-sync が DRIFT で止めた。

## 根本原因

- pre-commit の自動修正（pinact・oxfmt）は `skills/` の原本だけを書き換え、`reinstall-skill.sh` を実行しない。
- そのため、自動修正が当たると skills-sync が必ず失敗し、もう一度コミットを試すことになる。

## 提案

コミットの前に、`skills/` の変更に pinact と整形を当ててから `reinstall-skill.sh` を実行するか、pre-commit の自動修正の後にインストール済みのコピーを同期する。
