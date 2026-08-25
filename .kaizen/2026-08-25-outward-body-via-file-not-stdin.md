---
date: 2026-08-25
type: doc
priority: high
status: pending
applied-to: []
session: codex
---

# 外向き操作の本文は stdin ではなくファイルで渡す

## 事象

Codex セッションが `gh issue create` の本文を標準入力で渡そうとしたところ、
本文を書き込む前に stdin が閉じた:

```text
write_stdin failed: stdin is closed for this session;
rerun exec_command with tty=true to keep stdin open
```

ところが**起票自体は成功しており**、Issue #219 が `body: ""`（空本文）で作られていた。
エージェントは再起票せずに `gh issue list` で空本文の Issue の存在を確かめ、
`gh issue edit 219 --body-file -`（`tty: true`）で本文を補完して復旧した。

## 根本原因

- なぜ空本文の Issue が残ったか → 本文の到達とコマンドの成功が別事象だった。
  stdin が閉じても `gh` は空本文で正常終了する
- なぜ stdin を選んだか → 長い本文を渡す手段として自然に見えた。しかし stdin は
  実行環境（tty の有無・セッションの寿命）に依存する経路で、エージェントの
  ツール基盤ごとに振る舞いが違う
- なぜそれが危険か → **外向き操作（Issue 起票・PR 作成・コメント）は失敗しても
  取り消せない**。中途半端な成果物が外部に残る ← 根本原因

横断スコープ確認: `AGENTS.md` は既に commit について「長い本文は
`git commit -F <file>` で渡す」としているが、同じ規律が外向き操作（`gh issue create` /
`gh pr create` / `gh ... comment`）には及んでいない。kaizen の `references/setup.md` にも
「メッセージファイルを同じコマンド内の heredoc で作らない」という同系の注意がある。

## 提案

`AGENTS.md` に以下を追記する:

- **本文を伴う外向き操作は、本文を先にファイルへ書いてからファイル渡しで実行する。**
  `gh issue create --body-file <file>` / `gh pr create --body-file <file>` /
  `git commit -F <file>`。stdin 経由は tty の有無やセッションの寿命に依存し、
  **本文が届かないままコマンドだけが成功して空の成果物を外部に残す**。
- **外向き操作が失敗したら、再実行する前に「部分的に成功していないか」を確かめる。**
  失敗と見えて外部には成果物が作られていることがあり、そのまま再実行すると重複する。
  存在していたら新規作成せず補完（`gh issue edit --body-file`）へ倒す。
