# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus
**Date**: 2026-10-28
**Evals**: 4（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #659 の PR #820 で、`SKILL.md` にあった次の手順を、`pr-finalize-loop` と同じ内容の `references/review-threads.md` へ移した。

- 未解決スレッドの全ページの取得（GraphQL）
- スレッドへの返信（REST）と、返信した後の解決（GraphQL）
- スレッドの外の指摘の形と、トップレベルのコメントから集める対象

eval 1・7・9・10 の入力は変えていないが、移した手順を読む eval なので、後退が無いかを with_skill で確かめた。without_skill は入力が変わらないので実行していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill | main の版（同じ条件） |
| --- | --- | --- | --- | --- |
| 1 | 無し | 4/7 | 3/7 ×3（iteration-3、claude-opus-4-8） | 実行していない |
| 7 | 無し | 2/5 | 1/5（iteration-6） | 実行していない |
| 9 | 無し | 3/3 | 記録無し | 3/3 |
| 10 | 無し | 4/4 | 4/4（iteration-4、claude-opus-5） | 実行していない |

前回より下がった eval は無い。
比べる記録の無い eval 9 は、origin/main（725931d1）の版のスキルを同じ条件で実行した。
条件は claude-code 2.1.312、opus、effort の指定なし、run-skill-eval/5 である。結果は 3/3 で、書き換え後の版と同じだった。

eval 10 の with_skill は、`review_tool: claude-code` で「スレッド 0 件・本文が空・COMMENTED」はトップレベルのコメントに総評を置いた形だと答えた。その根拠に `references/review-threads.md` を挙げている。

## with_skill で満たさなかった assertion

使い捨てのプロジェクトは git リポジトリではなく、sandbox の中では `gh` の認証が無効（`The token in keyring is invalid.`）である。
そのため eval 1 と 7 は、repo の一致の確認で止まり、後の手順に触れなかった。前回の記録でも、同じ理由で同じ assertion を満たしていない。

- eval 1: reviewThreads の取得を試みる、`isResolved == false` に絞る、返信してから解決する順序
- eval 7: 再レビューの時期の選択肢（今すぐ / CI 完了後 / 依頼しない）を確かめる、Copilot 専用の login を使わない、`@codex review` の重複投稿を避ける

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
