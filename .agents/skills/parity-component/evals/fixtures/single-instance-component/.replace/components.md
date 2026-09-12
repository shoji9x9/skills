# 共通部品インベントリ（components）

- 最終更新: 2026-09-01T00:00:00Z
- 方針: 共通部品を画面より先に作る（`parity-component` で採取 → 実装 → 照合する）

## 部品一覧

| slug | 部品 | インスタンス（ページ ＋ 論理名） | URL（パターンのページのみ） | データ依存 | 採否 | Issue |
|---|---|---|---|---|---|---|
| button | ボタン | /orders `order.search-submit`、/users `user.create-submit` | - | false | 自前実装 | #120 |
| print-preview | 印刷プレビュー | /orders/:id `order.print-preview` | /orders/:id → `/orders/1001` | false | 自前実装 | #121 |

## 先に作らない部品

なし

## 部品カタログ

- カタログの実体: Storybook
- 契約ドキュメント: docs/component-catalog.md
