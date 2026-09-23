---
date: 2026-09-23
type: doc
priority: low
status: pending
applied-to: []
session: claude-code
---

# スキルを通さず作った使い捨て worktree でも mise trust が要る

## 事象

Issue #442 で変更前後の所要時間を同条件で測るため、scratchpad に
`git worktree add --detach` で計測用 worktree を作り `pnpm install` した。
`mise.toml are not trusted` で install が落ち、`mise trust` 後に再実行した（1 手戻り）。

## 根本原因

- なぜ落ちたか? → worktree は新しいパスで、共有ツリーの mise trust が引き継がれない
  - なぜ知っていたのに踏んだか? → 注意点は git-worktree スキル手順 8 にだけあり、
    スキルを通さない計測用 worktree では読まれない
    - なぜスキルを通さなかったか? → AGENTS.md が「旧版と現行版を同じ条件で測る」を
      推奨する一方、その手段（使い捨て worktree）の前提条件が基底ドキュメントに無い ← 根本原因

KEDB: archive/2026-06-08-mise-shim-runtime-untrusted（applied。eval の使い捨てプロジェクト）と同根。
横断: git-worktree 手順 8・docs/skill-development.md の eval 隔離は対応済み。基底ドキュメントの計測手順だけ未カバー。

## 提案

比較計測などでスキルを通さず worktree を作るときも、依存導入の前にその worktree で `mise trust` を通す。

- AGENTS.md「mise の shim は cwd の設定階層で解決する」節に、新しいパスの worktree は trust が引き継がれない旨を 1 行足す
