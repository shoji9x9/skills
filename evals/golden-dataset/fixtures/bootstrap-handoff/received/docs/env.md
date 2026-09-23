# 実行環境（受領物）

- MySQL 8.0.36
- JDK 17 / Tomcat 10、`http://<host>:8080/ship/`

## 主要画面

| 画面 | パス | 権限 |
|---|---|---|
| ログイン | `/login` | — |
| 受注一覧 | `/orders` | ADMIN / OPERATOR |
| 得意先一覧 | `/customers` | ADMIN |
