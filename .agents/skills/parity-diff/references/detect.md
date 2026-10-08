# 決定論的な差分の検出（3 つの比較方法）

検出は決定論的なツールが行い、モデルは分類だけを行う。この工程では LLM を使わない。
ツールとしきい値は `metadata.json.differ` に記録した値を使い、CLI に渡す。記録してあるのは、強度のチェックで確かめた差分ツールである。
外部ツールの引数と出力形式は、確かめずに断定しない。

## 3 つの比較方法の分担

| 方法 | 拾うもの | 見ないもの |
|---|---|---|
| 画素の比較 | 名前の付かない要素の見た目の差（この方法だけが拾う）。固定集合の外のプロパティ（letter-spacing・text-transform・background-image など）の描画の差 | 論理名とプロパティ名。何が違うかは crop で示すだけ |
| 特性照合 | 論理名の付いた要素の computed style（固定集合）・擬似要素・相対幾何 | 名前の無い要素・固定集合の外のプロパティ・描画されたテキストの内容 |
| aria の比較 | テーブルとフォームの内容のパリティ（行・列・セル値・フィールドの並び）と構造 | 見た目（余白・色・フォント）。新しい実装が正しくなったことによる差も含まれる補助の方法 |

- 特性照合が見ない箇所を「computed style で保証済み」として扱わない。名前の無い要素の見た目の差は、画素の比較が受け持つ

## 画素の比較

- `metadata.json.differ.pixel_tool` と `pixel_threshold` に記録したツールとしきい値で、スクリーンショットをページ・状態・ビューポートごとに比べる。
  比べるのは、現行の `baseline/`（slug の直下）と、新側の `new/<target>/baseline-new/`（選んだ target のもの）である
