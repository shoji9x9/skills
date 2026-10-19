#!/usr/bin/env bash
# kaizen hook 共通ライブラリ（source して使う。単体では何もしない）
#
# 提供するもの:
#   - Hook の stdin JSON から文字列フィールドを取り出す（jq/python3 に依存しない）
#   - session id を制御ファイル名に使える key へ正規化する
#   - `.kaizen/` を解決するプロジェクトルートを決める（worktree 対応）
#   - リポジトリの全作業ツリーの `.kaizen/` を列挙し、制御ファイルをそこから探す
#   - センチネル / checkpoint / 抽出完了マーカーのパス組み立てと、名前からの復号
#   - kaizen の設定（`.config/skills/shoji9x9/kaizen.jsonc` ほか）から値を読む
#   - 暦日を 1970-01-01 からの日数へ変換する（保持期間・忘却の閾値判定で使う）
#
# 制御ファイルは **session 単位**にする。agent 単位のままだと、同じプロジェクトで
# 同じ agent のセッションを 2 つ動かしたときに、片方の抽出完了が他方の未抽出シグナルを
# 消し、checkpoint も上書きし合う。
#
# 呼び出し側はこのファイルを読めなくても動く必要がある（配布物の欠落・部分展開）。
# 各スクリプトは `declare -f` で関数の有無を確かめ、無ければ以前の agent 単位（key が空）で動く。
# これは session 単位にする前の振る舞いなので、機能が減るだけで、誤った結果にはならない。

# JSON の文字列フィールドを取り出す。$1 = JSON 文字列、$2.. = 候補キー名（先に一致した方）。
# 値が無い・`null`・非文字列なら空を返す（戻り値は常に 0。呼び出し側は空判定で分岐する）。
#
# jq / python3 を起動しないのは、Stop フックがターンの終わりごとに実行される hot path であり、
# ここで取るのは session id / cwd / transcript path という単純な文字列に限られるためである。
# JSON 文字列としてのエスケープだけを復号する（POSIX のパスと UUID はそのまま通る）。
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
# 生の JSON で最初に一致したものを採るので、同じ名前のキーが入れ子に**先に**現れるペイロード
# （例: `{"tool_input":{"cwd":...},"cwd":...}`）では、入れ子の側の値を拾う（実測）。
# 取り違えた session id は、Stop フックとコミット前のチェックで別の key を指し、解消できないセンチネルを作る。
# なお JSON 文字列の中身（アシスタントの発話・コマンド文字列）では `"` が `\"` にエスケープされるので、
# 組み込みの照合でも値を取り違えない（実測で確かめた）。問題になるのは、実在する入れ子のキーだけである。
# jq が無い環境では、組み込みの照合だけで動く（jq が無ければ、候補ゼロでの自動通過も元から使えない）。
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
# そのまま通る。それ以外は、許可しない文字を `_` に置き換えたうえで**原文のチェックサム**を付ける。
# 置き換えるだけだと、別の session id が同じ key になり、直そうとしている奪い合いに戻る。
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
	# 先頭が `_`（許可しない文字を置き換えたもの）になっても名前として成り立つように、`s` を前に付ける。
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
# セッションの起点がリポジトリ本体で作業が git worktree の場合に、コミット前のチェックが見る `.kaizen/` と
# 抽出したセッションが書く `.kaizen/` が別ディレクトリになる。
# ただし、作業ツリーなら何でもよいわけではない。ネストした別のリポジトリ（vendor の下など）へ
# cd した状態でフックが起動したときにそこへ書かないよう、**`$CLAUDE_PROJECT_DIR` と同じ
# リポジトリ（本体か、その worktree）であること**を共有 git ディレクトリの一致で確かめる。
# 同じと確かめられない場合や git の外なら、これまでどおり `$CLAUDE_PROJECT_DIR` を使い、それも無ければ cwd を使う。
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

