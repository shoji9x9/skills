---
date: 2026-09-19
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 長さ制限を強制する実装ではなく自前の近似で測り、単位違いの偽陽性を出した

## 事象

commit message を書いた後、commitlint の body-max-line-length（100）を満たすかを
`awk 'length > 100'` で確かめ、4 行が「TOO LONG（109〜118）」と出た。書き直そうとしたが、
awk の `length` が数えるのは**バイト**で、commitlint が数えるのは**文字**（JS の String.length）。
python で数え直すと最長 62 文字で、超過は 1 行も無かった。日本語本文は 1 文字 3 バイトなので、
この近似は必ず偽陽性になる。

このリポジトリには commitlint が devDependency として入っており、lefthook の commit-msg
（`pnpm exec commitlint --edit {1}`）が正本として走る。同じコマンドは手元でも通る
（実測: `pnpm exec commitlint --edit <file>` が exit 0）ので、近似を書く必要は最初から無かった。

## 根本原因

1. なぜ偽陽性を出したか → 行長を awk の `length`（バイト）で数えたから。
2. なぜ awk で数えたか → 「行長を数える」を汎用の作業と見なし、**強制する実装が何を数えるか**を
   確かめずに道具を選んだ。
3. なぜ確かめなかったか → 直前に同じリポジトリで SKILL.md description の 1024 **バイト**制限
   （`scripts/check-skill-frontmatter.js` が UTF-8 バイトで検査）を扱っており、
   「長さ制限＝バイト」という直前の文脈をそのまま持ち込んだ。**同じ「長さ制限」でも強制する実装ごとに
   単位が違う**（gh / frontmatter checker は UTF-8 バイト、commitlint と markdownlint MD013 は文字）
   ← 根本原因

横断スコープ: 「規約を強制する実装が手元にあるのに近似で自己検査する」全般。markdownlint・oxlint・
shellcheck も同じで、grep / awk の下見は当たりを付けるまでに留め、合否は強制する実装で取る。

## 提案

規約の合否は、それを強制する実装をそのまま実行して取る（自前の近似で測らない）。

- `docs/skill-development.md`「push 前の整合パス」項目 1 へ: 文字数・バイト数・書式のような
  「数えれば分かる」規約ほど自前の近似を書きやすいが、単位（バイト / 文字 / 表示幅）は強制する
  実装ごとに違う。合否はその実装を実行して取る（commit message は
  `pnpm exec commitlint --edit <file>`、Markdown は `pnpm exec markdownlint-cli2 <path>`）。
- AGENTS.md「現状は verify してから言い切る」の直後に 1 行: **規約の合否は、それを強制する実装で測る。**
