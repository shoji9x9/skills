# 機能インベントリ（features）

- 最終更新: 2026-07-20T09:00:00+09:00
- ゴールデンデータセット Issue: 未起票

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 状態 |
|---|---|---|---|---|---|---|---|---|---|
| order | 注文管理 | 2 | /orders, /orders/:id | GET /api/orders, GET /api/orders/:id | user | orders, order_items | CSV 出力（対象） | 未起票 | - |
| report | 集計レポート | 3 | /reports | GET /api/reports | user | reports | なし | 未起票 | - |

## 横断 API（リソース単位）

| slug | リソース | API | fan-out（利用機能 slug） | Issue | 状態 |
|---|---|---|---|---|---|
| user | ユーザー | GET /api/users, GET /api/users/:id | order, report | 未起票 | - |

## バッチ

なし
