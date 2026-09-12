# 機能インベントリ（features）

- 最終更新: 2026-09-01T00:00:00Z
- ゴールデンデータセット Issue: #101

## その他の Issue（4 種以外）

なし

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue |
|---|---|---|---|---|---|---|---|---|
| order | 注文管理 | 1 | /orders, /orders/:id | GET /api/orders | - | orders | - | #110 |
| user | 利用者管理 | 2 | /users | GET /api/users | - | users | - | #111 |

## ページ一覧

| ページ | 乗る機能（slug） |
|---|---|
| /orders | order |
| /orders/:id | order |
| /users | user |

## ページ要素の帰属

なし

## 横断 API

なし

## バッチ

なし