# このリポジトリの**全作業ツリー**（本体＋git worktree）の `.kaizen` ディレクトリを、
# $1 のツリーを先頭にして絶対パスで 1 行ずつ返す。
#
# 制御ファイル（センチネル / checkpoint / 抽出完了マーカー）の置き場は、**作業ディレクトリで決まる**。
# そのため、センチネルを立てたツリーと `git commit` を実行するツリーが分かれると、
# コミット前のチェックは自分のツリーの `.kaizen/` しか見ず、**worktree の commit がチェックなしに通る**。
# これは出力にも終了コードにも現れないので、「未抽出の学びが無い」と「センチネルが別のツリーに
# ある」を区別できない。
#
# 置き場そのものを 1 箇所へ移すと、既存インストールの制御ファイルが迷子になる（移行の途中で
# 両方が有効になり、片方が見えないまま素通りする）。**置き場は変えず、探索と解消をリポジトリ
# 全体へ広げる**。`git worktree list --porcelain` は本体と全 worktree を返す。
#
# git を起動できない場合や worktree を列挙できない場合は、自分のツリーだけを返す（機能を減らして動く。
# すべての作業ツリーを探すようにする前の振る舞いに戻るだけである）。
#
# **列挙は `-z`（NUL 区切り）で読む。** POSIX ではパスに改行を含められ、行区切りの
# `--porcelain` ではパスが複数行に分かれ、先頭の部分しか取れない。その worktree は
# 「存在しないディレクトリ」として扱われ、そこに立ったセンチネルが見えないまま commit が
# チェックなしに通る（実測。git 2.47.3 で改行を含む worktree を作って確かめた）。
# `-z` は `git worktree list -h` に「terminate records with a NUL character」と記載があり、
# 属性ごとに NUL、レコード間は空フィールドで区切られる（実測）。
# `-z` を持たない古い git では列挙が失敗するので、行区切りで読む（機能を減らして動く）。
#
# **返す側も NUL 区切りにする。** 改行を含むパスを取れても、改行区切りで返した時点で
# 消費側が 1 件を 2 行に読み、そのどちらも存在しないディレクトリとして落とす（実測）。
# 呼び出し側は `while IFS= read -r -d '' dir` で読む。
kaizen_worktree_kaizen_dirs() { # $1: 基準のツリー（省略時は cwd）
	local base="${1:-}" base_phys line path seen
	[ -n "${base}" ] || base=$(pwd)
	[ -d "${base}" ] || return 0
	base=$(cd "${base}" 2>/dev/null && pwd) || return 0
	# `git worktree list` は**解決済み（物理）のパス**を返す。base をシンボリックリンク越しに
	# 受け取っていると論理パスとは文字列が一致せず、**同じ `.kaizen/` を 2 回返す**。同一の
	# センチネルが二重に数えられ、案内も他セッションの走査予算も二重に消費される。物理パスでも
	# 突き合わせて弾く。
	base_phys=$(cd "${base}" 2>/dev/null && pwd -P) || base_phys=${base}
	printf '%s\0' "${base}/.kaizen"
	command -v git >/dev/null 2>&1 || return 0
	emit_worktree_dir() { # $1: `worktree <path>` 形式のレコード
		case "$1" in
		'worktree '*) ;;
		*) return 0 ;;
		esac
		path=${1#worktree }
		[ -n "${path}" ] || return 0
		if [ "${path}" = "${base}" ] || [ "${path}" = "${base_phys}" ]; then
			return 0
		fi
		[ -d "${path}" ] || return 0
		printf '%s\0' "${path}/.kaizen"
	}
	# **NUL 区切りの出力を変数へ溜めない。** `$( )` は NUL を落とすので、溜めた時点で
	# レコードの区切りが消える（実測: 改行入り worktree が 1 件も取れなくなる）。
	# プロセス置換から直接読む。
	seen=0
	while IFS= read -r -d '' line; do
		case "${line}" in
		'worktree '*) seen=$((seen + 1)) ;;
		esac
		emit_worktree_dir "${line}"
	done < <(git -C "${base}" worktree list --porcelain -z 2>/dev/null)
	# レコードが 1 件も無い＝`-z` を持たない古い git（リポジトリなら本体は必ず 1 件返る）。
	# 改行を含むパスは取りこぼすが、それ以外は従来どおり拾う。
	if [ "${seen}" -eq 0 ]; then
		while IFS= read -r line; do
			emit_worktree_dir "${line}"
		done < <(git -C "${base}" worktree list --porcelain 2>/dev/null || true)
	fi
	unset -f emit_worktree_dir
}

# 制御ファイルをリポジトリの全作業ツリーから探し、最初に見つかった絶対パスを返す。
# 見つからなければ 0 以外を返す（呼び出し側は自分のツリーのパスを使う）。
# $2 は `.kaizen/` を含まない**ファイル名**（例: `.extract-checkpoint.<session key>`）。
kaizen_find_control_file() { # $1: 基準のツリー $2: 制御ファイル名
	local dir name="${2:-}"
	[ -n "${name}" ] || return 1
	while IFS= read -r -d '' dir; do
		[ -e "${dir}/${name}" ] || continue
		printf '%s' "${dir}/${name}"
		return 0
	done < <(kaizen_worktree_kaizen_dirs "${1:-}")
	return 1
}

