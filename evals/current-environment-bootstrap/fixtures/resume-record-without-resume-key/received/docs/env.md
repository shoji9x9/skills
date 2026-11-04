# 実行環境（受領物）

- MySQL 8.0.36
- JDK 17 / Tomcat 10、`http://<host>:8080/ship/`
- 起動時に `app_users` が空だとログイン画面から先へ進めない

## 主要画面

| 画面 | パス | 権限 |
|---|---|---|
| ログイン | `/login` | — |
| 受注一覧 | `/orders` | ADMIN / OPERATOR |
| 得意先一覧 | `/customers` | ADMIN |
