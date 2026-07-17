# 機能インベントリ（features）

<!-- replace-strategy が生成・更新する。このファイルの形式（slug 規則を含む）の正本は replace-strategy が定義し、 -->
<!-- 下流スキル（golden-dataset / parity-suite / parity-replace / parity-diff）は slug をここから引く（自分で採番しない）。 -->
<!-- 各行は例。実際の機能・値で置き換える。 -->

- 最終更新: （ISO 8601）
- ゴールデンデータセット Issue: 未起票

## 機能一覧

<!-- slug: ASCII kebab-case・インベントリ全体で一意。日本語機能名は短い英語に要約（例: 注文一覧＋注文詳細 → order） -->
<!-- 依存順: 横断 API → 依存の浅い機能 → 深い機能。副作用出力は所有者の行に記録する（対象／スコープ外の別も） -->
<!-- Issue 列: 未起票なら「未起票」、起票済みなら番号（#12 等）。状態列: open / closed / -（未起票） -->

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 状態 |
|---|---|---|---|---|---|---|---|---|---|
| order | 注文管理 | 2 | /orders, /orders/:id | GET /api/orders | user | orders, order_items | CSV 出力（対象）、確認メール（スコープ外） | 未起票 | - |

## 横断 API（リソース単位）

<!-- 2 つ以上の機能から使われる API をリソース単位でグルーピング。Issue はリソース単位で 1 本 -->

| slug | リソース | API | fan-out（利用機能 slug） | Issue | 状態 |
|---|---|---|---|---|---|
| user | ユーザー | GET /api/users, GET /api/users/:id | order, report | 未起票 | - |

## バッチ

| slug | バッチ名 | 入力 | 比較する出力（DB 状態・生成ファイル） | 参照テーブル | Issue | 状態 |
|---|---|---|---|---|---|---|
| monthly-summary | 月次集計 | ゴールデンデータセット | summaries テーブル、集計 CSV | orders | 未起票 | - |
