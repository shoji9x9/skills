---
argument-hint: <Box への操作 (一覧/取得/検索/アップロード 等)>
description: Box のファイル/フォルダを Box REST API（curl）で参照・検索・更新するスキル。対象フォルダの一覧取得、ファイルのメタ取得・ダウンロード・検索、アップロード・新バージョン作成などを、アクセストークン（Dev Token または OAuth refresh）で実行したいときに使う。「Box のファイルを見て/取得して」「Box にアップロード」「Box フォルダを一覧」「Box を検索」「box」等で発動する。
license: MIT
name: box
---
# Box

Box のファイルとフォルダを、Box REST API で直接操作する。MCP・SDK・追加のランタイムは要らず、`curl` と `jq` だけで動く。

## 前提

- ツール: `curl`、`jq`、bash（同梱のスクリプトは `set -o pipefail` などの bash の機能を使うので、POSIX sh では動かない）
- 認証情報: Dev Token（`BOX_ACCESS_TOKEN`）か、OAuth refresh 用の `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` と refresh token
- 設定: 対象のフォルダを設定ファイル（`box.jsonc`）に置くときだけ、読むのに Node.js が要る。設定ファイルが 1 つも無ければ Node.js は要らない（下の「対象フォルダ」）
- コマンド例は bash を前提にしている。Windows では WSL や Git Bash などの bash の環境で実行する

以下の `<skill>` は、インストール先のスキルのディレクトリ（同梱のスクリプトの起点）を表す。

## 認証

すべての呼び出しに `Authorization: Bearer <token>` のヘッダーを付ける。トークンは同梱のスクリプトで取得する（設定した環境変数によって方式が変わる）。
ヘッダーは、自分だけが読めるファイルに書いて `-H @<ファイル>` で curl に渡す。
`-H "Authorization: Bearer $TOKEN"` と書くと、トークンが curl の argv に載り、curl が動いている間、同じホストの他のユーザーが `ps` や `/proc/<pid>/cmdline` から読める。
`printf` は bash の組み込みのコマンドなので、ファイルに書くときは argv に載らない。

```bash
TOKEN="$(bash <skill>/scripts/box-token.sh)"
BOX_AUTH="$(mktemp)"   # mktemp は、自分だけが読み書きできるファイル（0600）を作る
trap 'rm -f "$BOX_AUTH"' EXIT
printf 'Authorization: Bearer %s\n' "$TOKEN" >"$BOX_AUTH"
```

この後の例は、すべてこの `BOX_AUTH` を使う。`trap` がシェルの終わるときに `BOX_AUTH` を消すので、この例と API の呼び出しは同じシェルで実行する。
エージェントのツールのように、コマンドの呼び出しごとにシェルが終わる環境では、この例と続けて行う API の呼び出しを 1 つの呼び出しにまとめる。下の「対象フォルダ」で取得する `FOLDER` も、同じ呼び出しの中で取得する。
OAuth refresh では、`box-token.sh` を実行するたびに refresh token が新しい値に変わるので、この例を並列に実行しない。同じ refresh token を 2 つの実行が読むと、後の実行が失敗する。

| 方式          | 必要な環境変数                                        | 特徴                                                                                                     |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Dev Token     | `BOX_ACCESS_TOKEN`                                    | Box Developer Console で発行する、60 分有効なトークン。すぐ使え、管理者の承認は要らない。期限が切れるたびに発行し直す |
| OAuth refresh | `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` / refresh token | refresh token から access token をそのつど取得する。長く使える。refresh token は使うたびに変わるので、自動で保存する |

