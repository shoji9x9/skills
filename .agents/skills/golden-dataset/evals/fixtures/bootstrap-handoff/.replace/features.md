# 機能インベントリ

## 機能

| slug | 機能 | ページ | API | テーブル | Issue |
|---|---|---|---|---|---|
| order-list | 受注一覧 | /orders | GET /api/orders | orders | 未起票 |
| customer-list | 得意先一覧 | /customers | GET /api/customers | customers | 未起票 |

## 横断 API リソース

| slug | リソース | API | 参照テーブル | fan-out（利用機能 slug） | Issue |
|---|---|---|---|---|---|

## バッチ

| slug | バッチ | 起動方法 | 参照テーブル | 出力 | Issue |
|---|---|---|---|---|---|

## ページ一覧

| ページ | 乗る機能（slug） |
|---|---|
| /orders | order-list |
| /customers | customer-list |

## その他の Issue（4 種以外）

| slug | 内容 | 4 種に当てはまらない理由 | 依存順 | Issue |
|---|---|---|---|---|
