# 機能インベントリ（features）

- 最終更新: 2026-08-05T10:00:00+09:00
- ゴールデンデータセット Issue: #41
- スキーマ Issue: #47

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue |
|---|---|---|---|---|---|---|---|---|
| order | 注文管理 | 2 | /orders, /orders/:id | GET /api/orders, GET /api/orders/:id | user | orders, order_items | CSV 出力（対象） | #52 |
| report | 集計レポート | 3 | /reports | GET /api/reports | user | reports | なし | 未起票 |

## ページ一覧

| ページ | パス | 乗る機能（slug） |
|---|---|---|
| 注文一覧 | /orders | order |
| 注文詳細 | /orders/:id | order |
| レポート | /reports | report |

## 横断 API（リソース単位）

| slug | リソース | API | fan-out（利用機能 slug） | Issue |
|---|---|---|---|---|
| user | ユーザー | GET /api/users, GET /api/users/:id | order, report | #48 |

## バッチ

なし