# 制御ファイルのパス。key が空なら session 単位化より前の agent 単位の名前（後方互換）になる。
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

# kaizen の設定を読む。設定は 3 つの層のファイルにあり、同梱の `scripts/skill-config/skill-config.mjs` で読む。
# リポジトリの層は `.config/skills/shoji9x9/kaizen.jsonc`、このリポジトリの自分だけの層は `kaizen.local.jsonc` である。
# 人ごとの層は `${XDG_CONFIG_HOME:-~/.config}/skills/shoji9x9/kaizen.jsonc` である。
# 置き場所と解決の順序は references/config-files.md にある。
#
# 読み方は 3 通りに分かれる。
#   - 旧い置き場所（`.kaizen/config`・`.config/skills/shoji9x9/skills.yml`）か、使わなくなった環境変数
#     （`KAIZEN_PRECOMMIT_DEADLINE_SECONDS`）が残っている: node を使わずに検出し、移行の手順を示して誤りにする。
#     旧い設定を警告なしに無視すると、デフォルトの値で動いてしまうためである。
#   - 設定ファイルが 1 つも無く、値を受け取る環境変数（`KAIZEN_SCHEDULE_*`）も空: node を起動せずに、
#     下の kaizen_config_defaults の値を使う。node の無い環境でもコミット前のチェックを動かすためである。
#   - それ以外: node で 1 回だけ読み、全キーの値と出所を変数に置く。node が無ければ、デフォルトの値で動かずに誤りにする
#     （書いた設定を警告なしに無視しないため）。不正な値（知らないキー・型の誤り・置けない層）も誤りにする。
#
# kaizen_config_load はシェルの変数に結果を置くので、`$( )` の中ではなく、呼び出し側のシェルで先に 1 回呼ぶ。
# 戻り値は 0=読めた / 1=誤り（理由は kaizen_config_error に入れる）。2 回目以降は前の結果を返す。
# パスは相対。呼び出し側は先にプロジェクトルートへ cd している前提（全 kaizen スクリプト共通）。

kaizen_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || true)
kaizen_config_loaded=""
kaizen_config_status=0
kaizen_config_error=""

# node を起動しないときに使う値。スキーマ（config-schemas/kaizen.schema.json）の default と同じにする
# （配布元のテストが一致を確かめる）。default の無いキーは挙げない。
kaizen_config_defaults() {
	printf '%s\n' \
		precommit_deadline_seconds=8 \
		foreign_sentinel_retention_days=7 \
		forget_auto=true \
		forget_after_days=30 \
		forget_max_priority=medium \
		schedule_enabled=false \
		schedule_mode=notify \
		schedule_agent=claude
}

# 旧い置き場所と、使わなくなった環境変数を挙げる（1 行 1 件）。
kaizen_config_legacy() {
	local root yml
	if [ -e .kaizen/config ]; then
		printf '%s\n' "- .kaizen/config が残っている。KEY=VALUE の各行を .config/skills/shoji9x9/kaizen.jsonc の同じ名前のキーに移す（on と off は true と false に、数は数のまま書く）。移したら .kaizen/config を消す"
	fi
	if [ "${KAIZEN_PRECOMMIT_DEADLINE_SECONDS+set}" = set ]; then
		printf '%s\n' "- 環境変数 KAIZEN_PRECOMMIT_DEADLINE_SECONDS は使わなくなった。値を kaizen.jsonc（全員に同じ値）か kaizen.local.jsonc（このリポジトリの自分だけ）か人ごとの kaizen.jsonc（自分のすべてのリポジトリ）の precommit_deadline_seconds に移し、環境変数を消す"
	fi
	root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
	yml="${root}/.config/skills/shoji9x9/skills.yml"
	if [ -e "${yml}" ]; then
		printf '%s\n' "- ${yml} が残っている。skills.<スキル名> の節を .config/skills/shoji9x9/<スキル名>.jsonc に、skills.common の節を common.jsonc に移し、skills.yml を消す"
	fi
}

