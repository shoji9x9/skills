---
date: 2026-07-16
type: doc
priority: medium
status: pending
session: claude-code
---

# gh skill publish --dry-run の "directory name" エラーは環境的偽陽性

## 事象

box スキル追加時、`gh skill publish skills/box --dry-run`（および `cd skills/box && gh skill publish --dry-run`）が
`error box name "box" does not match directory name "."` を出し validation failed になった。
box 固有の欠陥か切り分けるため、既存の公開済みスキル（issue-create）でも同コマンドを実行し、
同一エラーが出ることを確認して初めて環境的偽陽性と判断できた（追加のコマンド往復が発生）。

## 根本原因

dry-run がパス引数を渡してもディレクトリ名を "." として解決し、name と不一致判定する `gh skill` の挙動。
これが既知の偽陽性であることが `docs/skill-development.md` の検証手順（6. `gh skill publish --dry-run`）に
明文化されておらず、スキル追加のたびに切り分けコストがかかる。

## 提案

`gh skill publish --dry-run` の検証結果で `name "..." does not match directory name "."` エラーが出ても、
現状の環境では全スキル共通で出る偽陽性として扱い、既存スキルで同コマンドを実行した差分（license 等の warning）で
実質的な問題だけを見る。`docs/skill-development.md` の検証手順に、この偽陽性と「既存スキルで同コマンドを実行して
差分を比較する」切り分け方を注記する。
横断: この検証手順はスキル追加のたびに使われるため全 skill-creation セッションに波及する。
