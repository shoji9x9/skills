---
date: 2026-10-30
type: doc
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# stage の呼び出しが Bash に拒否されたのに、同じ応答で並べた git commit が実行され、message と中身の合わない commit ができた

## 事象

issue-batch の run の #835 で、eval のファイルを stage するスクリプトの呼び出しと、`git commit -F` の呼び出しを、同じ応答に並べて送った。
stage の呼び出しは、引数の語（`eval`）を理由に worktree の Bash に拒否された。
commit の呼び出しはそのまま実行され、Hook が stage していた利用実績の記録 2 件だけを、「eval 12 を足す」という message で commit した（`c37efb4f`）。
`--amend` を使わない規約なので、正しい commit をもう 1 つ作り、誤った commit は残した。

## 根本原因

- なぜ中身の合わない commit ができたか → stage が失敗したまま commit を実行した
  - なぜ失敗に気づかずに実行したか → 2 つの呼び出しを同じ応答に並べたので、commit は stage の結果を見ずに実行された
    - なぜ並べたか → stage と commit を別の呼び出しに分けることだけを守り、前の呼び出しの成功を確かめてから次を送る規約（`AGENTS.md`「外向きの操作と破壊的な操作」）を、手元の commit に当てていなかった ← 根本原因

## 根拠

拒否の出力と、`git show --stat HEAD` で利用実績の記録 2 件だけが入ったことを、同じセッションで確かめたので high とする。
KEDB 照合では `stage`・`git add`・`拒否` で `.kaizen/` を検索し、`2026-10-14-worktree-bash-literal-guard-recurs.md` が拒否の形を扱っていた。拒否された後の commit を扱う学びは無かった。

## 提案

`git add` と `git commit` を別の呼び出しに分けるときは、`git add` の結果（`git status --short` の staged の行）を見てから、次の応答で `git commit` を送る。

- 適用先: `AGENTS.md`「commit message」の「`git commit` を含む呼び出しに、`git add` や message ファイルの作成を入れない」の箇条
- 同じ応答に並べた呼び出しは、前の呼び出しが拒否されても実行される。stage が前提の commit は、並べずに送る
