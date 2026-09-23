# 機能インベントリ（features）

- 最終更新: 2026-08-20T09:00:00Z
- ゴールデンデータセット Issue: #101

## その他の Issue（4 種以外）

なし

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 状態 |
|---|---|---|---|---|---|---|---|---|---|
| order | 注文管理 | 2 | /orders, /orders/:id | GET /api/orders | user | orders, order_items | CSV 出力（対象） | #103 | open |
| notice | お知らせバナー | 1 | /orders | GET /api/notices | - | notices | - | #104 | open |

## ページ一覧

| ページ | パス | 乗る機能（slug） |
|---|---|---|
| 注文一覧 | /orders | order, notice |
| 注文詳細 | /orders/:id | order |

## ページ要素の帰属

なし

## 横断 API（リソース単位）

| slug | リソース | API | fan-out（利用機能 slug） | 参照テーブル | Issue | 状態 |
|---|---|---|---|---|---|---|
| user | ユーザー | GET /api/users | order, notice | users | #102 | closed |

## バッチ

なし
