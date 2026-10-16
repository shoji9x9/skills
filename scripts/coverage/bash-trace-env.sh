# shellcheck shell=bash
# シェルスクリプトのカバレッジを測るときに、bash が BASH_ENV で読み込むファイル。
#
# vitest のテストは、シェルスクリプトを子プロセスとして起動する。kcov のように起動する側を包む方法では、
# node を挟んだ子プロセスの bash を追えない。そこで run-coverage.ts が BASH_ENV と SHELL_COVERAGE_DIR を
# 環境変数に入れ、非対話の bash がすべてこのファイルを読むようにする。
# このファイルは、プロセスごとのファイルに xtrace を書かせる。書くのは、実行したコマンドのファイルと行番号である。
# stderr には何も足さないので、テストが比べる出力は変わらない。
#
# SHELL_COVERAGE_DIR が無いときと、書き込み先を開けないときは何もしない。
# 開けないときのエラーを捨てる 2>/dev/null は、{ } に付ける。exec に直接付けると、以後の stderr もすべて捨てる。
if [ -n "${SHELL_COVERAGE_DIR:-}" ] && { exec {__shell_coverage_fd}>>"${SHELL_COVERAGE_DIR}/trace.$$"; } 2>/dev/null; then
	# 相対パスで起動されたスクリプトの BASH_SOURCE を解決するために、起動したときの作業ディレクトリを残す。
	printf '#CWD\t%s\n' "${PWD}" >&"${__shell_coverage_fd}"
	# テストは、スクリプトを一時ディレクトリにコピーして実行することがある。コピーは実行の後に消えるので、
	# 起動したスクリプトと同じディレクトリの *.sh の内容のハッシュを残し、原本と同じ内容のコピーを原本として数える。
	# source で読む隣のファイル（kaizen-hook-common.sh など）も、同じディレクトリにあれば含まれる。
	if [ -f "$0" ] && command -v sha256sum >/dev/null 2>&1; then
		__shell_coverage_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) &&
			sha256sum -- "${__shell_coverage_dir}"/*.sh 2>/dev/null |
			while read -r __shell_coverage_hash __shell_coverage_path; do
				printf '#HASH\t%s\t%s\n' "${__shell_coverage_path}" "${__shell_coverage_hash}"
			done >&"${__shell_coverage_fd}"
		unset __shell_coverage_dir
	fi
	BASH_XTRACEFD=${__shell_coverage_fd}
	# 区切りはタブにする。先頭の + は、bash が入れ子の深さの分だけ繰り返す。
	PS4='+SHCOV	${BASH_SOURCE[0]-}	${LINENO}	'
	set -x
fi
