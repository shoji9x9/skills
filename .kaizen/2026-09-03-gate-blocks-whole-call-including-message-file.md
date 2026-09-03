---
date: 2026-09-03
type: doc
priority: medium
status: applied
applied-to: [AGENTS.md]
session: claude-code
---

# ゲートは git commit を含む呼び出し全体を止める（message ファイルの作成も走らない）

## 事象

commit message のヒアドキュメント書き出しと `git add`・`git commit` を 1 コマンドにまとめて実行し、
kaizen のコミット前ゲートにブロックされた。ゲートを解消して `git commit -F <file>` だけを再実行したところ:

```text
fatal: could not read log file '<scratchpad>/msg7.txt': No such file or directory
```

ブロックされた呼び出しの中でヒアドキュメントも実行されていないため、message ファイルが存在しなかった。
**同じセッションで 2 回踏んでいる**（msg1.txt / msg7.txt）。2 回目は「ゲートは解消したのに別のエラーが出た」
と見え、原因の切り分けに 1 往復かかった。

## 根本原因

- なぜファイルが無かったか → PreToolUse ゲートは `git commit` を含む**呼び出し全体**を実行前に止める。
  同一コマンド内の準備（ヒアドキュメント・`git add`）も実行されない
- なぜ再実行で気付かなかったか → ゲートの案内が「その後、git commit を再実行してください」であり、
  **準備も巻き添えで消えている**ことを示唆しない。`git commit` だけ再実行して別の失敗に化けた
- なぜ既存の規律で防げなかったか → [[2026-06-03-stage-separate-from-commit]]（`status: applied`）が
  同じ根本原因を扱っているが、記述は `git add` を例にしており、**message ファイルの作成**という形が
  読み取れなかった。しかも失敗の現れ方（`could not read log file`）がブロックと別物に見える ← 根本原因

## KEDB 照合

[[2026-06-03-stage-separate-from-commit]] と同根の再発。`status: applied` なので追記せず
（参照注入は pending のみ供給するため死蔵する）、恒久側の `AGENTS.md`「commit message」項を更新した。

横断スコープ: `git commit` を含む呼び出しに混ぜうる準備は `git add` と message ファイル作成のほか、
`git rm` / `git mv` / 一時ファイルの生成全般。いずれも同じ経路で消える。

## 提案

`AGENTS.md`「ブランチ運用」の commit message 項に追記済み（本ノートは恒久側を更新した記録）。

- `git commit` を含む呼び出しに、コミット前の準備（`git add`・message ファイルの作成）を混ぜない
- ゲート解消後に `git commit` だけ再実行すると、作られていない message ファイルで
  `could not read log file` に化ける。準備は別コマンドで先に済ませる
