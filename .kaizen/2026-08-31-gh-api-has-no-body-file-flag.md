---
date: 2026-08-31
type: doc
priority: low
status: applied
applied-to: ["AGENTS.md"]
session: claude-code
---

# 本文をファイルで渡すフラグはコマンドごとに違う

## 事象

別セッション（PR #261 の作業）で `gh api` に `--body-file` を渡し、`unknown flag: --body-file` で失敗した。
`gh api` にこのフラグは無く、本文は `-F body=@<path>`（`-F/--field` の `@filename` 変換）か `--input <path>` で渡す。
`--body-file` を持つのは `gh pr` / `gh issue` 側。

## 根本原因

1. なぜ落ちたか → `gh api` に `--body-file` があると仮定して実行した。
2. なぜ仮定したか → `AGENTS.md` の規律が「本文を先にファイルへ書き、`--body-file` / `-F` で渡す」と
   2 つのフラグを並記するだけで、**どのコマンドがどちらを受け取るか**を書いていなかった。
3. なぜ書かれていなかったか → 元の学び（`2026-08-25-outward-body-via-file-not-stdin.md`、`status: applied`）は
   「stdin ヒアドキュメントではなくファイルで渡す」という**渡し方の軸**で書かれ、
   フラグ名はその手段の例示に留まっていた ← 根本原因

KEDB 照合: `2026-08-25-outward-body-via-file-not-stdin.md`（`status: applied`）と同根。
applied ノートへは追記せず、恒久側（`AGENTS.md`）の該当行にコマンド別の対応を明記した。
横断スコープ: 配布スキル内の `gh` 例も確認したが、`gh api` に `--body-file` を渡す記述は無い。

## 提案

外部 CLI のフラグは「同じ用途なら同じ名前」と仮定せず、サブコマンド単位で `--help` を確認してから書く。
基底ドキュメントに手段を書くときは、フラグ名を並記するだけでなく**どのコマンドがどれを受け取るか**まで書く。
