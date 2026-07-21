---
date: 2026-07-21
type: doc
priority: medium
status: applied
session: claude-code
---

# pnpm bump で選ばれる最新版が broken(deprecated) のことがある

## 事象

Issue #100（mise outdated: pnpm 11.10.0→11.12.0）の着手で、`mise upgrade pnpm --bump` が
最新の 11.13.0 を選んだが、`pnpm view` で確認すると Issue が挙げた 11.12.0 も 11.13.0 も
pnpm 公式に `deprecated: This release is broken. Please upgrade to v11.13.1 or newer` と
指定されていた。broken でないのは 11.13.1 のみだが、公開 5 日で `minimum_release_age = 7d`
に該当し `mise upgrade --bump` / `mise lock` は選ばない。`mise.toml` コメントの
「厳密ピンは対象外」に基づき 11.13.1 を厳密ピンで採用して回避した。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ broken 版を掴みかけたか? → bump 手順が「7 日を満たす最新版を採る」だけで、
  選定版が deprecated/broken でないかの確認を含んでいなかった。
  - なぜ確認が無かったか? → `AGENTS.md` の pnpm bump 手順は正本 4 箇所同期の網羅性に
    集中しており（[[2026-06-29-pnpm-bump-sync-four-sources]] で追記）、選定版の健全性
    （deprecated 判定）は明文化されていなかった ← 根本原因（対策可能）。
- なぜ 7 日フィルタが結果的に broken 版を掴む方向に働くか? → `minimum_release_age = 7d` は
  新しすぎる版の不安定を避ける仕組みだが、broken 版の fix が fresh（<7d）だと fix だけを
  除外し、7 日を満たす旧 broken 版が「最新の採用可能版」になってしまう。
  厳密ピンは 7 日フィルタ対象外（`mise.toml` コメント）なので fix 版を明示ピンすれば回避できる。

KEDB 照合: `2026-06-29-pnpm-bump-sync-four-sources.md`（applied）がヒット。あれは
「4 箇所を同期する手順」で、選定版の健全性確認は対象外。同一の pnpm bump フローに対する
別観点の学びのため、applied ファイルには追記せず本ファイルを新規作成し、恒久側（AGENTS.md）を
直接更新した。
横断スコープ: node 等 mise 管理の他ツールも deprecated 版があり得るが、7 日フィルタ回避が
必要になるのは package.json 連動を持つ pnpm 固有の頻繁 bump フロー。手順追記は pnpm 節に閉じる。

## 提案（適用済み）

`AGENTS.md`「技術スタック」の pnpm bump 手順に、採用前の deprecated 確認を 1 行追記した:

> 採用前に選定版が deprecated/broken でないか `pnpm view <版> deprecated` で確認する。
> broken なら修正版を厳密ピンで採る（`minimum_release_age` の 7 日フィルタは厳密ピン対象外）。
> `mise upgrade --bump` は 7 日を満たす最新を選ぶだけで broken を除外しないため、fix 版が
> fresh だと broken 版を掴む。
