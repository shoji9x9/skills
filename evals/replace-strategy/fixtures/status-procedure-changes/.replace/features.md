# 機能インベントリ（features）

- 最終更新: 2026-09-29
- ゴールデンデータセット Issue: #200

## その他の Issue（4 種以外）

なし

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 要求単位の根拠 | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|---|---|---|
| order-list | 注文一覧 | 1 | /orders | GET /api/orders | GET /api/orders → 実測: /orders の起点の SELECT と応答への変換を読んだ（母集合=orders / 1 行=注文 1 件） | - | orders | - | #201 | |
| order-edit | 注文編集 | 2 | /orders/:id/edit | GET /api/orders/:id, PUT /api/orders/:id | GET /api/orders/:id, PUT /api/orders/:id → 実測: 編集画面の起点の SELECT と保存ハンドラ（1 要求で注文 1 件と明細を同一トランザクションで更新）を読了 | - | orders, order_items | - | #202 | |

## ページ一覧

| ページ | パス | 乗る機能（slug） |
|---|---|---|
| 注文一覧 | /orders | order-list |
| 注文編集 | /orders/:id/edit | order-edit |

## ページ要素の帰属

なし

## 横断 API（リソース単位）

なし

## バッチ

| slug | バッチ名 | 入力 | 比較する出力（DB 状態・生成ファイル） | 参照テーブル | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|
| order-export | 注文 CSV 出力 | ゴールデンデータセット | 注文 CSV | orders | #203 | |