- 記録したツールに差分画像を出力させる。同梱の [`../scripts/pixel-crops.mjs`](../scripts/pixel-crops.mjs) が、差分画素の bbox をクラスタリングして crop 対を作る。
  検出はツールに任せ、このスクリプトは差分画素のクラスタリングと crop の切り出しだけを行う（差分ツールを作り直さない）

  ```text
  node <スキルディレクトリ>/scripts/pixel-crops.mjs <current.png> <new.png> <diff.png> --out <dir> [--min-cluster <count>] [--pad <px>] [--crop-margin <px>] [--diff-color <hex>]
  ```

  - `diff.png` は、記録した `pixel_tool` が出力した差分画像である。差分画素は、差分画像に付いた印の色で判定する（多くのツールのデフォルトは赤）。
    判定の色は `--diff-color`（デフォルトは `ff0000` の近く）で変えられる。判定の基準はスクリプトの中に書いてある
  - crop は、bbox の周りに `--crop-margin`（デフォルトは 24px）の文脈を含めて切り出す。1px の罫線の差なども crop だけで判断できるようにするためで、bbox 自体は広げない
  - 出力は `{ summary, regions, strict_only_regions }` である。`regions[]` は `bbox`・`pixels`（しきい値つき）・crop 対を持つ。`strict_pixels` は、その bbox の中のしきい値なしの画素数である
  - 同じ場所の 1 つの差は、1 つの候補にする。芯がしきい値を超え、縁がしきい値の内側に収まる差（アイコンの輪郭のにじみなど）は、次のように扱う。
    - しきい値の内側の画素のうち、`regions[]` の芯（しきい値つきの画素の bbox）を `--pad` だけ広げた範囲にあるものを、その領域に取り込む。`bbox` は外側（両方を包む bbox）に広げる。
    - 取り込みは画素単位で行い、範囲は「芯＋`--pad`」に限る。連結成分・マージした塊・外接 bbox を単位にすると、疎に散った差や、ページ全体に広がる 1 つの差（背景色の 1 階調のずれなど）を丸ごと取り込んでしまう。
      そうなると、離れた領域まで画面の大きさの候補 1 件にまとまる。
    - 範囲の外の画素は取り込まない。残りの画素から作った塊が `strict_only_regions[]` になる。
    - 取り込んだ後、構成要素（芯と取り込んだ画素の bbox）どうしが `--pad` 以内にある領域と、bbox が重なる領域は 1 つにまとめる（候補の内側に別の候補を残さない）。
      まとめた bbox の内側に残る画素（どの芯＋`--pad` にも入らない角）も取り込む。候補の内側に別の strict-only の候補を残さないためで、bbox の内側だけなので bbox は広がらない。
    - `regions[]` の `id` は、外側の bbox の `(y, x)` の順に振る。`VERSION` が `3` までの出力とは id がずれることがあるので、古い出力の id で記録したトリアージは bbox で突き合わせ直す。
    - 取り込んだ領域は `threshold_bbox`（芯を包む bbox）と `absorbed_strict_only_pixels` を持つ。取り込んだ画素数の合計は `summary.strict_only_absorbed_pixels` に出る（警告なしに消さない）。
  - 縁が `--pad` より外まで続く差は、2 件に分かれることがある。
    外側の `strict_only_regions[]` の候補は、bbox が重なるか接する `regions[]` の `id` を `overlaps_regions` に持つ。その件数は `summary.strict_only_overlapping_regions` と stderr の警告に出る。
    分かれたことは必ず出力に残す。扱いは [`triage.md`](triage.md) と、[`normalize.md`](normalize.md) の画素の例外を適用する節にある。
    分けたままだと、同じ差が `regions` の小さい bbox と `strict_only_regions` の大きい bbox の 2 件になる。
    画素の例外の台帳（[`normalize.md`](normalize.md) の画素の例外を適用する節）は bbox の一致で照合するので、片方にしか当たらない
  - `strict_only_regions[]` は、しきい値の内側にだけ差があり、しきい値つきの領域の芯＋`--pad` の外にある画素から作った候補である。
    `id` は `s1` から振り、`bbox`・`strict_pixels`・`overlaps_regions`・crop 対を持つ。
    近い成分を先にマージしてから、`--strict-min-cluster`（デフォルトは 4）を当てる。
    1〜3 画素に散る差（細いグリフのヒンティングの差、点線の装飾）は、先に下限で除くと合流する前に全部消え、`strict_only_pixels > 0` なのに候補が 0 件になる
  - `id` は、上限を当てる前の全体の並び（`(y, x)` の昇順）で決まる。そのため、警告に従って上限を上げても、既存の候補の番号は変わらない。
    選んだ後の位置で番号を振ると、手前に割り込んだ領域のせいで `crop-sN-*` が別の bbox を指し、記録したトリアージが別の crop に付いてしまう
  - 画素は、見えている色で比べる。両側とも不透明度が 0 の画素は、隠れている RGB が違っても差にしない（マスクした領域や、要素の切り出しで起きる）
  - 件数の上限は `--strict-max-regions`（デフォルトは 20）である。上限のために出せなかった分と、マージした後に下限に届かなかった分も、数を残す。
    数は `summary.strict_only_regions_total`・`strict_only_dropped_clusters`・`strict_only_dropped_pixels` と stderr の警告に出る（警告なしに捨てない）
  - 終了コードは、0 が分類する候補なし、1 が候補あり、2 が入力の誤りである。下限に届かずに捨てた分が残るときも 1 を返す。
    候補を出せていない状態は分類できていない状態なので、「差が無い」と読ませない。
    下限を下げて候補にするか、strict 側のノイズ基準値と比べて説明を付ける
  - `pngjs` に依存する。記録したツールが `pixelmatch` なら、プロジェクトに入っていることが多い。無ければ、導入してよいかをユーザーに確認する（このスキルは自分ではインストールしない）

### 画素の量は 2 本で報告する（しきい値つきと、しきい値なし）

しきい値つきの比較の結果を、差の量として単独で報告しない。
`pixel_tool` のしきい値（`pixel_threshold`）は、許容の内側の差を総量にも件数にも出さない。そのため 1 本だけだと、小さな数が「ほぼ一致」と読まれる。
実測では、報告は 756 画素・0.0569% だった。枠の緑色が 1/255 違う画素が、別に 3,364 画素あった。
特性照合（その要素に論理名が無かった）も、手で書いた aria の比較（色を見ない）も、この差を見ていなかった。

