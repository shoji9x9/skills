# 共通部品インベントリ（components）

<!-- replace-strategy の setup（共通部品の依存決定）が生成・更新する。このファイルの形式の正本は replace-strategy が定義し、 -->
<!-- parity-component は slug とインスタンスをここから引く（自分で採番しない・このファイルを書かない）。 -->
<!-- 各行は例。実際の部品・値で置き換える。 -->
<!-- 更新は非破壊。既存の行・ヘッダ項目・テンプレートに無い追記も、書き直しで落とさない。 -->
<!-- Issue 列は起票済みなら番号、未起票なら「未起票」。open / closed の状態は列にしない（トラッカーが正本）。 -->
<!-- このファイルを作るのは「共通部品を画面より先に作る」方針を採る場合だけ。機能ごとに部品も作る方針なら作らない -->
<!-- （その場合の部品の採否は .replace/dependencies.md だけに記録し、parity-replace が機能の実装時に決める）。 -->

- 最終更新: （ISO 8601）
- 方針: 共通部品を画面より先に作る（`parity-component` で採取 → 実装 → 照合する）

## 部品一覧

<!-- slug: ASCII kebab-case・.replace/features.md の slug と同じ名前空間で一意（成果物パス .replace/components/<slug>/ になる）。 -->
<!-- インスタンス: 「ページ ＋ その部品を指す論理名」。**2 件以上**挙げる（1 件では固定と可変を区別できず、共通部品として先に作る対象にならない）。 -->
<!-- インスタンスは .replace/features.md の「ページ一覧」から導出する。導出できないページがあれば、先にページ一覧を埋める。 -->
<!-- 論理名は role ＋アクセシブルネームで引ける名前にする（id・自動生成クラスをアンカーにしない）。 -->
<!-- データ依存: 描画がデータに左右されるか（データグリッド等）。true なら parity-component が現行の可視行から実データを採る。 -->
<!-- 採否: 自前実装 / 採用パッケージ名。判断材料と不採用理由は .replace/dependencies.md が正本で、ここには結論だけを書く。 -->

| slug | 部品 | インスタンス（ページ ＋ 論理名） | データ依存 | 採否 | Issue |
|---|---|---|---|---|---|
| button | ボタン | /orders `order.search-submit`、/users `user.create-submit`、/orders/:id `order.detail-save` | false | 自前実装 | 未起票 |
| data-grid | データグリッド | /orders `order.list-grid`、/users `user.list-grid` | true | （採用パッケージ名） | 未起票 |
| checkbox | チェックボックス | /orders `order.select-all`、/users `user.active-filter` | false | 自前実装（現行は標準の input） | 未起票 |

## 先に作らない部品

<!-- インスタンスが 1 件しか無い部品は共通部品として先に作らない（その機能の実装時に parity-replace が作る）。 -->
<!-- 「いまは 1 件だが今後増える見込み」も同じ扱いにする——見込みは採取物ではない。 -->
<!-- 該当が無ければ節を消さず「なし」と書く。 -->

| 部品 | インスタンス | 先に作らない理由 |
|---|---|---|
| （例: 印刷プレビュー） | /orders/:id のみ | インスタンスが 1 件で、固定と可変を区別できない |

## 部品カタログ

<!-- 実装した部品を単体・状態ごとに描画する場。実体は利用者が選ぶ（Storybook / Ladle / 自前のカタログページ等）。 -->
<!-- 契約（1 インスタンス × 1 状態 = 1 固定 URL / Playwright 到達可 / 静的データ注入可 / アニメーション無効化可 / 外部サービス非依存）と -->
<!-- 見本の書き方・URL の決まり方・データの注入経路は、設定 references.component_catalog が指すドキュメントに書く。 -->
<!-- baseURL は設定 targets[].catalog_url（side: new）から解決する。 -->

- カタログの実体: （選んだもの。未確定なら「未確定」と書き、`parity-component build` に入る前に確定させる）
- 契約ドキュメント: （`references.component_catalog` が指すパス）
