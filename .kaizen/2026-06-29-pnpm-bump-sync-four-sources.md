---
date: 2026-06-29
type: doc
priority: medium
status: applied
session: claude-code
---

# pnpm の bump は正本 4 箇所を同期する

## 事象

Issue #58（mise outdated: pnpm 11.7.0→11.8.0）の着手で、`mise upgrade pnpm --bump` と
`mise lock` で `mise.toml` / `mise.lock` を更新した後、`package.json`
（`packageManager` / `devEngines.packageManager.version`）と `pnpm-lock.yaml` の
`packageManagerDependencies` も 11.7.0 を参照したままだと気づいた。
取りこぼすと `devEngines` の警告・正本間の不整合になる。

正しい全箇所同期の手順は文書化されておらず、過去の同種コミット #49
（pnpm 11.5.2→11.7.0）の diff を grep で参照して再発見した。
`mise outdated` 由来の pnpm bump は #49・#58 と繰り返し発生している。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ取りこぼしやすいか? → pnpm の版が 4 箇所（`mise.toml` / `mise.lock` /
  `package.json` の 2 フィールド / `pnpm-lock.yaml`）に分散しているため。
  - なぜ毎回 #49 を参照して再発見するのか? → `AGENTS.md` には正本リスト
    （`package.json` の `packageManager` / `devEngines.packageManager` と
    `pnpm-lock.yaml`、mise 管理）はあるが、**bump 時にそれら全部を同期する手順**が
    書かれていなかった（`AGENTS.md:13`）。
    - なぜ書かれていなかったか? → 正本の「在り処」は明文化したが、更新の「手順」を
      明文化していなかった ← 根本原因（対策可能）

KEDB 照合: `2026-06-08-pnpm-is-the-package-manager.md`（applied）がヒットしたが、
これは「pnpm を使う／npm を使わない」規約で bump 手順は対象外。新規の手順学び。
横断スコープ: node など mise 管理の他ツールは package.json 連動が無いため対象外。
package.json の `packageManager` を持つのは pnpm 固有。

## 提案（適用済み）

`AGENTS.md`「技術スタック」のパッケージマネージャ節に bump 手順を追記した
（doc-altitude に従い 1 行で簡潔に）:

> pnpm を bump するときは正本 4 箇所すべてを同期する: `mise upgrade pnpm --bump`
> → `mise lock`（全プラットフォーム URL を補完）→ `package.json` の `packageManager` と
> `devEngines.packageManager.version` を新版へ → `pnpm install --lockfile-only` で
> `pnpm-lock.yaml` を再生成。mise だけ更新して package.json / lock を取りこぼすと
> `devEngines` 警告・不整合になる
