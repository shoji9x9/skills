# 決定論的差分検出（3 経路）

**検出は決定論的ツールの仕事、モデルの仕事は分類だけ。** この工程に LLM を介さない。使うツール・しきい値は `metadata.json.differ` の記録値を使い（強度ゲートで検証済みの差分器）、CLI へ渡す（外部ツールの引数・出力形式を確認無しに断定しない）。

## 3 経路の分担

| 経路 | 何を拾うか | 何を見ないか |
|---|---|---|
| 画素 | **名前の付かない要素の見た目差**（この経路だけが拾う）。固定集合外プロパティ（letter-spacing・text-transform・background-image 等）の描画差 | 論理名・プロパティ名。何が違うかは crop で示すのみ |
| 特性照合 | 論理名付き要素の computed style（固定集合）・擬似要素・相対幾何 | 名前無し要素・固定集合外プロパティ・描画テキストの内容 |
| aria | テーブル/フォームの内容パリティ（行・列・セル値・フィールド並び）・構造 | 見た目（余白・色・フォント）。新実装が正しくなった差が混ざる**補助経路** |

- 特性照合が見ない箇所を「computed style で保証済み」と扱わない。名前無し要素の見た目差は画素経路が担う

## 画素経路

- `metadata.json.differ.pixel_tool` / `pixel_threshold` に記録されたツール・しきい値で、現行 `baseline/`（slug 直下）と新側 `new/<target>/baseline-new/`（選択 target のもの）のスクリーンショットを**ページ・状態・ビューポートごと**に比較する
- 記録ツールに差分画像を出力させ、同梱 [`../scripts/pixel-crops.mjs`](../scripts/pixel-crops.mjs) で差分画素の bbox クラスタリング → crop 対を生成する。**検出はツールに委ね、本スクリプトは差分画素のクラスタリングと crop 切り出しだけを行う**（差分器を再実装しない）

  ```text
  node <スキルディレクトリ>/scripts/pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>]
  ```

  - `diff.png` は記録済み `pixel_tool` が出力した差分画像。差分画素は差分画像上でマークされた色（多くのツールの既定は赤）で判定する。既定の判定色は `--diff-color`（既定 `ff0000` 近傍）で上書きできる。判定基準はスクリプト内に明記してある
  - crop は bbox の周囲に `--crop-margin`（既定 24px）の文脈を含めて切り出す（1px の罫線差などを crop 単体で判断できるようにするため。bbox 自体は広げない）
  - 出力は `{ summary, regions, strict_only_regions }`。`regions[]` は従来どおり `bbox` / `pixels`（しきい値つき）/ crop 対で、`strict_pixels` がその bbox 内のしきい値なしの画素数
  - `strict_only_regions[]` は**しきい値の内側にだけ差がある領域**の候補（`id` は `s1` から。`bbox` / `strict_pixels` / crop 対）。
    **近接する成分を先にマージしてから** `--strict-min-cluster`（既定 4）を当てる——1〜3 画素に散る差（細いグリフのヒンティング差・点線装飾）は
    先に下限で落とすと合流する前に全部消え、`strict_only_pixels > 0` なのに候補ゼロになる
  - **`id` は上限を掛ける前の全体の並び（`(y, x)` 昇順）から決まる**ので、警告に従って上限を上げても既存候補の採番は変わらない
    （選抜後の位置で採番すると、割り込んだ手前の領域で `crop-sN-*` が別の bbox を指し、記録済みのトリアージが別の crop に貼り付く）
  - **画素の比較は見えている色で行う**——両側とも完全な透明な画素は、隠れている RGB が違っても差にしない（マスクした領域・要素切り出しで起きる）
  - 件数の上限は `--strict-max-regions`（既定 20）。**上限で出せなかった分も、マージ後に下限へ届かなかった分も、数を残す**
    （`summary.strict_only_regions_total` / `strict_only_dropped_clusters` / `strict_only_dropped_pixels` ＋ stderr の警告。**黙って捨てない**）
  - 終了コード 0=分類すべき候補なし / 1=候補あり / 2=入力エラー。**下限に届かず捨てた分が残るときも 1**（候補を出せていない＝分類できていない状態を「差が無い」と読ませない）。
    下限を下げて候補にするか、strict 側のノイズ基準値との対比で説明を付ける
  - `pngjs` に依存する。記録ツールが `pixelmatch` ならプロジェクトに入っていることが多い。無ければ導入をユーザーに確認する（本スキルは勝手にインストールしない）

### 画素の量は 2 本で報告する（しきい値つき／しきい値なし）

**しきい値つきの比較器の結果を「差の量」として単独で報告しない。** `pixel_tool` のしきい値（`pixel_threshold`）は
**許容の内側の差を総量にも件数にも出さない**ため、1 本だけだと小さな数が「ほぼ一致」と読まれる
（実測: 報告は 756 画素・0.0569%。枠色の緑が 1/255 違う画素が別に 3,364 画素あり、特性照合〈その要素に論理名が無い〉も手書きの aria〈色を見ない〉も見ていなかった）。

- `pixel-crops.mjs` の `summary` に**両方**が出る: `threshold_pixels` / `threshold_ratio`（記録済みツールのしきい値つき）と
  `strict_pixels` / `strict_ratio`（しきい値なし）、そのうちマークされていない `strict_only_pixels`、最大チャンネル差 2 本
  （差がある画素全体の `strict_max_channel_delta` と、しきい値の内側だけの `strict_only_max_channel_delta`）
- **`diff.md` の経路別サマリに両方の数を書く**（様式は [`../assets/diff-template.md`](../assets/diff-template.md)）。片方だけを書かない
- **`strict_only_pixels` が非ゼロなら「差分領域なし」を「一致」と読まない。** 対比する相手は**同じ軸の基準値**——
  `metadata.json.noise_baseline` の該当 page/state/viewport の `pixel_diff_strict` / `pixel_diff_strict_only` であって、しきい値つきの `pixel_diff` ではない
  （しきい値つきの値はほぼ 0 になるため、strict の実測をそれと比べると通常の描画揺れが必ず超過になる）
- **strict の基準値を持たない成果物（この項目の導入前に測った `noise_baseline`）では、strict の差をノイズと断定しない。**
  `parity-suite` に基準値を測り直させるか、その組の候補を未確認として [`triage.md`](triage.md) の分類へ回す（fail-closed）
- **`strict_only_regions[]` は crop 対を持つ候補としてトリアージへ渡す。** 数だけを報告して終えない——
  [`triage.md`](triage.md) の入力は候補ごとの crop 対なので、crop が無い候補は分類も差し戻しもできない
- **判断材料にも両方を渡す**（承認 UI・差し戻し）。**隠れた差の大きさを読むのは `strict_only_max_channel_delta`**——これが 1 なら「色が 1/255 違う」という形が読み取れる
  （`strict_max_channel_delta` は差がある画素全体の最大値なので、別の場所に本物の差があると 255 等になり、隠れた差の大きさとしては読めない）

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
