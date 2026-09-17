# 機能インベントリ（features）

- 最終更新: 2026-08-28T11:00:00+09:00
- ゴールデンデータセット Issue: #200

## その他の Issue（4 種以外）

なし

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 要求単位の根拠 | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|---|---|---|
| order | 注文管理 | 2 | /orders, /orders/:id | GET /api/orders, GET /api/orders/:id | 両方 → 実測: 入口 SELECT と応答への写像を読了（母集合=orders / 1 行=注文 1 件） | user | orders, order_items | なし | #210, #211 | |
| report | 集計レポート | 3 | /report | GET /api/reports | GET /api/reports → 実測: /report の入口 SELECT と応答への写像を読了（母集合=reports / 1 行=レポート 1 件） | user | reports | なし | #212 | |
| notification-banner | お知らせバナー | 2 | /orders | GET /api/notices | GET /api/notices → 実測: /orders 初期表示の入口 SELECT と応答への写像を読了（母集合=notices / 1 行=お知らせ 1 件） | - | notices | なし | #210 | |

## ページ一覧

| ページ | パス | 乗る機能（slug） |
|---|---|---|
| 注文一覧 | /orders | order, notification-banner |
| 注文詳細 | /orders/:id | order |
| レポート | /report | report |

## ページ要素の帰属

なし

## 横断 API（リソース単位）

| slug | リソース | API | 要求単位の根拠 | fan-out（利用機能 slug） | 参照テーブル | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|
| user | ユーザー | GET /api/users, GET /api/users/:id | 両方 → 実測: 共通ヘッダの入口 SELECT と応答への写像を読了（母集合=users / 1 行=ユーザー 1 件） | order, report | users, user_roles | #201 | |

## バッチ

なし
