# 実行環境（受領物・2026-08-12）

## データベース

- Oracle Database 19c（19.19.0.0）
- キャラクタセット: AL32UTF8 / 各国語キャラクタセット: AL16UTF16
- DB タイムゾーン: Asia/Tokyo
- 初期化パラメータ `COMPATIBLE = 19.0.0`
- インスタンス既定の `NLS_SORT` は `BINARY`。アプリ接続時のみ運用チームのログオン処理（`db/logon_trigger.sql`）で上書きしている
- スキーマ（ユーザー）は `SHIPAPP`

## アプリケーション

- .NET 8 / ASP.NET Core、IIS でホスト
- マイグレーションは Entity Framework Core（`app/Migrations/`）
- 接続文字列は `app/appsettings.Staging.json`（パスワードは環境変数から注入）
- `http://<host>/ship/`

## 主要画面

| 画面 | パス |
|---|---|
| ログイン | `/login` |
| 受注一覧 | `/orders` |
| 得意先一覧 | `/customers` |
