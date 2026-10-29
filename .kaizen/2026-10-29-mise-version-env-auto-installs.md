---
date: 2026-10-29
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# `MISE_<TOOL>_VERSION` を付けて mise の shim を起動すると、宣言に無いバージョンがリポジトリの外に入る

## 事象

issue-batch の run の #797 で、ローカルレビュー（`/code-review --fix`）が、環境変数による mise の上書きを確かめた。
その際に `MISE_NODE_VERSION=20.0.0` を付けたまま、node の shim を通るコマンドを実行した。
mise は node 20.0.0 を `~/.local/share/mise/installs/node/20.0.0` に自動でインストールした。リポジトリの中は変わっていない。

## 根本原因

- なぜ入ったか: このマシンの mise は `auto_install` が `true` で、shim は要求されたバージョンが無いとダウンロードして入れる。
  `MISE_<TOOL>_VERSION` は、`mise ls` だけでなく、同じ呼び出しの中で起動する shim（`node`・`pnpm` など）にも当たる。
- なぜ防げなかったか: 環境変数を付けて確かめる対象を `mise ls` だけに絞る手順が無く、`node scripts/...` を同じ環境変数のまま起動した。

## 根拠

1 回の観測で、レビューの報告とインストール先のディレクトリで確かめた。KEDB 照合は「mise」「auto_install」「VERSION」で行い、一致は無かった。

## 提案

mise の上書きを確かめるときは、環境変数を `mise ls` の呼び出しだけに付け、shim を通るコマンド（`node`・`pnpm`）を同じ環境変数で起動しない。

- 適用先候補: `AGENTS.md`「確かめ方」の「階層で合わさる設定（mise・git・npm など）に依存する検証」の箇条に、上書きの環境変数は shim にも当たり、`auto_install` で別のバージョンが入ることを足す
- 機構は作らない。1 回の観測で、入ったものはリポジトリの外にあり、`mise uninstall` で戻せる
