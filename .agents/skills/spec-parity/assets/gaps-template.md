# 未検証の領域（gaps）

<!-- spec-parity suite が .replace/parity/<slug>/gaps.md として書く。このファイルの形式は spec-parity が定義する。 -->
<!-- ブラウザや API で確かめていない挙動を「確認済み」と書かない。理由を付けて残す。各行は例で、実際の箇所に置き換える。 -->
<!-- API の要求単位を確定できず、測るまで機能を閉じさせない口は、metadata.json の unmeasured に同じ文言（item / reason）で宣言する。 -->
<!-- このファイルは人が読む文書で、収束の判定の入力ではない。verify で確かめないものは、verify-metadata.json の unverified に同じ文言（item / reason）で書く。 -->

- 対象 slug: （features.md の slug）
- 実施日時: （ISO 8601）

## 確かめていない箇所と理由

<!-- 種別の判定（対象・対象外・条件付き）は、replace-strategy の references/scope.md を原本として読む。 -->

| 箇所 | 種別 | 理由 | 対応 |
|---|---|---|---|
| 性能（例） | 対象外（style_policy: free） | 性能の比較は Playwright の採取を前提にしているので、spec-parity では確かめない | verify-metadata.json の unverified に performance として書く |
| 見た目の一致（例） | 対象外（style_policy: free） | 現行と新側の画面を比べない。デザインの点検と人による確認で、違和感が無いことだけを確かめる | 記録だけ |
| 375px の幅（例） | 現行が保証していない幅 | 現行の /orders が 375px で横にはみ出した（scrollWidth 608） | capture_conditions.excluded_viewports に同じ文言で書く |
| XHR の失敗（例） | 記録の射程外 | init script は fetch と要素の読み込みだけを記録し、XMLHttpRequest を記録しない | 未検証として残す |
| 別オリジンへ移った後のエラー（例） | 記録の射程外 | sessionStorage はオリジンごとなので、移った後の記録を取り出せない | 未検証として残す |
| 開いたメニューの中のはみ出し（例） | 測定の射程外 | overflow のテストは、ページを開いた状態だけを測る | 状態を作る操作を足して測るか、未検証として残す |
| 一覧の空状態（例） | データ不足 | このパターンのシードが無く、空のリストしか確かめられない | golden-dataset に戻してバージョンを上げ、影響する機能の spec-parity suite をやり直す |
| 確認メールの送信（例） | スコープ外の副作用 | メールと外部との連携はスコープ外 | 記録だけ |
