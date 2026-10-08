---
date: 2026-10-08
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# チェックの挙動を文書に書くときは、判定の分岐と読む入力を列挙してから書く

## 事象

Issue #571 で、parity-suite の `references/baseline.md` に `artifact-health-check.mjs` の挙動を書き、2 回続けて誤りが見つかった。

- 「外のツールの後始末では通らない」と書いた。チェックは `cleanup_in_suite` の記録した値を読むだけで、`true` と書けば通る（ローカルの `code-review --fix` が検出し、eval 40 を実行し直した）
- 「`runs` が 2 件に満たないと exit 1」と書いた。`repeat_run.specs` を持つ成果物では、`checkRepeatRunPerSpec` がスペックごとに数える（PR #574 の `code-review --comment` が検出）

## 根本原因

- 誤った理由: 1265 行目付近の 1 つの分岐だけを読んで書いた
- 1 つだけを読んだ理由: Issue の文面（`cleanup_in_suite` と `runs`）を起点に、その語が出る箇所だけを grep した
- 防げなかった理由: 文書に検査の挙動を書くとき、関数のすべての分岐（モード）と、検査が読むのが記録した値か実体かを列挙する手順が無い

## 提案

文書にチェックの挙動（何で失敗し、何で通るか）を書くときは、その判定関数の分岐（モード・早期 return）をすべて挙げ、チェックが読む入力が記録した値か実体かを 1 行で確かめてから書く。

- 記述先の候補: `docs/skill-development.md`「push 前の整合パス」か、`skills/**` を対象にした rule
- 「通らない」「止める」と書くときは、偽の記録で通る形を 1 つ考え、通るなら「記録しない限り」と条件を書く
