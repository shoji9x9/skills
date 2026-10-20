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

# HOME が無いか空なら、box-folder.sh と同じく、passwd に登録されたホームを使う
home_dir="${HOME:-}"
[ -n "${home_dir}" ] || home_dir=$(
	unset HOME
	printf '%s' ~
)
# passwd にエントリが無いと ~ が展開されずに残る。~ は絶対パスでないので、下の case が止める
# 置き場所のデフォルトは ~/.config/box/refresh_token。
# env/dotenv 経由の値は ~ が展開されないため、先頭 ~/ も上で決めたホームの下に直す
token_file="${BOX_REFRESH_TOKEN_FILE:-}"
stripped="${token_file#\~/}"
token_src="保存先は BOX_REFRESH_TOKEN_FILE で指定した。"
if [ -z "$token_file" ] || [ "$stripped" != "$token_file" ]; then
	[ -n "$token_file" ] || stripped=".config/box/refresh_token"
	# HOME が無いときと空のときを、表示で区別する（%q は、どちらも '' と表示する）
	home_state="HOME が無い"
	[ "${HOME+set}" != "set" ] || home_state="HOME が空である"
	if [ -n "${HOME:-}" ]; then
		token_src="保存先は HOME から決めた。"
		home_reason="$(printf 'HOME=%q が絶対パスでない。' "${HOME}")"
	else
		token_src="${home_state}。保存先は、passwd に登録されたホームから決めた。"
		home_reason="$(printf '%s。passwd に登録されたホーム %q も絶対パスでない。' "${home_state}" "${home_dir}")"
	fi
	# ホームが絶対パスに決まらないまま進むと、更新した後に新しい refresh token を保存できず、その値を失う。
	# Box は更新に使った古い refresh token を無効にするので、API を呼ぶ前に止める
	case "${home_dir}" in
	/*) ;;
	*)
		printf 'box-token: refresh token の置き場所を絶対パスに決められない。%sBOX_REFRESH_TOKEN_FILE に絶対パスを設定する（例: export BOX_REFRESH_TOKEN_FILE=/path/to/refresh_token）\n' "${home_reason}" >&2
		exit 1
		;;
	esac
	token_file="${home_dir}/$stripped"
fi
# 環境変数に refresh token が無ければ、保存してあるファイルから読む。
# ここではファイルが在るかだけを見て、中身は書き込めるかを確かめた後に読む
refresh="${BOX_REFRESH_TOKEN:-}"
refresh_in_file=""
if [ -z "$refresh" ] && [ -f "$token_file" ]; then
	refresh_in_file=1
fi
# 手で export や保存をしたときに入りうる改行・CR・空白を除く（token は空白を含まない）。
# 環境変数とファイルのどちらから読んでも、同じ正規化を当てて同じ振る舞いにする。
refresh="$(printf '%s' "$refresh" | tr -d '[:space:]')"
refresh_missing="refresh token が無い（BOX_REFRESH_TOKEN か $token_file を設定）"
# refresh token がどこにも無ければ、保存先のディレクトリを作らずに止める
[ -n "$refresh_in_file" ] || : "${refresh:?$refresh_missing}"
# 保存先のディレクトリを先に作り、書き込めるかを確かめる。ホームが書き込めない場所（/nonexistent など）でも、
# BOX_REFRESH_TOKEN_FILE に書き込めない場所を指定しても、更新した後に保存できず新しい refresh token を失うので、
# API を呼ぶ前に止める。保存はファイルへ直接書くので、ファイルが在ればファイルに、無ければディレクトリに書き込めるかを見る
token_dir="$(dirname "$token_file")"
if ! (umask 077 && mkdir -p "$token_dir") || { [ -e "$token_file" ] && [ ! -w "$token_file" ]; } || { [ ! -e "$token_file" ] && [ ! -w "$token_dir" ]; }; then
	printf 'box-token: refresh token の保存先 %q に書き込めない（ディレクトリを作れないか、書き込む権限が無い）。%sBox の API を呼ぶ前に止める。BOX_REFRESH_TOKEN_FILE に書き込める絶対パスを設定する（例: export BOX_REFRESH_TOKEN_FILE=/path/to/refresh_token）\n' "$token_file" "$token_src" >&2
	exit 1
fi
if [ -n "$refresh_in_file" ]; then
	refresh="$(<"$token_file")"
	refresh="$(printf '%s' "$refresh" | tr -d '[:space:]')"
	: "${refresh:?$refresh_missing}"
fi

# refresh_token と client_secret は、curl の argv（ps/proc）に載せず、umask 077 の一時ファイルで渡す。
# --data-urlencode name@file では、curl がファイルの中身を読んで URL エンコードするので、argv にはファイル名しか現れない。
# 送信する本文は、name=value を直接書いた場合と同じである。client_id は秘密ではないので、直接書く。
secret_dir="$(mktemp -d "${TMPDIR:-/tmp}/box-token.XXXXXX")"
trap 'rm -rf "$secret_dir"' EXIT
(
	umask 077
	printf '%s' "$refresh" >"$secret_dir/refresh"
	printf '%s' "$BOX_CLIENT_SECRET" >"$secret_dir/secret"
)

# curl は name@file の区切りを探すとき `=` を `@` より先に見るため、ファイルパスに `=` が含まれると
# ファイルとして読まれず「name@<パス前半>=<パス後半>」がそのままボディになる（実測 curl 8.14.1）。
# secret_dir は TMPDIR 由来なので `=` を含み得る。パスの文字に依存しないよう secret_dir へ cd し、
# 相対ファイル名（`=` を含まない）で渡す。cd はコマンド置換のサブシェル内に閉じる。
# CDPATH が export されていると cd が解決先を stdout に出して $resp を汚すため、cd の間だけ空にする。
resp="$(CDPATH='' cd -- "$secret_dir" && curl -sS https://api.box.com/oauth2/token \
	-d grant_type=refresh_token \
	--data-urlencode "client_id=$BOX_CLIENT_ID" \
	--data-urlencode "client_secret@secret" \
	--data-urlencode "refresh_token@refresh")"

err="$(printf '%s' "$resp" | jq -r '.error // empty')"
if [ -n "$err" ]; then
	echo "トークン更新失敗: $err - $(printf '%s' "$resp" | jq -r '.error_description // ""')" >&2
	# invalid_client は client 認証の失敗であって refresh token の失効ではない。混同すると
	# 「再認可すれば直る」と誤誘導するため、原因ごとに案内を分ける。
	if [ "$err" = "invalid_client" ]; then
		echo "（client 認証に失敗しました。BOX_CLIENT_ID / BOX_CLIENT_SECRET の値を確認してください）" >&2
	else
		echo "（refresh token が失効している可能性があります。box-oauth-init.sh で再取得してください）" >&2
	fi
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
		# ディレクトリは API を呼ぶ前に作ってある。その後に消された場合に備えて、ここでも作る
		mkdir -p "$(dirname "$token_file")"
		printf '%s' "$new_refresh" >"$token_file"
	)
fi

printf '%s' "$access"
