# 起動・到達・再実行の検証

- 対象 target: current-rebuilt（`http://localhost:8080/ship/`）
- 実施日時: 2026-08-26T03:10:00Z

## 工程 7: 起動・疎通・認証・主要画面到達

| 確認 | 結果 | 根拠 |
|---|---|---|
| 起動 | 通った | `docker compose up -d` の後、`http://localhost:8080/ship/login` が 200 を返し、ログイン画面を描画した |
| 認証（admin） | 通った | `bootstrap-admin` でログインし、受注一覧へ遷移した |
| 受注一覧 `/orders` | 到達した | 一覧の表を描画した（0 件） |
| 得意先一覧 `/customers` | 到達した | 一覧の表を描画した（0 件） |

## 工程 8: 再構築の再実行

- 空の DB から `bootstrap/schema.sh` → `bootstrap/seed.sh` を実行し、工程 7 をもう一度通した。結果は 1 回目と同じだった
