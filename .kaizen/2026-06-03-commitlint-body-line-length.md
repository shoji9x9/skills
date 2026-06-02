---
date: 2026-06-03
type: doc
priority: medium
status: pending
session: claude-code
---

## 事象

このセッションで commit 時、commitlint の `body-max-line-length`（100 文字）に
複数回ブロックされた（CD 作業の `feat` / `ci` commit、スキル追加の `feat` commit）。
commit 本文を 1 行で長く書いていたため。

## 根本原因

`AGENTS.md`「ブランチ運用」は commitlint 検証に触れているが、body は 1 行 100 文字以内
という具体制約を明記していない。そのためエージェントが長い本文を書いて毎回弾かれ、
書き直しの手戻りが発生する。

## 提案

- `AGENTS.md` の commit message 規約に「body は 1 行 100 文字以内（長い本文は
  `git commit -F <file>` で渡す）」を追記し、事前に知らせて手戻りを減らす。
- 確定的チェック自体は commitlint が既に担保しているので、ドキュメント側は周知が役割。