OAuth refresh の refresh token は、`BOX_REFRESH_TOKEN` か `BOX_REFRESH_TOKEN_FILE`（デフォルトは `~/.config/box/refresh_token`）から読む。`BOX_ACCESS_TOKEN` が設定されていれば、そちらを優先する。
`~` は `HOME` のディレクトリで、`HOME` が無いか空なら、OS に登録されたホーム（`/etc/passwd` や LDAP などに登録された、そのユーザーのホーム）を使う。
OS にそのユーザーの登録が無ければ、ホームは決まらない。
置き場所がデフォルトか `~/` で始まり、ホームが絶対パスに決まらなければ、スクリプトは API を呼ぶ前に止まる。そのときは `BOX_REFRESH_TOKEN_FILE` に絶対パスを設定する。
`box-token.sh` は refresh token が見つかった後に、`box-oauth-init.sh` は Client ID と Client Secret を確かめた後、認可コードを読む前に、保存先のディレクトリを作る。
ディレクトリを作れないときと、保存先のファイルに書き込めないとき（ファイルが無ければ、ディレクトリに書き込めないとき）は、API を呼ぶ前に止まる。
保存先がディレクトリのときも止まる。保存先が行き先の無いシンボリックリンクなら、リンクをたどった先のディレクトリに書き込めるかを見る。
`BOX_REFRESH_TOKEN_FILE` を指定したときも同じである。そのときは、書き込める場所を `BOX_REFRESH_TOKEN_FILE` に設定する。
`BOX_REFRESH_TOKEN_FILE` の相対パスは、スクリプトを実行したディレクトリからのパスとして扱う。リポジトリの中に保存しないよう、絶対パスで設定する。

OAuth refresh を使う場合は、最初の 1 回だけ、Client ID と Client Secret の取得と、認可コードの交換が要る。手順は [`references/oauth-setup.md`](references/oauth-setup.md) にある。

必要な環境変数は、同梱のテンプレート [`assets/.env.example`](assets/.env.example) を `.env` にコピーして設定する（インストール先に同じ種類の設定があれば、それを優先する）。

トークン・client secret・refresh token は秘密の情報なので、リポジトリに commit しない。環境変数（direnv など）か、リポジトリの外のファイル（デフォルトの `~/.config/box/`）で管理する。
値をログ・標準出力・成果物に出さない。ユーザーが値を示してきた場合も、その値を**繰り返して書かない**（コマンド例や説明では、プレースホルダや環境変数名に置き換える）。

接続できるかは、次のコマンドで確かめる。

```bash
curl -sSf "https://api.box.com/2.0/users/me" \
  -H @"$BOX_AUTH" | jq '{id, name, login}'
```

## 対象フォルダ

操作の対象のフォルダはプロジェクトごとに違うので、設定ファイルの `root_folder_id` で指定する。
全員が同じ共有フォルダを使うならリポジトリの設定（`.config/skills/shoji9x9/box.jsonc`）に、自分だけのフォルダなら `.config/skills/shoji9x9/box.local.jsonc` に、文字列で書く。
どちらにも無ければ、Box のルート（`0`）を使う。置き場所・層・書き込みの決まりは [`references/config-files.md`](references/config-files.md) にある。

```jsonc
// .config/skills/shoji9x9/box.jsonc
{ "root_folder_id": "123456789" }
```

ID は同梱のスクリプトで取得する。設定の誤りや、使わなくなった環境変数 `BOX_ROOT_FOLDER_ID` が残っているときは、理由を stderr に出して 1 で終わるので、そのまま止まる。

```bash
FOLDER="$(bash <skill>/scripts/box-folder.sh)" || exit 1
```

設定ファイルが 1 つも無ければ、スクリプトは Node.js を使わずに `0` を出す。設定ファイルがあって Node.js が無ければ、`0` で続けずに止まる。

フォルダ ID は、Box の Web UI でフォルダを開いたときの URL の末尾（`.../folder/<ID>` の `<ID>` の部分）である。共有リンクしか無いフォルダには、「注意」にある `BoxApi` ヘッダも付ける。

## レシピ

### フォルダ内の一覧

```bash
# marker を使ってすべてのページを取得する（大きいフォルダでも取得できない分が出ない）
# next_marker は中身を解釈できないトークンなので、-G と --data-urlencode で必ずエンコードする
marker=""
while :; do
  args=(-G "https://api.box.com/2.0/folders/$FOLDER/items"
    -H @"$BOX_AUTH"
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
  -H @"$BOX_AUTH" | jq
```

### ファイルのダウンロード

ダウンロード先も `mktemp` で作る。`/tmp/box-download.bin` のように名前を決めて `/tmp` に置くファイルは、同じホストの他のユーザーが先に作れるので使わない。
`trap` は前の設定を置き換えるので、`BOX_AUTH` と一緒に消すように設定し直す。

