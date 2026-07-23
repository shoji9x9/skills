#!/usr/bin/env bash
# Box OAuth 2.0 の認可コードを access/refresh token に交換し、refresh token を保存する（初回のみ実行）。
# 使い方: box-oauth-init.sh（認可コードは引数ではなくプロンプト or stdin から入力する）
#   対話: box-oauth-init.sh を実行し、プロンプトに認可コードを貼り付けて Enter（ps/proc 露出を確実に避ける）
#   stdin: box-oauth-init.sh < code.txt（自動実行向け。値を argv に載せない）
# 認可コードを引数で渡さないのは、実行中に ps/proc から他プロセスへ露出させないため。
# 必要env: BOX_CLIENT_ID, BOX_CLIENT_SECRET
# 任意env: BOX_REDIRECT_URI（既定 https://app.box.com）, BOX_REFRESH_TOKEN_FILE（既定 $HOME/.config/box/refresh_token）
set -euo pipefail

# 旧来の `box-oauth-init.sh <code>` 形式を弾く。引数で渡すと ps/proc に露出し、かつ現在は
# 無視されて stdin 待ちになり混乱するため、明示的にエラーで新しい入力方法へ誘導する。
if [ "$#" -gt 0 ]; then
	echo "エラー: 認可コードは引数で渡しません（ps/proc 露出を避けるため）。引数なしで実行し、プロンプトに貼り付けるか stdin で渡してください（box-oauth-init.sh < code.txt）。" >&2
	exit 2
fi

# 認可コードは引数で受け取らずプロンプト（TTY）または stdin（パイプ）から読む。
if [ -t 0 ]; then
	printf '認可コードを貼り付けて Enter: ' >&2
fi
IFS= read -r code || true
# 貼り付け時に混入し得る前後の空白/改行/CR を除去する（認可コードは非空白のみ）。
code="$(printf '%s' "$code" | tr -d '[:space:]')"
: "${code:?認可コードが空です（プロンプトに貼り付けるか stdin で渡してください）}"
: "${BOX_CLIENT_ID:?BOX_CLIENT_ID が未設定}"
: "${BOX_CLIENT_SECRET:?BOX_CLIENT_SECRET が未設定}"

redirect_uri="${BOX_REDIRECT_URI:-https://app.box.com}"
token_file="${BOX_REFRESH_TOKEN_FILE:-$HOME/.config/box/refresh_token}"
# env/dotenv 経由の値は ~ が展開されないため、先頭 ~/ を $HOME/ に正規化する
stripped="${token_file#\~/}"
[ "$stripped" != "$token_file" ] && token_file="$HOME/$stripped"

# 認可コード・client_secret を curl の argv（ps/proc）に載せないよう、umask 077 の一時ファイル経由で
# 渡す（--data-urlencode name@file は curl がファイル内容を読んで URL エンコードする。argv には
# ファイル名しか現れない。送信ボディは name=value 直挿しと同一）。client_id は秘密でないため直挿し。
secret_dir="$(mktemp -d "${TMPDIR:-/tmp}/box-oauth.XXXXXX")"
trap 'rm -rf "$secret_dir"' EXIT
(
	umask 077
	printf '%s' "$code" >"$secret_dir/code"
	printf '%s' "$BOX_CLIENT_SECRET" >"$secret_dir/secret"
)

resp="$(curl -sS https://api.box.com/oauth2/token \
	-d grant_type=authorization_code \
	--data-urlencode "code@$secret_dir/code" \
	--data-urlencode "client_id=$BOX_CLIENT_ID" \
	--data-urlencode "client_secret@$secret_dir/secret" \
	--data-urlencode "redirect_uri=$redirect_uri")"

err="$(printf '%s' "$resp" | jq -r '.error // empty')"
if [ -n "$err" ]; then
	echo "トークン交換失敗: $err - $(printf '%s' "$resp" | jq -r '.error_description // ""')" >&2
	echo "（認可コードは約30秒で失効します。DevTools を開いた状態で認可からやり直してください）" >&2
	exit 1
fi

refresh="$(printf '%s' "$resp" | jq -r '.refresh_token')"
access_len="$(printf '%s' "$resp" | jq -r '.access_token | length')"
if [ -z "$refresh" ] || [ "$refresh" = "null" ]; then
	echo "refresh_token を取得できませんでした" >&2
	exit 1
fi

(
	umask 077
	mkdir -p "$(dirname "$token_file")"
	printf '%s' "$refresh" >"$token_file"
)

echo "成功: refresh_token を $token_file に保存しました（access_token 長=$access_len）"
echo "次は .env を BOX_CLIENT_ID/BOX_CLIENT_SECRET のみにすれば、box-token.sh が自動でトークン更新します。"
