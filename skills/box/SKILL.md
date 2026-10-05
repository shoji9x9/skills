---
name: box
description: Box のファイル/フォルダを Box REST API（curl）で参照・検索・更新するスキル。対象フォルダの一覧取得、ファイルのメタ取得・ダウンロード・検索、アップロード・新バージョン作成などを、アクセストークン（Dev Token または OAuth refresh）で実行したいときに使う。「Box のファイルを見て/取得して」「Box にアップロード」「Box フォルダを一覧」「Box を検索」「box」等で発動する。
argument-hint: "<Box への操作 (一覧/取得/検索/アップロード 等)>"
license: MIT
---

# Box

Box のファイルとフォルダを、Box REST API で直接操作する。MCP・SDK・追加のランタイムは要らず、`curl` と `jq` だけで動く。

## 前提

- ツール: `curl`、`jq`、bash（同梱のスクリプトは `set -o pipefail` などの bash の機能を使うので、POSIX sh では動かない）
- 認証情報: Dev Token（`BOX_ACCESS_TOKEN`）か、OAuth refresh 用の `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` と refresh token
- コマンド例は bash を前提にしている。Windows では WSL や Git Bash などの bash の環境で実行する

以下の `<skill>` は、インストール先のスキルのディレクトリ（同梱のスクリプトの起点）を表す。

## 認証

すべての呼び出しに `Authorization: Bearer <token>` を付ける。トークンは同梱のスクリプトで取得する（設定した環境変数によって方式が変わる）。

```bash
TOKEN="$(bash <skill>/scripts/box-token.sh)"
```

| 方式          | 必要な環境変数                                        | 特徴                                                                                                     |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Dev Token     | `BOX_ACCESS_TOKEN`                                    | Box Developer Console で発行する、60 分有効なトークン。すぐ使え、管理者の承認は要らない。期限が切れるたびに発行し直す |
| OAuth refresh | `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` / refresh token | refresh token から access token をそのつど取得する。長く使える。refresh token は使うたびに変わるので、自動で保存する |

OAuth refresh の refresh token は、`BOX_REFRESH_TOKEN` か `BOX_REFRESH_TOKEN_FILE`（デフォルトは `$HOME/.config/box/refresh_token`）から読む。`BOX_ACCESS_TOKEN` が設定されていれば、そちらを優先する。

OAuth refresh を使う場合は、最初の 1 回だけ、Client ID と Client Secret の取得と、認可コードの交換が要る。手順は [`references/oauth-setup.md`](references/oauth-setup.md) にある。

必要な環境変数は、同梱のテンプレート [`assets/.env.example`](assets/.env.example) を `.env` にコピーして設定する（インストール先に同じ種類の設定があれば、それを優先する）。

トークン・client secret・refresh token は秘密の情報なので、リポジトリに commit しない。環境変数（direnv など）か、リポジトリの外のファイル（デフォルトの `$HOME/.config/box/`）で管理する。
値をログ・標準出力・成果物に出さない。ユーザーが値を示してきた場合も、その値を**繰り返して書かない**（コマンド例や説明では、プレースホルダや環境変数名に置き換える）。

接続できるかは、次のコマンドで確かめる。

```bash
curl -sSf "https://api.box.com/2.0/users/me" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, name, login}'
```

## 対象フォルダ

操作の対象のフォルダはプロジェクトごとに違うので、環境変数 `BOX_ROOT_FOLDER_ID` で指定する（`.env` などで設定する）。設定が無ければ、Box のルート（`0`）を使う。

```bash
FOLDER="${BOX_ROOT_FOLDER_ID:-0}"
```

フォルダ ID は、Box の Web UI でフォルダを開いたときの URL の末尾（`.../folder/<ID>` の `<ID>` の部分）である。共有リンクしか無いフォルダには、「注意」にある `BoxApi` ヘッダも付ける。

## レシピ

### フォルダ内の一覧

```bash
# marker を使ってすべてのページを取得する（大きいフォルダでも取得できない分が出ない）
# next_marker は中身を解釈できないトークンなので、-G と --data-urlencode で必ずエンコードする
marker=""
while :; do
  args=(-G "https://api.box.com/2.0/folders/$FOLDER/items"
    -H "Authorization: Bearer $TOKEN"
    --data-urlencode "usemarker=true"
    --data-urlencode "limit=1000"
    --data-urlencode "fields=id,name,type,size,modified_at")
  [ -n "$marker" ] && args+=(--data-urlencode "marker=$marker")
  page="$(curl -sSf "${args[@]}")"
  printf '%s' "$page" | jq -c '.entries[] | {id, type, name, size, modified_at}'
  marker="$(printf '%s' "$page" | jq -r '.next_marker // empty')"
  [ -n "$marker" ] || break
done
```

件数が確実に少ないと分かっている場合だけ、`limit` を付けた 1 回の取得（`?limit=1000&fields=...`）にしてよい。

### ファイルのメタデータの取得

```bash
curl -sSf "https://api.box.com/2.0/files/<file-id>?fields=id,name,size,extension,modified_at,sha1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### ファイルのダウンロード

```bash
curl -fL "https://api.box.com/2.0/files/<file-id>/content" \
  -H "Authorization: Bearer $TOKEN" -o /tmp/box-download.bin
```

### 検索（対象のフォルダの下に限る）

```bash
curl -sSf -G "https://api.box.com/2.0/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "query=<検索語>" \
  --data-urlencode "ancestor_folder_ids=$FOLDER" \
  --data-urlencode "fields=id,name,type,modified_at" | jq '.entries[] | {id, type, name}'
```

検索は、デフォルトで 30 件、最大で 200 件（`--data-urlencode "limit=200"`）を返す。
`total_count` がそれを超える場合は、`--data-urlencode "offset=<n>"` を `0, 200, 400, ...` と進め、`offset` が `total_count` に達するまですべてのページを取得する。

### アップロード（新規ファイル）

```bash
curl -sSf -X POST "https://upload.box.com/api/2.0/files/content" \
  -H "Authorization: Bearer $TOKEN" \
  -F "attributes={\"name\":\"report.txt\",\"parent\":{\"id\":\"$FOLDER\"}}" \
  -F file=@/tmp/report.txt | jq '.entries[0] | {id, name, size}'
```

### 新しいバージョンのアップロード（既存のファイルの更新）

```bash
curl -sSf -X POST "https://upload.box.com/api/2.0/files/<file-id>/content" \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@/tmp/report.txt | jq '.entries[0] | {id, name, modified_at}'
```

## 注意

- 共有リンクを通してしか権限が無いフォルダには、リクエストに `-H "BoxApi: shared_link=<共有リンクURL>"` を付ける。直接コラボレーターになっていれば要らない。
- 書き込んだ後は、読み直して結果（`id`・`modified_at`）を確かめる。
- 429（rate limit）や 5xx が返ったら、`Retry-After` を見て、待ち時間を倍にしながら再試行する。