```bash
BOX_DOWNLOAD="$(mktemp)"
trap 'rm -f "$BOX_AUTH" "$BOX_DOWNLOAD"' EXIT
if curl -fL "https://api.box.com/2.0/files/<file-id>/content" \
  -H @"$BOX_AUTH" -o "$BOX_DOWNLOAD"; then
  wc -c <"$BOX_DOWNLOAD"   # 中身を読む処理（この例はバイト数の確認）
else
  echo "box: ダウンロードに失敗した" >&2
  false   # if 全体を失敗で終え、失敗を終了コードに残す
fi
```

中身を読む処理は `then` の中に書く。curl が失敗したときに、空の一時ファイルを読まないためである。

`BOX_DOWNLOAD` は、シェルが終わるときに消える。中身は、認証の例と同じく、ダウンロードと同じシェルの中で読む。
ファイルを残すなら、`-o` に利用者が指定した保存先のパスを渡す。

### 検索（対象のフォルダの下に限る）

```bash
curl -sSf -G "https://api.box.com/2.0/search" \
  -H @"$BOX_AUTH" \
  --data-urlencode "query=<検索語>" \
  --data-urlencode "ancestor_folder_ids=$FOLDER" \
  --data-urlencode "fields=id,name,type,modified_at" | jq '.entries[] | {id, type, name}'
```

検索は、デフォルトで 30 件、最大で 200 件（`--data-urlencode "limit=200"`）を返す。
`total_count` がそれを超える場合は、`--data-urlencode "offset=<n>"` を `0, 200, 400, ...` と進め、`offset` が `total_count` に達するまですべてのページを取得する。

### アップロード（新規ファイル）

アップロードするファイルは、利用者が指定したパスで渡す。`/tmp/report.txt` のように名前を決めて `/tmp` に置くファイルは、他のユーザーが同じ名前で先に置けるので使わない。
パスと Box に置くときのファイル名は、単引用符で囲んで変数に入れる。シェルは単引用符の中の `$` やバッククォートを展開しない。値に単引用符を含むときは、その単引用符を `'\''` と書く。
パスは絶対パスで書く。エージェントのツールでは呼び出しごとに作業ディレクトリが変わりうるので、相対パスは別の場所から解決されることがある。
`~` は単引用符の中で展開されないので、ホームの下のファイルもホームのディレクトリから書く。WSL で Windows のファイルを渡すときは、`/mnt/c/...` の形で書く。

ファイルは、パスを curl の `-F` に書かず、シェルのリダイレクト（`<`）で stdin から送る（`file=@-`）。
`-F` に書いたパスは curl が `;` や引用符を区切りとして読むが、リダイレクトのパスはシェルがそのまま開く。
Box は、ファイルの名前を `attributes` の `name` から取り、`file` の部分の `filename` を使わない（<https://developer.box.com/reference/post-files-content/>）。そのため `filename` には決まった値（`upload`）を書く。
`attributes` は `jq` で組み立てて名前をエスケープし、`--form-string` で送る。`-F` で送ると、curl が名前の中の `;` を区切りとして読み、JSON が途中で切れる。
Box は `attributes` が `file` より前にあることを求めるので、この順に書く。

```bash
UPLOAD_FILE='<アップロードするファイルの絶対パス>'
UPLOAD_NAME='<Box に置くファイル名>'
curl -sSf -X POST "https://upload.box.com/api/2.0/files/content" \
  -H @"$BOX_AUTH" \
  --form-string "attributes=$(jq -cn --arg name "$UPLOAD_NAME" --arg parent "$FOLDER" '{name: $name, parent: {id: $parent}}')" \
  -F 'file=@-;filename=upload' <"$UPLOAD_FILE" | jq '.entries[0] | {id, name, size}'
```

### 新しいバージョンのアップロード（既存のファイルの更新）

```bash
UPLOAD_FILE='<アップロードするファイルの絶対パス>'
curl -sSf -X POST "https://upload.box.com/api/2.0/files/<file-id>/content" \
  -H @"$BOX_AUTH" \
  -F 'file=@-;filename=upload' <"$UPLOAD_FILE" | jq '.entries[0] | {id, name, modified_at}'
```

## 注意

- 共有リンクを通してしか権限が無いフォルダには、リクエストに `-H "BoxApi: shared_link=<共有リンクURL>"` を付ける。直接コラボレーターになっていれば要らない。
- 書き込んだ後は、読み直して結果（`id`・`modified_at`）を確かめる。
- 429（rate limit）や 5xx が返ったら、`Retry-After` を見て、待ち時間を倍にしながら再試行する。
