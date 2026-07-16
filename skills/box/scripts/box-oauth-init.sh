#!/usr/bin/env bash
# Box OAuth 2.0 の認可コードを access/refresh token に交換し、refresh token を保存する（初回のみ実行）。
# 使い方: box-oauth-init.sh <authorization_code>
# 必要env: BOX_CLIENT_ID, BOX_CLIENT_SECRET
# 任意env: BOX_REDIRECT_URI（既定 https://app.box.com）, BOX_REFRESH_TOKEN_FILE（既定 ~/.config/box/refresh_token）
set -euo pipefail

code="${1:-}"
: "${code:?使い方: box-oauth-init.sh <authorization_code>}"
: "${BOX_CLIENT_ID:?BOX_CLIENT_ID が未設定}"
: "${BOX_CLIENT_SECRET:?BOX_CLIENT_SECRET が未設定}"

redirect_uri="${BOX_REDIRECT_URI:-https://app.box.com}"
token_file="${BOX_REFRESH_TOKEN_FILE:-$HOME/.config/box/refresh_token}"

resp="$(curl -s https://api.box.com/oauth2/token \
	-d grant_type=authorization_code \
	-d "code=$code" \
	-d "client_id=$BOX_CLIENT_ID" \
	-d "client_secret=$BOX_CLIENT_SECRET" \
	-d "redirect_uri=$redirect_uri")"

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

mkdir -p "$(dirname "$token_file")"
(
	umask 077
	printf '%s' "$refresh" >"$token_file"
)

echo "成功: refresh_token を $token_file に保存しました（access_token 長=$access_len）"
echo "次は .env を BOX_CLIENT_ID/BOX_CLIENT_SECRET のみにすれば、box-token.sh が自動でトークン更新します。"
