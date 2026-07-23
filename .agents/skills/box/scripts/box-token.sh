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
# env/dotenv 経由の値は ~ が展開されないため、先頭 ~/ を $HOME/ に正規化する
stripped="${token_file#\~/}"
[ "$stripped" != "$token_file" ] && token_file="$HOME/$stripped"
refresh="${BOX_REFRESH_TOKEN:-}"
if [ -z "$refresh" ] && [ -f "$token_file" ]; then
	refresh="$(<"$token_file")"
fi
# 手動 export/手動保存で混入し得る改行/CR/空白を除去する（token は非空白のみ）。
# 環境変数・ファイルのどちらの経路でも同じ正規化を適用して挙動を対称にする。
refresh="$(printf '%s' "$refresh" | tr -d '[:space:]')"
: "${refresh:?refresh token が無い（BOX_REFRESH_TOKEN か $token_file を設定）}"

# refresh_token・client_secret を curl の argv（ps/proc）に載せないよう、umask 077 の一時ファイル経由で
# 渡す（--data-urlencode name@file は curl がファイル内容を読んで URL エンコードする。argv には
# ファイル名しか現れない。送信ボディは name=value 直挿しと同一）。client_id は秘密でないため直挿し。
secret_dir="$(mktemp -d "${TMPDIR:-/tmp}/box-token.XXXXXX")"
trap 'rm -rf "$secret_dir"' EXIT
(
	umask 077
	printf '%s' "$refresh" >"$secret_dir/refresh"
	printf '%s' "$BOX_CLIENT_SECRET" >"$secret_dir/secret"
)

resp="$(curl -sS https://api.box.com/oauth2/token \
	-d grant_type=refresh_token \
	--data-urlencode "client_id=$BOX_CLIENT_ID" \
	--data-urlencode "client_secret@$secret_dir/secret" \
	--data-urlencode "refresh_token@$secret_dir/refresh")"

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
if [ -n "$new_refresh" ]; then
	(
		umask 077
		mkdir -p "$(dirname "$token_file")"
		printf '%s' "$new_refresh" >"$token_file"
	)
fi

printf '%s' "$access"
