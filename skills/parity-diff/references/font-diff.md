# フォント差の切り分け（版差とヒンティング差）

テキストの幅・字形の差は移行で頻出する（フレームワークのフォント最適化機構が変わる、配布パッケージが変わる）。**「同じフォント名だから同じ」で済ませない**——同じ名前でも本文の幅は変わる。

## 差は 2 軸で決まる

| 軸 | 見るもの | 効き方 |
|---|---|---|
| フォントの版 | `head` テーブルの `fontRevision`（フォント製造者が設定する版。補助として `name` テーブルの version string〈ID 5〉） | グリフ形状・送り値そのものが変わる |
| ヒンティング命令の有無 | `prep`（Control Value Program）・`fpgm`・`cvt` テーブルの有無 | 小サイズで**送り幅の整数丸め**が変わる |

**同じ版でも `prep` の有無で本文の幅が変わる。** ヒンティング命令はサイズ・変換行列が変わるたびに実行され、命令は送り幅を変えうる（`head.flags` のビット 4「Instructions may alter advance width」がその宣言）。
このため 16px 前後の小サイズでは、**グリフの送り値が 1 単位まで同一でもレンダリング結果の幅は違う**。送り値の比較だけで「同じフォント」と結論しない。

出典: [head](https://learn.microsoft.com/en-us/typography/opentype/spec/head) / [prep](https://learn.microsoft.com/en-us/typography/opentype/spec/prep)（OpenType spec）

## 切り分けの手順

1. **現・新が実際に読み込んだフォントファイルを特定する。** ベースラインに含めたネットワークログ（`parity-suite` の 3 点セットの補助）と、必要なら `document.fonts` の解決結果を使う。CSS のフォントスタック宣言だけで判断しない（実際に解決されたファイルが正）
2. **両側のフォントファイルのテーブル一覧と `head` / `name` を読む。** 版（`head.fontRevision`）とヒンティング命令の有無（`prep` 等の在否）を確定する。
   例: fontTools の `ttx -l <font>`（"List table info: instead of dumping to a TTX file, list some minimal info about each table"）。**woff2 の読み書きには Brotli 拡張が要る**ため、対応していなければ展開してから読む。
   出典: [fontTools ttx](https://fonttools.readthedocs.io/en/latest/ttx.html)。ツールの導入はユーザーに確認する（本スキルは勝手にインストールしない）
3. **ヒンティング差だけを切り離す。** 現・新の両側に `text-rendering: geometricPrecision` を掛けて撮り直すと、送り幅の丸めが効かなくなり、残る差が版差になる。
   ただし**エンジン依存**（Gecko は `optimizeLegibility` と同等に扱う）なので、**掛ける前後で幅が変わることを確認してから**切り分けの根拠に使う（変わらなければこの手は使えない）。
   出典: [text-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/text-rendering)（MDN）

- **これは切り分けのための一時計測**であり、ベースライン・新側ベースラインの撮影条件を変えるものではない。計測後は記録済みの撮影条件へ戻す（条件を変えたまま差分検出へ進まない）

## 分類への落とし込み

切り分けた結果は、[`triage.md`](triage.md) の 3 値分類の根拠として `diff.md` に記録する。

| 切り分け結果 | 扱い |
|---|---|
| 版差 | **要対応**。現行と同じ版を新側へ配信する（供給経路が違えば版が違いうる） |
| ヒンティング差 | **要対応**。ヒンティング命令を持つビルドを配信する。配信物を選べず消せないなら、承認を得てインスタンス例外（`property: pixel`。置き場所は `.replace/parity/<slug>/component-diff-exceptions.json`）か `gaps.md` の未検証へ落とす |
| 版もヒンティングも同一 | フォント以外（`font-size` / `letter-spacing` / `line-height` / フォールバック解決）を疑う。**採取環境と利用者環境の乖離**（総称ファミリーの解決先が OS で変わる）は差分器がゼロを返すため、`metadata.json.capture_conditions.viewer_environment` を確認する |

- **フォント差を「環境ノイズ」に分類しない。** ノイズ基準値は同一環境の撮り直し差であり、供給されたフォントが違うことはノイズではない
- **フォント差は画素経路でしか出ないことがある**（版・送り値・`font-family` の値がすべて一致し、ラスタライズの濃度だけが違う）。この差は `component_diffs` に宣言しても吸収されない——
  レジストリごとに効く経路の正本は [`normalize.md`](normalize.md)「レジストリの適用対象」
- **単一の原因で複数箇所に例外を書くときは、原因を 1 回定義して `cause` で参照する**（`reason` を全インスタンスへ複製しない）。
  切り分けの経緯・観測条件は `component-diff-exceptions.md` の原因の節に置く（正本: [`normalize.md`](normalize.md)「インスタンス例外のスキーマ」）
- 手順 3 の切り分けは実験である。**差が観測された条件（要素・サイズ・ウェイト・状態）を列挙してから測る**（別の条件で測った「差ゼロ」を仮説の否定にしない。正本は [`triage.md`](triage.md)「仮説の検証は観測条件を列挙してから組む」）
