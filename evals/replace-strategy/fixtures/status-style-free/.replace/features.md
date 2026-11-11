# 機能インベントリ（features）

- 最終更新: 2026-07-20T09:00:00Z
- ゴールデンデータセット Issue: #10

## その他の Issue（4 種以外）

なし

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 要求単位の根拠 | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|---|---|---|
| order-list | 注文一覧 | 2 | /orders | GET /api/orders | GET /api/orders → 実測: /orders の起点の SELECT と応答への変換を読んだ（母集合=orders / 1 行=注文 1 件） | user | orders | - | #12 | #12 |

## ページ一覧

| ページ | パス | 乗る機能（slug） |
|---|---|---|
| 注文一覧 | /orders | order-list |

## ページ要素の帰属

なし

## 横断 API（リソース単位）

| slug | リソース | API | 要求単位の根拠 | fan-out（利用機能 slug） | 参照テーブル | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|
| user | ユーザー | GET /api/users | GET /api/users → 実測: 共通ヘッダの起点の SELECT と応答への変換を読んだ（母集合=users / 1 行=ユーザー 1 件） | order-list | users | #11 | #11 |

## バッチ

なし
