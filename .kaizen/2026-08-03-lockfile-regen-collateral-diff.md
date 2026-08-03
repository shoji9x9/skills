---
date: 2026-08-03
type: doc
priority: medium
status: applied
session: claude-code
---

# ロックファイル再生成は対象外 entry も巻き込む

## 事象

Issue #168（mise outdated: pnpm 11.15.1→11.17.0）の着手で、`docs/package-manager.md` の
bump 手順どおり `mise upgrade pnpm --bump` → `mise lock` を実行したところ、`mise.lock` の
差分が 54 行（28 挿入 / 28 削除）になった。うち pnpm の 6 プラットフォーム entry は 26 行で、
残り 28 行は python の artifact だった。python はバージョン指定 3.14.6 のまま変わらず、
python-build-standalone のビルド日だけが 20260718 → 20260728 に更新されていた
（URL と checksum が書き換わる）。

前回の同種コミット 4fc2d2e（pnpm 11.13.1→11.15.1）の `mise.lock` 差分は 26 行・pnpm のみで、
巻き込み差分は入っていない。今回は該当ブロックを HEAD の内容へ手作業で戻して差分を
pnpm のみに絞った。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ無関係な差分が混ざったか? → `mise lock` は lockfile 全体を再解決する仕様で、
  バージョン指定が変わっていないツールでも上流の再ビルド成果物（別日ビルドの tarball）を
  拾って URL / checksum を書き換えるため。
  - なぜ気づかずに commit しかけるか? → `docs/package-manager.md` の bump 手順は
    「`mise lock`（全プラットフォーム URL を補完）」としか書いておらず、**対象ツール以外の
    entry も更新されうること**と、その後始末が記述されていなかった。
    - なぜ記述が無かったか? → 手順が「必要な更新の網羅」（正本 4 箇所の同期。
      [[2026-06-29-pnpm-bump-sync-four-sources]]）と「選定版の健全性」
      （[[2026-07-21-pnpm-bump-guard-deprecated-version]]）に集中し、**余分な更新の除去**を
      明文化していなかった ← 根本原因（対策可能）。`AGENTS.md`「ブランチ運用」の
      「無関係な変更を同一 commit に混ぜない」との接続点が手順側に無かった。

KEDB 照合: `2026-06-29-pnpm-bump-sync-four-sources.md` と
`2026-07-21-pnpm-bump-guard-deprecated-version.md`（ともに applied）がヒット。両者とも
同じ pnpm bump フローの学びだが、前者は「同期すべき箇所の網羅」、後者は「選定版の健全性」で、
「生成された差分の絞り込み」は対象外。applied ファイルへは追記せず本ファイルを新規作成し、
恒久側（`docs/package-manager.md`）を直接更新した。

横断スコープ: 同じ副作用は node / shellcheck 等 mise 管理の他ツールを bump するときにも
起きるため、追記は pnpm 固有ではなく `mise lock` 一般の注意として書く。
`pnpm install --lockfile-only` にも同種の副作用がありうる（今回は pnpm 関連 39 行のみで発生せず）。

## 提案（適用済み）

ロックファイル再生成コマンドは対象外の entry も再解決するため、生成後に `git diff` で範囲を
確認し、目的外の差分は元に戻してから commit する。

`docs/package-manager.md` に新節「mise lock の巻き込み差分を絞る」を追記した:

> `mise lock` は lockfile 全体を再解決するため、バージョン指定が同じ他ツールでも上流の
> 再ビルド（例: python-build-standalone のビルド日）を拾って entry を書き換える。
> 生成後に `git --no-pager diff mise.lock` で範囲を確認し、bump 対象以外のツールの
> ブロックは元に戻して commit を対象ツールだけに絞る。
