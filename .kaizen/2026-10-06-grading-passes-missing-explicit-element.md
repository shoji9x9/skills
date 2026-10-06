---
date: 2026-10-06
type: doc
priority: medium
status: pending
session: claude-code
---

# assertion が明記する要素が答えに無ければ、「趣旨は合う」で合格にしない

## 事象

Issue #372 の段階 ⑤-a で、parity-suite eval 38 の #3（「VERSION が上がっている」ことに触れる）を、採点のフォークが「VERSION には触れていないが趣旨は合う」と合格にした。
前回の run は VERSION を明記して合格していたので、実際には下がっていた。PR #559 で Copilot が指摘した。
④-c の採点でも「ぎりぎりで合格」が 2 件あった。

## 根本原因

- 採点の手順（docs/skill-development.md）は、assertion の文のどの要素を満たせば合格かを定めていない。
- 採点を任せるとき、根拠に「触れていない」と書いたまま合格にする形を、親が確かめずに集計した。

## 提案

- docs/skill-development.md の採点の節に書く: assertion が明記する要素（括弧の中を含む）が答えに無ければ不合格にする。要素が厳しすぎるなら、assertion を直す。
- 仕組みにするなら、build-skill-eval-benchmark.js が passed: true の evidence に「触れていない」「趣旨は合う」などを見つけたら警告を出す。
