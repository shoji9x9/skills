---
name: oxfmt-also-formats-markdown
date: 2026-09-12
type: doc
priority: high
status: pending
---

# oxfmt にディレクトリを渡すと Markdown の表まで整形される

## 事象

PR #352 で `pnpm exec oxfmt <ディレクトリ>` を使ったところ、意図していない
fixture の Markdown 13 ファイル（components.md / features.md 等）の表が桁揃えされた。
git checkout で戻した後、2 回目も同じことが起き 4 ファイルを戻した。

2026-09-14（Issue #357）に 3 回目が起きた。fixture 再生成後に
`pnpm exec oxfmt skills/parity-component/evals/fixtures` を実行し、fixture の Markdown 13 ファイルの表が
再び桁揃えされた。git checkout で戻した。

2026-09-20（Issue #417）に 4 回目。今度は**ディレクトリではなくファイルを列挙**
（`pnpm exec oxfmt --check <yml> <yml> <yml> skills/kaizen/references/setup.md`）したのに、
setup.md の無関係な表 3 つが桁揃えされた。git checkout で戻して編集をやり直した。

決定的な証拠: `main` の setup.md は**元から `oxfmt --check` を通らない**（実測）。
lefthook の format タスクは oxfmt-js / oxfmt-json / oxfmt-yaml の 3 つだけで、
CI にも Markdown を oxfmt へ渡す経路は無い。つまり `.md` に対する `oxfmt --check` の
合否は**誰も強制していない検査**で、赤くても直す理由が無い。

## 根本原因（なぜを 3 階層）

1. なぜ Markdown が変わった? → oxfmt は引数に .md を含めると表を整形する（実測で確認）
2. なぜ気付かなかった? → oxfmt の対象を JS/TS・JSON・YAML だと思っていた
3. なぜそう思った? → AGENTS.md の「リント／フォーマット」表が Markdown 行の
   フォーマッタを `markdownlint-cli2` と記し、oxfmt の対象を
   「JS/TS ファミリ全体」「JSON」「YAML」と書いているため、
   Markdown は oxfmt の対象外だと読める ← 根本原因
4. なぜ pending の学びが注入されていたのに再発した? → 直接の引き金は手順書の文言。
   `skills/parity-component/evals/README.md` と生成スクリプト冒頭が「`pnpm exec oxfmt` で整形する」と
   対象を書かずに指示しており、ディレクトリ単位で渡す読みを誘う ← 手順の置き場所に正しい形が書かれていない

### 4 回目の根本原因（なぜを 3 階層）

1. なぜ無関係な表が変わった? → `.md` を oxfmt へ渡したから（3 回目までと同じ機序）
2. なぜ渡した? → 変更したファイルを「このリポジトリの整形」に通すつもりで、
   yml と一緒に .md も同じコマンドへ並べた
3. なぜ並べた? → **そのファイル種別が oxfmt に割り当てられているか**を先に確かめず、
   「`oxfmt --check` が赤いかどうか」を割り当ての代わりに見た ← 根本原因

既存の提案（ディレクトリを渡さずファイルを列挙する）では**この再発を防げない**。
今回はファイルを列挙していた。防げるのは「渡す形」ではなく「渡す対象の種別」の確認。

## 横断スコープ確認

lefthook の format タスク（oxfmt-js / oxfmt-json / oxfmt-yaml）と
package.json の format:js は、いずれも拡張子 glob で対象を絞っているため
この経路では起きない。手でディレクトリ・広いパスを渡したときだけ露出する。

同型の手動整形指示は `skills/parity-component/evals/README.md:76` と
`scripts/generate-parity-component-fixtures.js:20` の 2 箇所（他の evals/README・docs には無し）。

## 提案

生成物の整形は生成スクリプト自身が出力ファイルを列挙して行い、手順書では oxfmt にディレクトリを渡させない。

- `scripts/generate-parity-component-fixtures.js` が書き出した JSON のパスを列挙して `pnpm exec oxfmt <files>` を
  自分で実行し、README と冒頭コメントの手動整形指示を削る

AGENTS.md の「リント／フォーマット」節にも追記する。

- oxfmt は渡されたファイルを種類で判定して整形するため、**Markdown を渡せば
  Markdown を整形する**（表の桁揃え）。表の「フォーマッタ」列は
  lefthook / format スクリプトが glob で絞った状態の割り当てであって、
  oxfmt が扱える範囲の上限ではない
- **oxfmt にはディレクトリを渡さず、対象ファイルを列挙する**。
  ディレクトリを渡すと、目的外のファイルが黙って書き換わる
  （AGENTS.md 既存の「検証は目的を果たす最低限のツール実行で行う」の具体例）

### 4 回目を受けた追加の提案

フォーマッタを当てる前に、そのファイル種別がそのフォーマッタに**割り当てられているか**を
正本（`lefthook.yml` の glob と `package.json` の format スクリプト）で確かめる。
`--check` の合否は割り当ての根拠にならない——割り当て外のファイルでも赤くなるうえ、
その赤は誰も強制していないので直すと無関係な差分になる。

- AGENTS.md「リント／フォーマット」節へ 1 行:
  **整形の割り当ての正本は `lefthook.yml` の glob と `package.json` の `format:*`。**
  表はその要約で、ツールが扱える範囲の上限ではない。割り当て外のファイルに
  `--check` を当てて赤くなっても、それは指摘ではない
- Markdown の整形は `markdownlint-cli2`（`--fix`）で、oxfmt は当てない
