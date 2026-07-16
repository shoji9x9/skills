---
argument-hint: <Box への操作 (一覧/取得/検索/アップロード 等)>
description: Box のファイル/フォルダを Box REST API（curl）で参照・検索・更新するスキル。対象フォルダの一覧取得、ファイルのメタ取得・ダウンロード・検索、アップロード・新バージョン作成などを、アクセストークン（Dev Token または OAuth refresh）で実行したいときに使う。「Box のファイルを見て/取得して」「Box にアップロード」「Box フォルダを一覧」「Box を検索」「box」等で発動する。
license: MIT
name: box
---
# Box

Box の content を Box REST API で直接操作する。MCP・SDK・追加ランタイムは不要で、`curl` と `jq` だけで動く。

## 前提

- **ツール**: `curl`, `jq`, bash（同梱スクリプトは `set -o pipefail` 等の bash 機能を使うため、POSIX sh では動かない）
- **認証情報**: Dev Token（`BOX_ACCESS_TOKEN`）または OAuth refresh 用の `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` ＋ refresh token
- コマンド例は bash 前提。Windows では WSL / Git Bash 等の bash 環境で実行する

以下、`<skill>` はインストール先のスキルディレクトリ（同梱スクリプトの起点）を指す。

## 認証

すべての呼び出しは `Authorization: Bearer <token>` を付ける。トークンは同梱スクリプトで取得する（環境変数の有無で方式が切り替わる）。

```bash
TOKEN="$(bash <skill>/scripts/box-token.sh)"
```

| 方式          | 必要な環境変数                                        | 特徴                                                                                                     |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Dev Token     | `BOX_ACCESS_TOKEN`                                    | Box Developer Console で発行する 60 分有効トークン。即時・管理者承認不要。期限切れごとに再発行            |
| OAuth refresh | `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` / refresh token | refresh token から access token を都度取得。持続的。refresh token はローテーションするため自動保存する    |

OAuth refresh の refresh token は `BOX_REFRESH_TOKEN`、または `BOX_REFRESH_TOKEN_FILE`（既定 `~/.config/box/refresh_token`）から読む。`BOX_ACCESS_TOKEN` が設定されていればそちらを優先する。

OAuth refresh を使う場合、初回だけ Client ID/Secret の取得と認可コード交換が必要になる。手順は [`references/oauth-setup.md`](references/oauth-setup.md) を参照する。

必要な環境変数は、同梱テンプレート [`assets/.env.example`](assets/.env.example) を `.env` に複製して設定する（インストール先に同種の設定があればそれを優先する）。

**秘匿情報の扱い**: トークン・client secret・refresh token はリポジトリにコミットしない。環境変数（direnv 等）か、リポジトリ外のファイル（既定の `~/.config/box/`）で管理する。

疎通確認:

```bash
curl -sSf "https://api.box.com/2.0/users/me" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, name, login}'
```

## 対象フォルダ

操作対象フォルダはプロジェクト固有の値なので、環境変数 `BOX_ROOT_FOLDER_ID` で指定する（`.env` 等で設定）。未設定時は Box のルート（`0`）にフォールバックする。

```bash
FOLDER="${BOX_ROOT_FOLDER_ID:-0}"
```

フォルダ ID は Box の Web UI でフォルダを開いたときの URL 末尾（`.../folder/<ID>` の `<ID>` 部分）。共有リンクしか無いフォルダは「注意」の `BoxApi` ヘッダを併用する。

## レシピ

### フォルダ内の一覧

```bash
# marker ベースで全ページを辿る（大きいフォルダでも取りこぼさない）
# next_marker は不透明トークンなので -G + --data-urlencode で必ずエンコードする
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

件数が確実に少ないと分かっている場合だけ、`limit` 一発（`?limit=1000&fields=...`）に簡略化してよい。

### ファイルのメタ取得

```bash
curl -sSf "https://api.box.com/2.0/files/<file-id>?fields=id,name,size,extension,modified_at,sha1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### ファイルのダウンロード

```bash
curl -fL "https://api.box.com/2.0/files/<file-id>/content" \
  -H "Authorization: Bearer $TOKEN" -o /tmp/box-download.bin
```

### 検索（対象フォルダ配下に限定）

```bash
curl -sSf -G "https://api.box.com/2.0/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "query=<検索語>" \
  --data-urlencode "ancestor_folder_ids=$FOLDER" \
  --data-urlencode "fields=id,name,type,modified_at" | jq '.entries[] | {id, type, name}'
```

検索は既定 30 件・最大 200 件（`--data-urlencode "limit=200"`）を返す。`total_count` がそれを超える場合は `--data-urlencode "offset=<n>"` を `0, 200, 400, ...` と進め、`offset` が `total_count` に達するまで全ページを辿る。

### アップロード（新規ファイル）

```bash
curl -sSf -X POST "https://upload.box.com/api/2.0/files/content" \
  -H "Authorization: Bearer $TOKEN" \
  -F "attributes={\"name\":\"report.txt\",\"parent\":{\"id\":\"$FOLDER\"}}" \
  -F file=@/tmp/report.txt | jq '.entries[0] | {id, name, size}'
```

### 新バージョンのアップロード（既存ファイルの更新）

```bash
curl -sSf -X POST "https://upload.box.com/api/2.0/files/<file-id>/content" \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@/tmp/report.txt | jq '.entries[0] | {id, name, modified_at}'
```

## 注意

- 共有リンク経由でしか権限が無いフォルダは、リクエストに `-H "BoxApi: shared_link=<共有リンクURL>"` を付ける。直接コラボレーション済みなら不要。
- 書き込み後は read-after-write で結果（`id`/`modified_at`）を確認する。
- 429（rate limit）や 5xx は `Retry-After` を見て指数バックオフで再試行する。
