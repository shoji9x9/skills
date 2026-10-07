# 共通部品インベントリ（components）

- 最終更新: 2026-09-01T00:00:00Z
- 方針: 共通部品を画面より先に作る（`parity-component` で採取 → 実装 → 照合する）

## 部品一覧

| slug | 部品 | インスタンス（ページ ＋ 論理名） | URL（パターンのページのみ） | データ依存 | 採否 | Issue |
|---|---|---|---|---|---|---|
| feedback-message | 保存結果のメッセージ | /orders `order.save-message`、/users `user.save-message` | - | false | 自前実装 | #121 |

## 先に作らない部品

なし

## 部品カタログ

- カタログの実体: Storybook
- 取り決めのドキュメント: docs/component-catalog.md
