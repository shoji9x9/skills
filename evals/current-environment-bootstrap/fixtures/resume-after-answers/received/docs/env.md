# 実行環境（受領物）

- MySQL 8.0.36
- JDK 17 / Tomcat 10、`http://<host>:8080/ship/`
- アプリの DB 接続文字列: `jdbc:mysql://<host>:3306/shipdb?characterEncoding=UTF-8&connectionCollation=utf8mb4_ja_0900_as_cs`
- 起動時に `app_users` が空だとログイン画面から先へ進めない

## 主要画面

| 画面 | パス | 権限 |
|---|---|---|
| ログイン | `/login` | — |
| 受注一覧 | `/orders` | ADMIN / OPERATOR |
| 得意先一覧 | `/customers` | ADMIN |
