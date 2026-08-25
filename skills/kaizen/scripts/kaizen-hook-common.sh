#!/usr/bin/env bash
# kaizen hook 共通ライブラリ（source して使う。単体では何もしない）
#
# 提供するもの:
#   - Hook の stdin JSON から文字列フィールドを取り出す（jq/python3 に依存しない）
#   - session id を制御ファイル名に使える key へ正規化する
#   - `.kaizen/` を解決するプロジェクトルートを決める（worktree 対応）
#   - センチネル / checkpoint / 抽出完了マーカーのパス組み立てと、名前からの復号
#
# 制御ファイルは **session 単位**にする。agent 単位のままだと、同じプロジェクトで
# 同じ agent のセッションを 2 つ動かしたときに、片方の抽出完了が他方の未抽出シグナルを
# 消し、checkpoint も上書きし合う（Issue #218）。
#
# 呼び出し側はこのファイルを読めなくても動く必要がある（配布物の欠落・部分展開）。
# 各スクリプトは `declare -f` で関数の有無を確かめ、無ければ従来の agent 単位（key 空）へ
# 縮退する。縮退先は Issue #218 以前の挙動なので、機能が落ちるだけで壊れはしない。

# JSON の文字列フィールドを取り出す。$1 = JSON 文字列、$2.. = 候補キー名（先に一致した方）。
# 値が無い・`null`・非文字列なら空を返す（戻り値は常に 0。呼び出し側は空判定で分岐する）。
#
# jq / python3 を起動しないのは、Stop フックがターン終了ごとに走る hot path であり、
# ここで取れるのは session id / cwd / transcript path という単純な文字列に限られるため。
# JSON 文字列としてのエスケープだけを復号する（POSIX パスと UUID は素通しになる）。
kaizen_json_string_field() {
	local json="${1:-}" name value
	shift || true
	for name in "$@"; do
		# `"<name>" : "<値>"` の値部分を取る。値は「エスケープでない文字」か「`\` + 任意 1 文字」の
		# 連なりとして表し、`\"` で早期に閉じないようにする。
		if [[ "${json}" =~ \"${name}\"[[:space:]]*:[[:space:]]*\"(([^\"\\]|\\.)*)\" ]]; then
			value=${BASH_REMATCH[1]}
			# JSON エスケープの復号。パス・id に現れ得るものだけを対象にする。
			value=${value//\\\"/\"}
			value=${value//\\\//\/}
			value=${value//\\\\/\\}
			printf '%s' "${value}"
			return 0
		fi
	done
	printf ''
	return 0
}

# Hook JSON から session id / transcript path / cwd を取り出し、**3 行**（この順。無い値は空行）で返す。
#
# jq があれば**トップレベルのキーだけ**を見る jq を使う。組み込み照合（kaizen_json_string_field）は
# 生 JSON の最初の一致を採るため、同名キーが入れ子に**先に**現れるペイロード
# （例: `{"tool_input":{"cwd":...},"cwd":...}`）では入れ子側の値を拾う（実測）。
# 取り違えた session id は Stop フックとゲートで別の key を指し、解消できないセンチネルを生む。
# なお JSON 文字列の中身（アシスタント発話・コマンド文字列）では `"` が `\"` へエスケープされるため、
# 組み込み照合でも値を乗っ取られない（実測で確認済み）。危険なのは実在する入れ子キーだけ。
# jq が無い環境では組み込み照合へ縮退する（jq 不在では候補ゼロの自動通過も元々使えない）。
#
# 区切りに**タブを使わない**。bash の IFS ではタブは空白扱いで連続する区切りが 1 つに畳まれ、
# 空の中間フィールドが消えて後続の値がずれる（実測）。行区切りなら空行がそのまま残る。
kaizen_hook_fields() { # $1: Hook の JSON
	local json="${1:-}" out
	if command -v jq >/dev/null 2>&1; then
		if out=$(printf '%s' "${json}" | jq -r '
			[(.session_id // .sessionId // ""),
			 (.transcript_path // .transcriptPath // ""),
			 (.cwd // "")]
			| map(if type == "string" then (. | gsub("[\r\n]"; " ")) else "" end) | .[]
		' 2>/dev/null); then
			printf '%s\n' "${out}"
			return 0
		fi
	fi
	printf '%s\n%s\n%s\n' \
		"$(kaizen_json_string_field "${json}" session_id sessionId)" \
		"$(kaizen_json_string_field "${json}" transcript_path transcriptPath)" \
		"$(kaizen_json_string_field "${json}" cwd)"
}

# session id を制御ファイル名に使える key へ正規化する。空入力は空 key（＝従来の agent 単位）。
#
# key は `.pending-extract<suffix>.<key>` のように `.` 区切りで名前へ埋め込むため、`.` は
# 許可しない（許すと suffix と key の境界が読めなくなる）。UUID 形式の session id は
# そのまま通る。それ以外は不許可文字を `_` へ潰したうえで**原文のチェックサム**を付ける
# ——潰すだけだと別の session id が同じ key に化け、まさに直そうとしている奪い合いへ戻る。
kaizen_session_key() {
	local raw="${1:-}" safe sum
	[ -n "${raw}" ] || {
		printf ''
		return 0
	}
	if [[ "${raw}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
		printf '%s' "${raw}"
		return 0
	fi
	safe=${raw//[^A-Za-z0-9_-]/_}
	safe=${safe:0:32}
	sum=$(printf '%s' "${raw}" | cksum 2>/dev/null | {
		read -r first _ 2>/dev/null || true
		printf '%s' "${first:-}"
	}) || sum=""
	# 先頭が `_`（不許可文字由来）になっても名前として成立するよう `s` を前置する。
	printf 's%s-%s' "${safe}" "${sum:-0}"
}

# $1 のディレクトリを含む git の作業ツリー root を返す（worktree ならその worktree のパス）。
kaizen_git_toplevel() {
	local dir="${1:-}"
	[ -n "${dir}" ] && [ -d "${dir}" ] || return 1
	git -C "${dir}" rev-parse --show-toplevel 2>/dev/null
}

# $1 のリポジトリの共有 git ディレクトリを絶対パスで返す。worktree は本体と同じ値になるため、
# 「同じリポジトリか」の判定に使える（--show-toplevel は worktree ごとに違うので使えない）。
kaizen_git_common_dir() {
	local dir="${1:-}" common
	[ -n "${dir}" ] && [ -d "${dir}" ] || return 1
	common=$(git -C "${dir}" rev-parse --git-common-dir 2>/dev/null) || return 1
	[ -n "${common}" ] || return 1
	(cd "${dir}" 2>/dev/null && cd "${common}" 2>/dev/null && pwd) || return 1
}

# `.kaizen/` を置くプロジェクトルートを決める。$1 = Hook payload の `cwd`（任意）。
#
# **コミットが実行される作業ツリーを優先する**。`$CLAUDE_PROJECT_DIR` を最優先にすると、
# セッションの起点がリポジトリ本体で作業が git worktree の場合に、ゲートが見る `.kaizen/` と
# 抽出したセッションが書く `.kaizen/` が別ディレクトリになる（Issue #218）。
# ただし作業ツリーなら何でも良いわけではない——ネストした別リポジトリ（vendor 配下等）へ
# cd した状態でフックが起動したときにそこへ書かないよう、**`$CLAUDE_PROJECT_DIR` と同じ
# リポジトリ（本体か、その worktree）であること**を共有 git ディレクトリの一致で確かめる。
# 同じと確認できない・git 外なら従来どおり `$CLAUDE_PROJECT_DIR`、それも無ければ cwd。
kaizen_resolve_project_root() {
	local payload_cwd="${1:-}" base="${CLAUDE_PROJECT_DIR:-}" cand_dir cand base_common cand_common
	base_common=""
	if [ -n "${base}" ]; then
		base_common=$(kaizen_git_common_dir "${base}") || base_common=""
	fi
	for cand_dir in "${payload_cwd}" "$(pwd)"; do
		[ -n "${cand_dir}" ] || continue
		cand=$(kaizen_git_toplevel "${cand_dir}") || continue
		[ -n "${cand}" ] || continue
		if [ -z "${base}" ]; then
			printf '%s' "${cand}"
			return 0
		fi
		cand_common=$(kaizen_git_common_dir "${cand}") || cand_common=""
		if [ -n "${base_common}" ] && [ "${base_common}" = "${cand_common}" ]; then
			printf '%s' "${cand}"
			return 0
		fi
	done
	if [ -n "${base}" ]; then
		printf '%s' "${base}"
		return 0
	fi
	pwd
}

# 制御ファイルのパス。key が空なら Issue #218 以前の agent 単位の名前（後方互換）になる。
kaizen_sentinel_path() { # $1: agent suffix（空 / -codex / -copilot） $2: session key（空可）
	if [ -n "${2:-}" ]; then
		printf '.kaizen/.pending-extract%s.%s' "${1:-}" "$2"
	else
		printf '.kaizen/.pending-extract%s' "${1:-}"
	fi
}

kaizen_checkpoint_path() { # $1: session key（空可）
	if [ -n "${1:-}" ]; then
		printf '.kaizen/.extract-checkpoint.%s' "$1"
	else
		printf '.kaizen/.extract-checkpoint'
	fi
}

kaizen_done_path() { # $1: session key（空可）
	if [ -n "${1:-}" ]; then
		printf '.kaizen/.extract-done.%s' "$1"
	else
		printf '.kaizen/.extract-done'
	fi
}

# センチネルのファイル名から agent suffix と session key を復号する。
# suffix は `-[a-z0-9-]+` で `.` を含まないため、最初の `.` を境界にできる。
kaizen_sentinel_suffix_of() { # $1: センチネルのパス
	local base=${1##*/} rest
	rest=${base#.pending-extract}
	printf '%s' "${rest%%.*}"
}

kaizen_sentinel_key_of() { # $1: センチネルのパス
	local base=${1##*/} rest
	rest=${base#.pending-extract}
	case "${rest}" in
	*.*) printf '%s' "${rest#*.}" ;;
	*) printf '' ;;
	esac
}
