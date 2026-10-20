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
