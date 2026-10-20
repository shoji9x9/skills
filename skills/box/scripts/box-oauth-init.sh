#!/usr/bin/env bash
# Box OAuth 2.0 の認可コードを access/refresh token に交換し、refresh token を保存する（初回のみ実行）。
# 使い方: box-oauth-init.sh（認可コードは引数ではなく、プロンプトか stdin から入力する）
#   対話: box-oauth-init.sh を実行し、プロンプトに認可コードを貼り付けて Enter を押す（ps/proc に値が出ない）。
#   stdin: f="$(mktemp)"; trap 'rm -f "$f"' EXIT; cat >"$f"; box-oauth-init.sh <"$f"（自動実行向け。値を argv に載せない）
#          一時ファイルは mktemp（0600）で作る。CWD の code.txt は、umask 0022 では 0644 になり、他のユーザーが読める。
#          削除は trap EXIT で行う。`; rm -f` でつなぐと、set -e のシェルでは交換に失敗したときに実行されず、認可コードが残る。
# 認可コードを引数で渡さないのは、実行中に ps/proc から他プロセスへ露出させないため。
# 必要env: BOX_CLIENT_ID, BOX_CLIENT_SECRET
# 任意env: BOX_REDIRECT_URI（既定 https://app.box.com）, BOX_REFRESH_TOKEN_FILE（既定 ~/.config/box/refresh_token）
set -euo pipefail

# 以前の `box-oauth-init.sh <code>` 形式をエラーにする。引数で渡すと ps/proc に値が出るうえ、
# 引数は無視されて stdin の入力を待つので、利用者が混乱する。エラーで新しい入力方法を案内する。
if [ "$#" -gt 0 ]; then
	echo "エラー: 認可コードは引数で渡しません（ps/proc 露出を避けるため）。引数なしで実行してプロンプトに貼り付けるか、mktemp で作った 0600 の一時ファイルに書いて stdin で渡してください（CWD の code.txt は既定 umask では 0644 になるため使わない）。" >&2
	exit 2
fi

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
	# ホームが絶対パスに決まらないまま交換すると、受け取った refresh token を保存できず、認可からやり直すことになる。
	# 認可コードは 1 回しか使えないので、認可コードを読む前に止める
	case "${home_dir}" in
	/*) ;;
	*)
		printf 'box-oauth-init: refresh token の置き場所を絶対パスに決められない。%sBOX_REFRESH_TOKEN_FILE に絶対パスを設定する（例: export BOX_REFRESH_TOKEN_FILE=/path/to/refresh_token）\n' "${home_reason}" >&2
		exit 1
		;;
	esac
	token_file="${home_dir}/$stripped"
fi
# 保存先のディレクトリを先に作り、書き込めるかを確かめる。ホームが書き込めない場所（/nonexistent など）でも、
# BOX_REFRESH_TOKEN_FILE に書き込めない場所を指定しても、交換した後に保存できず認可からやり直すことになるので、
# 認可コードを読む前に止める。保存はファイルへ直接書くので、ファイルが在ればファイルに、無ければディレクトリに書き込めるかを見る
token_dir="$(dirname "$token_file")"
if ! (umask 077 && mkdir -p "$token_dir") || { [ -e "$token_file" ] && [ ! -w "$token_file" ]; } || { [ ! -e "$token_file" ] && [ ! -w "$token_dir" ]; }; then
	printf 'box-oauth-init: refresh token の保存先 %q に書き込めない（ディレクトリを作れないか、書き込む権限が無い）。%sBox の API を呼ぶ前に止める。BOX_REFRESH_TOKEN_FILE に書き込める絶対パスを設定する（例: export BOX_REFRESH_TOKEN_FILE=/path/to/refresh_token）\n' "$token_file" "$token_src" >&2
	exit 1
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

# 認可コードと client_secret は、curl の argv（ps/proc）に載せず、umask 077 の一時ファイルで渡す。
# --data-urlencode name@file では、curl がファイルの中身を読んで URL エンコードするので、argv にはファイル名しか現れない。
# 送信する本文は、name=value を直接書いた場合と同じである。client_id は秘密ではないので、直接書く。
secret_dir="$(mktemp -d "${TMPDIR:-/tmp}/box-oauth.XXXXXX")"
trap 'rm -rf "$secret_dir"' EXIT
(
	umask 077
	printf '%s' "$code" >"$secret_dir/code"
	printf '%s' "$BOX_CLIENT_SECRET" >"$secret_dir/secret"
)

# curl は name@file の区切りを探すとき `=` を `@` より先に見るため、ファイルパスに `=` が含まれると
# ファイルとして読まれず「name@<パス前半>=<パス後半>」がそのままボディになる（実測 curl 8.14.1）。
# secret_dir は TMPDIR 由来なので `=` を含み得る。パスの文字に依存しないよう secret_dir へ cd し、
# 相対ファイル名（`=` を含まない）で渡す。cd はコマンド置換のサブシェル内に閉じる。
# CDPATH が export されていると cd が解決先を stdout に出して $resp を汚すため、cd の間だけ空にする。
resp="$(CDPATH='' cd -- "$secret_dir" && curl -sS https://api.box.com/oauth2/token \
	-d grant_type=authorization_code \
	--data-urlencode "code@code" \
	--data-urlencode "client_id=$BOX_CLIENT_ID" \
	--data-urlencode "client_secret@secret" \
	--data-urlencode "redirect_uri=$redirect_uri")"

err="$(printf '%s' "$resp" | jq -r '.error // empty')"
if [ -n "$err" ]; then
	echo "トークン交換失敗: $err - $(printf '%s' "$resp" | jq -r '.error_description // ""')" >&2
	# invalid_client は client 認証の失敗であって認可コードの失効ではない。混同すると「認可からやり直せば
	# 直る」と誤誘導するため、原因ごとに案内を分ける（box-token.sh と同じ切り分け）。
	if [ "$err" = "invalid_client" ]; then
		echo "（client 認証に失敗しました。BOX_CLIENT_ID / BOX_CLIENT_SECRET の値を確認してください）" >&2
	else
		echo "（認可コードは約30秒で失効します。DevTools を開いた状態で認可からやり直してください）" >&2
	fi
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
	# ディレクトリは API を呼ぶ前に作ってある。その後に消された場合に備えて、ここでも作る
	mkdir -p "$(dirname "$token_file")"
	printf '%s' "$refresh" >"$token_file"
)

echo "成功: refresh_token を $token_file に保存しました（access_token 長=$access_len）"
echo "次は .env を BOX_CLIENT_ID/BOX_CLIENT_SECRET のみにすれば、box-token.sh が自動でトークン更新します。"
