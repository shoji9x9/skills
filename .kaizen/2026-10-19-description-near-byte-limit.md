---
date: 2026-10-19
type: rule
priority: low
status: pending
applied-to: []
session: claude-code
---

# SKILL.md の description に文を足す前に、今のバイト数と上限（1024 バイト）の差を測る

## 事象

issue-batch の #697 で、`pr-finalize-loop` の description の `--max-iterations` の説明を書き換えた。
書き換えた後に測ると 1138 バイトで、上限の 1024 バイトを超えていた。元の description が 1022 バイトで、上限まで 2 バイトしか無かった。
言い回しを 3 回縮め、別の箇所の語（「手元のレビュー」を `local`）も短くして、1018 バイトに収めた。

## 根本原因

1. なぜ縮め直したか → 書き換える前に、元の description のバイト数を測らなかった。
2. なぜ測らなかったか → Issue のコメントが description の該当の箇所を変えると決めていたので、書く量の制約を考えずに書いた。
3. なぜ考えなかったか → description の上限は frontmatter の規約（`.agents/rules/skill-file-format.md`）にあるが、上限に近い description を書き換える手順に、先に測る段が無い ← 根本原因

## 提案

SKILL.md の description を書き換えるときは、書く前に今のバイト数を測り、上限（1024 バイト）までの差の中で言い回しを決める。

- 反映先の候補: `.agents/rules/skill-file-format.md` に、書き換える前に `python3 -c` などでバイト数を測ることを 1 行足す。
- KEDB 照合: 「description」+「1024」で照合し、一致は無かった。
