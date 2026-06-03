---
date: 2026-06-03
type: doc
priority: medium
status: pending
session: claude-code
---

## 事象

iteration-2 の回帰ベンチマークで、未コミットの skill 変更を検証しようとした。
回帰ベンチの「worktree 分離」は HEAD から worktree を作るため、未コミットの作業ツリー
変更を含まない。そのままだとコミット済みの古い skill を検証してしまう。今回は分離なし
（読み取り専用ドライラン）に切り替えて作業ツリー版を検証した。

## 根本原因

「worktree 分離 = HEAD スナップショット」という性質を、検証対象が未コミットのときに
考慮していなかった。

## 提案

- `AGENTS.md`「回帰テストを実行する」に一文追記する: 未コミットの skill 変更をベンチする
  場合、worktree 分離を使うと HEAD の古い版を測ってしまう。読み取り専用ドライランなら分離
  なしで作業ツリー版を測る（または先に commit する）。
