# データ意味論台帳

- 最終更新: 2026-08-20T05:00:00Z
- 確定済み: 3 件 / 確認待ち: 2 件

## 1. 確定済みの意味論

| 項目 | 値または状態 | 根拠（資産・コードの位置／回答者・回答日） | 対象機能（slug） | 備考 |
|---|---|---|---|---|
| `app_users.role_code` の値集合 | ADMIN / OPERATOR | 先方 開発担当 田口・2026-08-19 の回答 | 共通 | ADMIN は全機能、OPERATOR は受注一覧の参照と出荷登録 |
| `customers.code` の形式 | `C` ＋ 4 桁連番 | `received/db/schema.sql`（VARCHAR(16) NOT NULL・UNIQUE） | customer-list | |
| ログイン画面のパス | `/login` | `received/docs/env.md` 主要画面表 | 共通 | |

## 2. 確認待ちの意味論

| 項目 | 導出できた候補（無ければ「候補なし」） | 導出元 | 対象機能（slug） | 未確認のまま残す場合の影響 | 質問票の該当項目 |
|---|---|---|---|---|---|
| `orders.status` の意味と正常系遷移 | 0 / 1 / 2 / 3 / 9 | `OrderStatus.java` の enum（名称は S0〜S9） | order-list | 状態別表示・絞り込みのシナリオを確定できない | Q-2 |
| `orders.status` の初期値 | 候補なし | DDL に既定値なし | order-list | 受注登録直後の表示を確定できない | Q-2 |

## 3. 確認したが確定できなかったもの

| 項目 | 確認先・確認日 | 回答 | 対象機能（slug） | 扱い（gaps へ回す／別経路で確定させる） |
|---|---|---|---|---|
| `order_flow.properties` の遷移定義 | 先方 開発担当 田口・2026-08-19 | 運用チーム管理で手元にない | order-list | 追加受領を依頼中 |

## 4. 暫定起動データに投入した値

| テーブル・対象 | 投入した値の要旨 | 根拠（上表 1 の項目） | 件数 |
|---|---|---|---|
| `app_users` | admin（ADMIN）／operator（OPERATOR）の 2 件 | `app_users.role_code` の値集合 | 2 |
| `customers` | `C0001` / `C0002` の 2 件 | `customers.code` の形式 | 2 |