- `pixel-crops.mjs` の `summary` には、次の値が両方出る。
  - 記録したツールのしきい値つきの `threshold_pixels`・`threshold_ratio`
  - しきい値なしの `strict_pixels`・`strict_ratio`
  - そのうち印の付いていない `strict_only_pixels`
  - 最大のチャンネル差 2 本（差がある画素全体の `strict_max_channel_delta` と、しきい値の内側だけの `strict_only_max_channel_delta`）
- `diff.md` の 2 番目の節（サマリ）に、両方の数を書く（様式は [`../assets/diff-template.md`](../assets/diff-template.md)）。片方だけを書かない
- `strict_only_pixels` が 0 でなければ、「差分の領域なし」を「一致」と読まない。
  比べる相手は、同じ軸の基準値である。`metadata.json.noise_baseline` の該当する page・state・viewport の `pixel_diff_strict`・`pixel_diff_strict_only` と比べ、しきい値つきの `pixel_diff` とは比べない。
  しきい値つきの値はほぼ 0 になるので、strict の実測をそれと比べると、ふつうの描画の揺れも必ず超過になる
- strict の基準値を持たない成果物（この項目を入れる前に測った `noise_baseline`）では、strict の差をノイズと断定しない。
  `parity-suite` に基準値を測り直させるか、その組の候補を未確認として [`triage.md`](triage.md) の分類に回す（判定できないときは、ノイズとして扱わない）
- `strict_only_regions[]` は、crop 対を持つ候補としてトリアージに渡す。数だけを報告して終えない。
  [`triage.md`](triage.md) の入力は候補ごとの crop 対なので、crop が無い候補は分類も差し戻しもできない
- 判断の材料（承認 UI・差し戻し）にも、両方の数を渡す。隠れた差の大きさは `strict_only_max_channel_delta` で読む。これが 1 なら「色が 1/255 違う」という形が分かる。
  `strict_max_channel_delta` は差がある画素全体の最大値なので、別の場所に本物の差があると 255 などになり、隠れた差の大きさとしては読めない

## 特性照合

- プロジェクト側のコピー `metadata.json.differ.trait_compare` の `trait-compare.mjs` を使う

  ```text
  node <trait-compare.mjs のパス> <baseline.json> <capture.json> --align-tolerance <metadata の differ.align_tolerance>
  ```

  - `baseline.json` は現行の採取結果、`capture.json` は新側の採取結果（[`capture-new.md`](capture-new.md)）である
  - 記録した `align_tolerance` を必ず渡す。省くとデフォルトの 1 になり、記録した値と違うと結果が変わる
  - 終了コードは、0 が差分なし、1 が差分あり、2 が入力の誤りである。出力の JSON の `kind` は次のどれかである。
    - `property`・`pseudo`・`geometry`・`missing`・`duplicate`
    - `text`: 文字の持ち主の差。`prop` は `text[<i>]/<項目>` で、`text` にベースライン側の文字が付く
    - `scroll`: スクロール領域の差。`prop` は `scroll`（スクロール領域かどうか）・`scroll/<項目>`（はみ出し・バーの厚み・見た目の宣言）・`scroll/<擬似要素>/<プロパティ>` である

## aria の比較

- `metadata.json.differ.aria_compare` に記録した手段で、現行の参考の aria スナップショットと、新側で採取したものの構造を比べる
- 補助の方法である。新しい実装が ARIA として正しくなったことによる差が含まれるので、これだけを合否の根拠にしない。
  ただし、テーブルとフォームの内容のパリティ（行・列・セル値・フィールドの並び）は、この方法が受け持つ
- 深く確かめたい帳票のテーブルなどに限って、テーブルを基準にして代表のセル（ヘッダー・先頭の行）を相対で測る。これはオプトインで、すべてのセルに論理名を付けることはしない

## 性能の比較

3 つの比較方法は、新側だけが遅い・読み込み中に揺れる回帰を拾わない。そこで、性能を別に比べる。
現側の基準（`metadata.json` の `performance`）は `parity-suite` が採り、比べる規則の原本は `parity-suite` の `scripts/perf-stats.mjs` である。
新側の採取の手順は [`capture-new.md`](capture-new.md)「性能の採取」にある。

