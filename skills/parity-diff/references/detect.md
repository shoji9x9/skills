# 決定論的差分検出（3 経路）

**検出は決定論的ツールの仕事、モデルの仕事は分類だけ。** この工程に LLM を介さない。使うツール・しきい値は `metadata.json.differ` の記録値を使い（強度ゲートで検証済みの差分器）、CLI へ渡す（外部ツールの引数・出力形式を確認無しに断定しない）。

## 3 経路の分担

| 経路 | 何を拾うか | 何を見ないか |
|---|---|---|
| 画素 | **名前の付かない要素の見た目差**（この経路だけが拾う）。固定集合外プロパティ（box-shadow・opacity・letter-spacing 等）の描画差 | 論理名・プロパティ名。何が違うかは crop で示すのみ |
| 特性照合 | 論理名付き要素の computed style（固定集合）・擬似要素・相対幾何 | 名前無し要素・固定集合外プロパティ・描画テキストの内容 |
| aria | テーブル/フォームの内容パリティ（行・列・セル値・フィールド並び）・構造 | 見た目（余白・色・フォント）。新実装が正しくなった差が混ざる**補助経路** |

- 特性照合が見ない箇所を「computed style で保証済み」と扱わない。名前無し要素の見た目差は画素経路が担う

## 画素経路

- `metadata.json.differ.pixel_tool` / `pixel_threshold` に記録されたツール・しきい値で、現行 `baseline/` と新側 `baseline-new/` のスクリーンショットを**ページ・状態・ビューポートごと**に比較する
- 記録ツールに差分画像を出力させ、同梱 [`../scripts/pixel-crops.mjs`](../scripts/pixel-crops.mjs) で差分画素の bbox クラスタリング → crop 対を生成する。**検出はツールに委ね、本スクリプトは差分画素のクラスタリングと crop 切り出しだけを行う**（差分器を再実装しない）

  ```text
  node <スキルディレクトリ>/scripts/pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <px2>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>]
  ```

  - `diff.png` は記録済み `pixel_tool` が出力した差分画像。差分画素は差分画像上でマークされた色（多くのツールの既定は赤）で判定する。既定の判定色は `--diff-color`（既定 `ff0000` 近傍）で上書きできる。判定基準はスクリプト内に明記してある
  - crop は bbox の周囲に `--crop-margin`（既定 24px）の文脈を含めて切り出す（1px の罫線差などを crop 単体で判断できるようにするため。bbox 自体は広げない）
  - 終了コード 0=差分領域なし / 1=差分領域あり / 2=入力エラー
  - `pngjs` に依存する。記録ツールが `pixelmatch` ならプロジェクトに入っていることが多い。無ければ導入をユーザーに確認する（本スキルは勝手にインストールしない）

## 特性照合経路

- プロジェクト側コピー `metadata.json.differ.trait_compare` の `trait-compare.mjs` を使う

  ```text
  node <trait-compare.mjs のパス> <baseline.json> <capture.json> --align-tolerance <metadata の differ.align_tolerance>
  ```

  - `baseline.json` は現行の採取結果、`capture.json` は新側の採取結果（[`capture-new.md`](capture-new.md)）
  - **記録値 `align_tolerance` を必ず渡す**（省略すると既定 1 になり、記録値と食い違うと結果が変わる）
  - 終了コード 0=差分なし / 1=差分あり / 2=入力エラー。出力 JSON の `kind` は `property` / `pseudo` / `geometry` / `missing` / `duplicate`

## aria 経路

- `metadata.json.differ.aria_compare` に記録された手段で、現行の参考 aria スナップショットと新側採取分を構造比較する
- **補助経路**（新実装が ARIA 的に正しくなったことによる差が混ざるため、単独の合否根拠にしない）。ただしテーブル/フォームの内容パリティ（行・列・セル値・フィールド並び）はこの経路が担う
- 深掘りが要る帳票テーブル等だけ、テーブルをアンカーに代表セル（ヘッダー・先頭行）を相対で測る（オプトイン。全セルに論理名を付けない）

## 検出結果の受け渡し

3 経路の出力（crop 対・特性差分 JSON・aria 構造差）を [`normalize.md`](normalize.md) の正規化へ渡す。この時点では**どれも「検出された候補」であって分類済みではない**。
