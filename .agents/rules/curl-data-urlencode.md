---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# curl の送信値は --data-urlencode でエンコードする

配布スキル（`skills/<name>/`）の curl による API 例・スクリプトでは、変数値を URL クエリ / フォームに
**直挿ししない**。`curl -d "k=$v"` や `?k=$v` の直挿しは送信値をエンコードせず、`+` / `=` / `/` や
不透明トークン（refresh token・ページング marker 等）を含む値で壊れ、失敗や取りこぼしになる。

- 変数値は `--data-urlencode "k=$v"` で送る。GET のクエリに載せる場合は `-G` を併用する。
- 固定リテラル（`grant_type=refresh_token` 等、変数を含まない値）は対象外でよい。
