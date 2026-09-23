# 検証環境構築手順書（受領物・抜粋）

## 4.1 前提

- JDK 17
- MySQL 8.0
- Tomcat 10

## 4.2 手順

1. `db/schema.sql` を流す
2. `db/seed/initial_data.sql` を流す
3. `app/` をビルドして Tomcat へデプロイする
4. `http://<host>:8080/ship/` でログイン画面が表示されることを確認する

## 4.3 主要画面

| 画面 | パス | 権限 |
|---|---|---|
| ログイン | `/login` | — |
| 受注一覧 | `/orders` | ADMIN / OPERATOR |
| 受注登録 | `/orders/new` | ADMIN |
| 得意先一覧 | `/customers` | ADMIN |
