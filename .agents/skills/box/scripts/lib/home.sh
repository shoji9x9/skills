# shellcheck shell=bash disable=SC2034
# SC2034 を外す。関数が値を入れる変数は source した側が読むので、このファイルの中では使われない。
# box のスクリプト（box-folder.sh・box-token.sh・box-oauth-init.sh）が source する共通の処理。
# ホームを決める処理と、refresh token の保存先に書き込めるかの判定を、1 か所で定義する。
# 単独では実行しない（関数を定義するだけ）。

# box_resolve_home: ホームのディレクトリを決め、次の 4 つの変数に入れる。
#   box_home_dir: 決まったホームのディレクトリ。決められなければ空。絶対パスかは呼び出し側が確かめる。
#   box_home_status: ホームの決め方。home（HOME から）・registered（OS の登録から）・no_entry（OS に登録が無い）・
#     no_id（id が PATH に無く、登録を確かめられない）のどれか。
#   box_home_reason: ホームが絶対パスに決まらなかったときに表示する理由（文の終わりまで）。
#   box_home_from: ホームを決めた方法を表示する文（status が home か registered のときだけ入れる）。
# HOME が無いか空なら、OS に登録されたホーム（/etc/passwd や LDAP などに登録された、そのユーザーのホーム）を使う。
# OS にそのユーザーの登録が無いと、bash は ~ を / にする（実測 bash 5.2）。展開した値で見分けられないので、
# 登録が無いことは id -un が失敗することで見分け、ホームを空にする。
# id が PATH に無いと、登録が無いときと同じく失敗するので、先に分けて「確かめられない」と示す。
box_resolve_home() {
	box_home_dir="${HOME:-}"
	box_home_from=""
	local home_state
	# HOME が無いときと空のときを、表示で区別する（%q は、どちらも '' と表示する）
	home_state="HOME が無い"
	[ "${HOME+set}" != "set" ] || home_state="HOME が空である"
	if [ -n "${box_home_dir}" ]; then
		box_home_status=home
		box_home_from="保存先は HOME から決めた。"
		printf -v box_home_reason 'HOME=%q が絶対パスでない。' "${HOME}"
	elif ! command -v id >/dev/null 2>&1; then
		box_home_status=no_id
		box_home_reason="${home_state}。id コマンドが無く、OS に登録されたホームを確かめられない。"
	elif id -un >/dev/null 2>&1; then
		box_home_status=registered
		box_home_dir=$(
			unset HOME
			printf '%s' ~
		)
		box_home_from="${home_state}。保存先は、OS に登録されたホームから決めた。"
		printf -v box_home_reason '%s。OS に登録されたホーム %q も絶対パスでない。' "${home_state}" "${box_home_dir}"
	else
		box_home_status=no_entry
		box_home_reason="${home_state}。OS にこのユーザーの登録が無く、ホームを決められない。"
	fi
}

# box_token_file <名前>: refresh token の保存先を決め、token_file と token_src に入れる。
#   token_file: 保存先のパス。置き場所のデフォルトは ~/.config/box/refresh_token。
#   token_src: 保存先を決めた方法を表示する文。
# env/dotenv 経由の値は ~ が展開されないため、先頭 ~/ も box_resolve_home で決めたホームの下に直す。
# ホームが絶対パスに決まらなければ、<名前> を付けて理由と設定の案内を stderr に書き、exit 1 で止める。
# 決まらないまま進むと、受け取った refresh token を保存できない。認可コードは 1 回しか使えず、
# Box は更新に使った古い refresh token を無効にするので、呼び出し側は認可コードを読む前と API を呼ぶ前にこれを呼ぶ。
box_token_file() {
	token_file="${BOX_REFRESH_TOKEN_FILE:-}"
	local stripped="${token_file#\~/}"
	token_src="保存先は BOX_REFRESH_TOKEN_FILE で指定した。"
	if [ -z "$token_file" ] || [ "$stripped" != "$token_file" ]; then
		[ -n "$token_file" ] || stripped=".config/box/refresh_token"
		box_resolve_home
		token_src="${box_home_from}"
		case "${box_home_dir}" in
		/*) ;;
		*)
			printf '%s: refresh token の置き場所を絶対パスに決められない。%sBOX_REFRESH_TOKEN_FILE に絶対パスを設定する（例: export BOX_REFRESH_TOKEN_FILE=/path/to/refresh_token）\n' "$1" "${box_home_reason}" >&2
			exit 1
			;;
		esac
		token_file="${box_home_dir}/$stripped"
	fi
}

# box_can_save <path>: 保存先に書き込めるかを返す。保存はファイルへ直接書くので、ファイルが在ればファイルに、
# 無ければディレクトリに書き込めるかを見る。
# 保存先がディレクトリなら、書き込めてもファイルとして保存できない。
# 行き先の無いシンボリックリンクに書くと行き先にファイルができるので、リンクをたどった先のディレクトリに書き込めるかを見る
box_can_save() {
	[ ! -d "$1" ] || return 1
	if [ -e "$1" ]; then
		[ -w "$1" ]
		return
	fi
	local target="$1" hops=0 next
	while :; do
		# 末尾が / のパスは、ディレクトリを指すのでファイルとして保存できない。
		# 指定したパスにも、シンボリックリンクの行き先にも当てる
		case "$target" in
		*/) return 1 ;;
		esac
		[ -L "$target" ] || break
		# 循環するシンボリックリンクには書き込めない
		[ "$hops" -lt 40 ] || return 1
		next="$(readlink "$target")"
		case "$next" in
		/*) target="$next" ;;
		*) target="$(dirname "$target")/$next" ;;
		esac
		hops=$((hops + 1))
	done
	[ -w "$(dirname "$target")" ]
}