# 在る設定ファイルのパスを挙げる（1 行 1 件）。
kaizen_config_files() {
	local root user_home user_file home_dir f
	root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
	user_home=${XDG_CONFIG_HOME:-}
	case "${user_home}" in
	/*) ;;
	*)
		# HOME が無いか空なら、読み取りと同じく、ユーザーのデータベースのホームを使う
		home_dir="${HOME:-}"
		[ -n "${home_dir}" ] || home_dir=$(
			unset HOME
			printf '%s' ~
		)
		# ユーザーのデータベースにエントリが無いと ~ が展開されずに残るので、空として扱う
		[ "${home_dir}" != "~" ] || home_dir=""
		user_home="${home_dir:+${home_dir}/}.config"
		;;
	esac
	user_file="${user_home}/skills/shoji9x9/kaizen.jsonc"
	# 人ごとの層を読まない（SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1）なら、読み取りと同じく人ごとのファイルを数えない
	[ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG:-}" = 1 ] && user_file=""
	# 置き場所が絶対パスに決まらなければ、読み取りと同じく人ごとの層を読まない（リポジトリのファイルと同じパスを指しうる）
	case "${user_home}" in
	/*) ;;
	*) user_file="" ;;
	esac
	for f in "${root}/.config/skills/shoji9x9/kaizen.jsonc" \
		"${root}/.config/skills/shoji9x9/kaizen.local.jsonc" \
		"${user_file}"; do
		[ -n "${f}" ] && [ -e "${f}" ] && printf '%s\n' "${f}"
	done
	return 0
}

# 1 つのキーの値と出所を変数に置く。キー名は変数名の一部になるので、英小文字・数字・`_` だけを受け付ける。
kaizen_config_set() { # $1: キー名 $2: 値 $3: 出所
	[[ "$1" =~ ^[a-z_][a-z0-9_]*$ ]] || return 1
	printf -v "kaizen_cfg__$1" '%s' "$2"
	printf -v "kaizen_cfg_src__$1" '%s' "$3"
}

# 読み取りを誤りとして終える。理由は kaizen_config_error に置き、呼び出し側が出力する。
kaizen_config_fail() { # $1: 理由
	# shellcheck disable=SC2034 # 呼び出し側のスクリプトが読む
	kaizen_config_error=$1
	kaizen_config_status=1
	return 1
}

kaizen_config_load() {
	if [ -n "${kaizen_config_loaded}" ]; then
		return "${kaizen_config_status}"
	fi
	kaizen_config_loaded=1
	local legacy files line key value reader out rc node_bin
	legacy=$(kaizen_config_legacy)
	if [ -n "${legacy}" ]; then
		kaizen_config_fail "旧い場所の設定が残っているので止める（kaizen の references/config-files.md「移行」）。"$'\n'"${legacy}"
		return 1
	fi
	# 人ごとの層を読まない指定は、読み取りと同じく 1 だけを受け付ける。設定ファイルが無いときも同じ結果にするため、ここでも確かめる
	if [ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG+set}" = set ] && [ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG}" != 1 ]; then
		kaizen_config_fail "環境変数 SHOJI9X9_SKILLS_IGNORE_USER_CONFIG は 1 だけを受け付ける（$(printf '%q' "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG}")）。人ごとの層を読むなら変数を消す"
		return 1
	fi
	files=$(kaizen_config_files)
	if [ -z "${files}" ] && [ -z "${KAIZEN_SCHEDULE_MODE:-}${KAIZEN_SCHEDULE_AGENT:-}${KAIZEN_SCHEDULE_MODEL:-}${KAIZEN_SCHEDULE_EFFORT:-}" ]; then
		while IFS= read -r line; do
			kaizen_config_set "${line%%=*}" "${line#*=}" default
		done <<<"$(kaizen_config_defaults)"
		return 0
	fi
	reader="${kaizen_lib_dir}/skill-config/skill-config.mjs"
	node_bin=$(command -v node || true)
	if [ -z "${node_bin}" ]; then
		kaizen_config_fail "kaizen の設定を読むには node が要るが、見つからない（設定ファイル: $(printf '%s' "${files:-なし。KAIZEN_SCHEDULE_* が設定されている}" | tr '\n' ' ')）。node を入れるか、設定ファイルを外してデフォルトの値で動かす"
		return 1
	fi
	if [ -z "${kaizen_lib_dir}" ] || [ ! -r "${reader}" ]; then
		kaizen_config_fail "同梱の設定の読み取り（scripts/skill-config/skill-config.mjs）を読めない: ${reader}"
		return 1
	fi
	# 1 回の起動で全キーを読む。値は 1 行に収まる（スキーマが改行を含む値を許さない）。
	# 最初の引数に読み取りのパスを置かない。`node -e` では process.argv[1] が最初の引数になり、
	# 読み取りが自分を CLI として起動されたと判定して main を実行してしまう。
	# 出力は「キー<TAB>出所<TAB>値」で、文字列はそのまま、それ以外は JSON にする。
	# 設定の誤りも stdout に出す。stderr を stdout に合わせると、読み取りの注意（SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1 の
	# note など）が値の行に入り、変数名にできないキーとして誤りになるので、stderr はそのまま呼び出し側へ流す。
	rc=0
	# shellcheck disable=SC2016 # 本文は node に渡す JavaScript で、シェルに展開させない
	out=$("${node_bin}" --input-type=module -e '
const reader = process.argv[2];
const { pathToFileURL } = await import("node:url");
const m = await import(pathToFileURL(reader).href);
try {
  const r = m.loadConfig({ name: "kaizen" });
  for (const [k, v] of Object.entries(r)) {
    const s = typeof v.value === "string" ? v.value : JSON.stringify(v.value);
    process.stdout.write(`${k}\t${v.source}\t${s}\n`);
  }
} catch (e) {
  if (!(e instanceof m.ConfigError)) throw e;
  process.stdout.write(`${e.message}\n`);
  process.exit(1);
}
' -- "kaizen-config" "${reader}" </dev/null) || rc=$?
	if [ "${rc}" -ne 0 ]; then
		kaizen_config_fail "kaizen の設定を読めない（設定ファイル: $(printf '%s' "${files:-なし}" | tr '\n' ' ')）。"$'\n'"${out}"
		return 1
	fi
	while IFS=$'\t' read -r key line value; do
		[ -n "${key}" ] || continue
		kaizen_config_set "${key}" "${value}" "${line}" ||
			{
				kaizen_config_fail "kaizen の設定の読み取りが、変数名にできないキーを返した: ${key}"
				return 1
			}
	done <<<"${out}"
	return 0
}

# キーの値を出力する。0=値がある / 1=値もデフォルトも無い / 2=設定の誤り（理由は kaizen_config_error）。
# 先に呼び出し側のシェルで kaizen_config_load を呼んでおく（`$( )` の中で初めて呼ぶと、node を毎回起動する）。
kaizen_config_value() { # $1: キー名
	kaizen_config_load || return 2
	local var="kaizen_cfg__$1"
	[ "${!var+set}" = set ] || return 1
	printf '%s' "${!var}"
}

# キーの値の出所（default・repo・local・user・env）を出力する。値が無ければ 1。
kaizen_config_source() { # $1: キー名
	kaizen_config_load || return 2
	local var="kaizen_cfg_src__$1"
	[ "${!var+set}" = set ] || return 1
	printf '%s' "${!var}"
}

# 民生暦 (y, m, d) を 1970-01-01 からの日数へ変換する（Howard Hinnant の days_from_civil）。
# `date -d` / `date -j -f` は GNU と BSD で意味が違うため、算術だけで求めて実装差を持ち込まない。
# 引数は 10 進の整数（呼び出し側が `10#` で先頭 0 を潰してから渡す）。
kaizen_days_from_civil() { # $1: 年 $2: 月 $3: 日
	local y=$1 m=$2 d=$3 era yoe doy doe
	y=$((y - (m <= 2 ? 1 : 0)))
	era=$(((y >= 0 ? y : y - 399) / 400))
	yoe=$((y - era * 400))
	doy=$(((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1))
	doe=$((yoe * 365 + yoe / 4 - yoe / 100 + doy))
	printf '%s' $((era * 146097 + doe - 719468))
}

# `YYYY-MM-DD` を 1970-01-01 からの日数へ変換する。形式が違えば 1 を返す。
# **判定できない日付を「古い」として扱わない。** 忘却も回収も「消える側」の操作なので、
# 読めない日付を古いとして扱うと、まだ新しい学びまで忘れることになる。
kaizen_days_from_date() { # $1: YYYY-MM-DD
	local y mo d
	[[ "${1:-}" =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})$ ]] || return 1
	# 先頭 0 を 8 進として解釈させない（`08` / `09` は算術エラーになる）。
	y=$((10#${BASH_REMATCH[1]}))
	mo=$((10#${BASH_REMATCH[2]}))
	d=$((10#${BASH_REMATCH[3]}))
	[ "${mo}" -ge 1 ] && [ "${mo}" -le 12 ] || return 1
	[ "${d}" -ge 1 ] && [ "${d}" -le 31 ] || return 1
	kaizen_days_from_civil "${y}" "${mo}" "${d}"
}
