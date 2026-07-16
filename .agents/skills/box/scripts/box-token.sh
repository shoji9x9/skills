#!/usr/bin/env bash
# Box アクセストークンを標準出力に出す。
# 優先順: BOX_ACCESS_TOKEN（Dev Token 等）→ OAuth refresh token フロー
set -euo pipefail

if [ -n "${BOX_ACCESS_TOKEN:-}" ]; then
	printf '%s' "$BOX_ACCESS_TOKEN"
	exit 0
fi

: "${BOX_CLIENT_ID:?BOX_ACCESS_TOKEN か BOX_CLIENT_ID/BOX_CLIENT_SECRET が必要}"
: "${BOX_CLIENT_SECRET:?BOX_CLIENT_SECRET が未設定}"

token_file="${BOX_REFRESH_TOKEN_FILE:-$HOME/.config/box/refresh_token}"
refresh="${BOX_REFRESH_TOKEN:-}"
if [ -z "$refresh" ] && [ -f "$token_file" ]; then
	refresh="$(cat "$token_file")"
fi
: "${refresh:?refresh token が無い（BOX_REFRESH_TOKEN か $token_file を設定）}"

resp="$(curl -s https://api.box.com/oauth2/token \
	-d grant_type=refresh_token \
	-d "client_id=$BOX_CLIENT_ID" \
	-d "client_secret=$BOX_CLIENT_SECRET" \
	-d "refresh_token=$refresh")"

err="$(printf '%s' "$resp" | jq -r '.error // empty')"
if [ -n "$err" ]; then
	echo "トークン更新失敗: $err - $(printf '%s' "$resp" | jq -r '.error_description // ""')" >&2
	echo "（refresh token が失効している可能性があります。box-oauth-init.sh で再取得してください）" >&2
	exit 1
fi

access="$(printf '%s' "$resp" | jq -r '.access_token // empty')"
new_refresh="$(printf '%s' "$resp" | jq -r '.refresh_token // empty')"
if [ -z "$access" ]; then
	echo "access_token を取得できませんでした" >&2
	exit 1
fi

# refresh token は都度ローテーションするため新しい値を保存する
if [ -n "$new_refresh" ] && [ "$new_refresh" != "null" ]; then
	mkdir -p "$(dirname "$token_file")"
	(
		umask 077
		printf '%s' "$new_refresh" >"$token_file"
	)
fi

printf '%s' "$access"
