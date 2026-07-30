---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# curl の送信値はエンコードし、秘密値は argv に載せない

## 送信値は --data-urlencode でエンコードする

配布スキル（`skills/<name>/`）の curl による API 例・スクリプトでは、変数値を URL クエリ / フォームに
**直挿ししない**。`curl -d "k=$v"` や `?k=$v` の直挿しは送信値をエンコードせず、`+` / `=` / `/` や
不透明トークン（refresh token・ページング marker 等）を含む値で壊れ、失敗や取りこぼしになる。

- 変数値は `--data-urlencode "k=$v"` で送る。GET のクエリに載せる場合は `-G` を併用する。
- 固定リテラル（`grant_type=refresh_token` 等、変数を含まない値）は対象外でよい。

## 秘密値は argv（ps / proc）に載せない

`--data-urlencode "k=$v"` は**値が curl の argv に載る**ため、秘密値（トークン・`client_secret`・認可コード）では
使わない。curl の実行時間 ≒ スクリプトの実行時間なので、その間ずっと `ps` / `/proc/<pid>/cmdline` から見える。

- 秘密値は `umask 077` の一時ファイルに書き、`--data-urlencode "k@file"` で渡す（curl がファイルを読んで URL
  エンコードするため送信ボディは `k=$v` と同一。argv にはファイル名だけが載る）。`trap '...' EXIT` で消す。
- 秘密でない識別子（`client_id` 等）は直挿し可。
- **対策の完了条件は「その値が argv で渡る全プロセスを塞いだこと」**。エントリスクリプトの引数を stdin に
  変えても、同じ値を argv で受け取る子プロセス（curl 等）が残れば目的は未達で、mitigation はほぼ無効になる。
  レビューでも、値を argv から外した対策を見たら**次の渡し先**まで追って露出が消えたかを確認する。