```bash
node <parity-suite の skill>/scripts/perf-stats.mjs compare \
  --metadata .replace/parity/<slug>/metadata.json \
  --samples .replace/parity/<slug>/new/<target>/perf-samples.json \
  --write .replace/parity/<slug>/new/<target>/diff-metadata.json
```

リポジトリのルートで実行する（現側の採取ファイルを `performance.samples` のパスで読み、集計の後に採り直されていないかを sha256 で確かめる）。
`--write` は今回の実行の `diff-metadata.json` の `performance` だけを書き換える。手順 3 でこの実行の `diff-metadata.json`（自己ノイズの測定値など）を書いた後に通す。
前の反復のファイルに書くと、反復と版の記録が古いまま `performance` だけが新しくなる。ファイルが無ければ exit 2 になる（判定の結果は先に標準出力へ出る）。
結果は手で転記しない。

- 組 × 指標ごとに、新側の中央値と現側の中央値の差を、許容幅（現側の四分位範囲・絶対の下限 `performance.floors`・現側の中央値 × 割合の下限 `performance.relative_floors` のいちばん大きいもの）と比べる。
  許容幅を超えた悪化（`regressed`）は要対応で、LLM のトリアージに回さない。性能の差は crop を持たず、「重要か」を見て決めるものではないからである。
  改善（`improved`）と許容幅の中（`within_noise`）と、両側で LCP が出ない頁（`not_applicable`）は合格として数える。
- 次のものは判定できないので、合格にせず未収束にする。差し戻さずに、原因を取り除いて採り直す。
  - `noisy`: 新側のばらつき（四分位範囲）が許容幅を超えている。負荷の高い機械で測った・バックグラウンドの処理が動いていたなど。
    `delta` が許容幅を超えていれば、回帰の疑いとして報告に添える（ばらつきに回帰が隠れていることがある）
  - `missing`: 片側か一部の回だけ値が無い、新側に組が無い
  - `insufficient`: 回数が 5 回に満たない（基準を手で書き換えたときだけ起きる）。`parity-suite` の `summarize` を通し直す
  - `env_mismatch`: 環境か測り方が現側と違う（`environment_differences` に項目が出る）。
    このスキルは現行アプリを動かさないので、自分で採り直さない。収束の判定で停止し、`environment_differences` を載せて利用者に報告する。
    案内するのは、新側を測った機械で `parity-suite` の性能の採取と `summarize --write` をやり直し、その後でこのスキルを再実行する手順である
  - `stale_baseline`: 現側の採取ファイルが集計の後に変わっている、または読めない。古い基準とは比べないので、すべての組 × 指標がこの状態になり、`regressed` は出ない。`parity-suite` の `summarize` を通し直す
- 終了コードは、0 が合格、1 が回帰か判定できない組が残る、2 が使い方の誤りか基準の形の誤りである。
  1 は結果であって停止の合図ではない。`diff-metadata.json` の `performance` を読み、残りの手順（正規化・トリアージ・収束の判定）へ進む。
  その場で止まるのは 2 だけである。`env_mismatch` の停止は、残りの手順を終えた後、収束の判定で利用者へ案内して行う。
- 性能の `regressed` は、`diff-metadata.json` の `results`（total / actionable）に足さない。収束の判定は `performance.ok` を別の条件として見る（二重に数えない）。
  `metadata.json` に `performance` が無い成果物と、`declared: false` の成果物では、このスクリプトを呼ばない（exit 2 になる）。
  `diff-metadata.json` の `performance` に `{"judged": false, "reason": "<理由>"}` を書き、`diff.md` の未検証の領域に残す。
  `performance` が無いのは性能を測る手順より前に閉じた成果物で、判定に入れない（後方互換）が、測らなかった事実は残す。

## 検出結果の受け渡し

3 つの比較方法の出力（crop 対・特性の差分の JSON・aria の構造の差）を、[`normalize.md`](normalize.md) の正規化に渡す。この時点では、どれも「検出された候補」であって、分類はまだしていない。
