---
name: oxfmt-also-formats-markdown
date: 2026-09-12
type: doc
priority: medium
status: pending
---

# oxfmt にディレクトリを渡すと Markdown の表まで整形される

## 事象

PR #352 で `pnpm exec oxfmt <ディレクトリ>` を使ったところ、意図していない
fixture の Markdown 13 ファイル（components.md / features.md 等）の表が桁揃えされた。
git checkout で戻した後、2 回目も同じことが起き 4 ファイルを戻した。

## 根本原因（なぜを 3 階層）

1. なぜ Markdown が変わった? → oxfmt は引数に .md を含めると表を整形する（実測で確認）
2. なぜ気付かなかった? → oxfmt の対象を JS/TS・JSON・YAML だと思っていた
3. なぜそう思った? → AGENTS.md の「リント／フォーマット」表が Markdown 行の
   フォーマッタを `markdownlint-cli2` と記し、oxfmt の対象を
   「JS/TS ファミリ全体」「JSON」「YAML」と書いているため、
   Markdown は oxfmt の対象外だと読める ← 根本原因

## 横断スコープ確認

lefthook の format タスク（oxfmt-js / oxfmt-json / oxfmt-yaml）と
package.json の format:js は、いずれも拡張子 glob で対象を絞っているため
この経路では起きない。手でディレクトリ・広いパスを渡したときだけ露出する。

## 提案

AGENTS.md の「リント／フォーマット」節に追記する。

- oxfmt は渡されたファイルを種類で判定して整形するため、**Markdown を渡せば
  Markdown を整形する**（表の桁揃え）。表の「フォーマッタ」列は
  lefthook / format スクリプトが glob で絞った状態の割り当てであって、
  oxfmt が扱える範囲の上限ではない
- **oxfmt にはディレクトリを渡さず、対象ファイルを列挙する**。
  ディレクトリを渡すと、目的外のファイルが黙って書き換わる
  （AGENTS.md 既存の「検証は目的を果たす最低限のツール実行で行う」の具体例）
