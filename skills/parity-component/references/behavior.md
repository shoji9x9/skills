# 操作の結果の採取と突き合わせ

見た目の照合（画素・特性・当たっている CSS 規則）が見るのは**その状態に置いたときの見た目**だけで、**操作した結果が現行と同じか**は見ていない。
部品が状態ごとの見た目で基準と一致していても、隅のアイコンを押すと列ピッカーではなく全選択になる、全選択の後に 1 行外しても見出しのチェックが残る、
書き出しで落ちる、といった違いは残る。機能単位の `parity-suite` はページができてから動くので、部品を先に作る進め方では画面の実装まで誰も突き合わせない。

そこで `capture` が現行で操作した結果を採り、`build` がカタログの見本で同じ操作をして、**操作 × インスタンス**ごとに結果の状態を比べる。
判定は同梱の [`../scripts/behavior-compare.mjs`](../scripts/behavior-compare.mjs) が行う（コピーせずスキル配下から実行する）。

## 操作の列挙（capture）

- **操作は部品の機能表から列挙する。** 市販部品なら同梱の機能の一覧・公式サンプル、自作・OSS なら部品カタログ、資料が無ければ現行 UI から洗い出す。
  導出源の規律（資料は列挙の生成源であって正解ではない）は `parity-suite` の `references/coverage.md`「状態網羅の導出源」と同じで、
  使った導出源を `metadata.json` の `capture.operation_source` に書く
- **状態の列挙と同じく、操作の集合は全インスタンスで共通にする。** そのインスタンスで実施できない操作だけを
  `instances[].unreachable_operations` に理由付きで宣言し、同じ内容を `gaps.md` に残す。**宣言の無い欠落は採り忘れとして検査が落とす**
- **版差が落ちやすい操作を先に挙げる。** 見た目は CSS で揃えられても、イベントの順序（`mousedown` と `click` のどちらで判定するか）や
  既定の挙動の違いは操作しないと現れない。複合操作（全選択してから 1 行外す、メニュー操作の後に元に戻す）、キーボード操作（Tab での移動）、
  行の挿入位置・削除の扱い（削除するか印を付けるだけか）、書き出しを含める
- 操作ごとに `metadata.json` の `capture.operations[]` へ `id` / `description` / `steps` / `observe` を書く（様式の正本: [`../assets/metadata-template.json`](../assets/metadata-template.json)）。
  **操作を持たない部品（静的な表示だけ等）は `operations` を空配列にし、`operations_none_reason` に理由を書く**——理由の無い空配列は、検査が型崩れとして落とす

## 観測項目の決め方

**比べるのは操作の結果の状態で、画素ではない。** 観測項目は操作ごとに `observe` で固定する。

- 例: 選択範囲（行・列の範囲）、チェックの付いた行と見出しのチェック、行の並び、開いた要素（ポップアップ・メニューの有無と種類）、
  フォーカスの位置、元に戻した後の値、書き出したファイルの有無と名前、**ページの例外・コンソールエラーの件数**（書き出しで落ちる類を拾う）
- **両側ともちょうど `observe` の集合を記録する。** 観測を空にした記録同士は `{}` と `{}` で一致してしまうので、
  項目の欠落・余分は検査が記録の不備として落とす。**不在は `null` で書き、キーを省かない**
- 値は現行と新側で**同じ表現に正規化できるもの**を選ぶ（行は表示中のキー列の値、選択は行・列の番号）。
  実装固有のクラス名・内部 id を観測値にしない——新側では名前が違うので、挙動が同じでも不一致になる

## 採り方

- **各操作は同じ初期状態から始める**（ページ・見本を開き直す）。前の操作の結果を引き継ぐと、順序によって結果が変わる
- **手順は部品の中の論理名で書き、見本でも同じに再生できる形にする**（role ＋アクセシブルネーム。ページ固有の要素に頼らない）。
  現行と見本で違う手順を踏むと、差が実装なのか手順なのか分けられない
- **操作は書き込みになりうる。** 選択した target の `forbidden_actions` を先に引き、禁止された操作で作る結果は実施せず
  `unreachable_operations` と `gaps.md` に残す（規律の正本は `parity-suite` の `references/data-discipline.md`）。
  画面上だけで閉じる操作（選択・並び替え・ポップアップ）と、保存・送信まで進む操作（行の削除を確定する等）を分けて判断する
- 結果はインスタンスごとに `baseline/<instance>/behaviors.json` へ書く（様式の正本: [`../assets/behaviors-template.json`](../assets/behaviors-template.json)）

## 突き合わせ（build）

- カタログの見本で**同じ手順を同じ初期状態から**実施し、同じ観測項目を `new/<target>/behavior-comparison.json` に書く
  （様式の正本: [`../assets/behavior-comparison-template.json`](../assets/behavior-comparison-template.json)）
- 検査を通す:

  ```bash
  node <skill>/scripts/behavior-compare.mjs \
    --baseline .replace/components/<slug>/ \
    --comparison .replace/components/<slug>/new/<target>/behavior-comparison.json \
    --target <target>
  ```

  exit 0 ＝ 母集合の全組み合わせで観測が一致（または承認済み）、1 ＝ 不一致・未突合・記録の不備が残る、2 ＝ 使い方の誤り・型崩れ。
  結果の件数を `build-metadata.json` の `behavior` に写す
- **不一致は要対応として実装へ戻す**（見た目の要対応と同じ往復に入れる）。現行の挙動を引き継がないことを選ぶのは仕様変更なので、
  自分で決めずに利用者へ上げ、承認されたら行を `disposition: accepted` ＋ `reason` / `approved_by` / `approved_at` にする
- **母集合に無い組み合わせの行は置かない**（基準の無い突き合わせは照合されず、合格の証拠に見えるだけ。検査が落とす）
- **実装を変えたら突き合わせを取り直す。** この検査は記録の鮮度を見ない（build の照合は commit 前の作業ツリーに対して行うため、commit で版を特定できない）

## 完了報告に書くこと

操作の結果の突き合わせは、**列挙した操作についてだけ**保証する。完了報告には次を収束と並べて示す。

- 比べなかった組み合わせ（`unreachable_operations`）と承認して残した組み合わせ（`accepted`）の操作名と理由
- 列挙の外にある操作・画面に載せてから効く挙動（ページのデータ・他の部品との連動）は保証しないこと。
  引き受けるのは機能単位の `parity-suite` の部品被覆表（`component-coverage.json`）と `parity-replace` の新側突き合わせ（`component-comparison.json`）である
