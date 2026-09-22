#!/usr/bin/env bash
# 追跡 Issue（接頭辞 + 更新日）を引く共通ロジック。source して関数を呼ぶ。
#
# 正本はこの 1 ファイル。`.github/workflows/kaizen-schedule.yml`（＝配布テンプレート
# `skills/kaizen/assets/kaizen-schedule.yml` のバイト単位の複製）と
# `.github/workflows/outdated.yml` の両方がこれを source する。以前は同じ約 100 行が
# 両ワークフローへ展開されており、片方だけ直る余地があった（Issue #420）。
#
# **正本をスキル内に置くのは配布物だから**（`.agents/rules/distributed-skill-bundle-artifacts.md`）。
# composite action へ括り出すと、下流リポジトリが本リポへの外部参照と SHA pin 更新を負い、
# `gh skill install` が配る一式だけでは定期実行が成立しなくなる。
#
# 呼び出し規約:
#   ISSUE_TITLE_PREFIX      照合する接頭辞（env。空・未設定は fail-closed で落とす）
#   resolve_tracking_issues 照会して `numbers`（昇順の Issue 番号）/ `scanned` / `truncated` を設定する
#   warn_if_truncated "<この分岐で出る害>"
#                           打ち切っていたときだけ `::warning::` を出す（触った分岐だけで呼ぶ）
#
# shellcheck shell=bash

# 取得上限は 1 箇所で決める。打ち切り判定の閾値と別リテラルにすると、片方だけ
# 上げたときに誤警告（打ち切っていないのに鳴る）と検出漏れの両方が起きる。
list_limit=100

# 追跡 Issue は 1 本だけ。タイトルへ更新日が入るので完全一致では引けない。
# **素の前方一致にはしない**——「<接頭辞>について相談」のような無関係な Issue まで拾い、
# それを毎週上書きしてしまう。接頭辞を外した残りが「空」か「 (YYYY-MM-DD)」で
# あることまで確かめる。空を受理するのは、日付を入れる前に作られた既存の追跡 Issue を
# 引き継いでリネームするため。
#
# `gh issue list` の既定は 30 件までなので、open Issue の多いリポジトリでは
# 既定のままだと取りこぼして毎週新しい Issue を作る。`--search` で母数を絞る。
# `| head -n1` は使わない——書き手より先に読み手が閉じると pipefail が
# 「見つからなかった」に化ける。タイトルは jq の `env` 経由で渡し、引用符や
# 正規表現のメタ文字を含む値でも壊れないようにする（接頭辞側は文字列比較）。
#
# 走査件数は同じ呼び出しの中で `scanned=N` として先頭行に出す。件数を別の API で
# 引き直すと、2 回の呼び出しの間に open 数が動いて判定と根拠がずれる。
#
# pagination-ok: --search が母数を絞る。フォールバックは --limit で母数を明示し、
# 上限に張り付いたら警告する（打ち切りを成功へ倒さない）。
# **`state` は返ってきた値で確かめる。** `--search` の `is:open` はインデックス側の
# 評価なので、閉じた直後の Issue が open として返る（結果整合は偽陰性だけでなく
# 偽陽性にも振れる）。素通りさせると closed な Issue にリネームとコメントを当て、
# その週のレポートが閉じた Issue へ積まれる（`gh` はどちらも成功する）。
find_tracking_issues() {
	gh issue list --state open --limit "$list_limit" "$@" \
		--json number,title,state \
		--jq '(["scanned=" + (length | tostring)]
           + ([ .[]
                | select(.state == "OPEN")
                | select(.title | startswith(env.ISSUE_TITLE_PREFIX))
                | select(.title | ltrimstr(env.ISSUE_TITLE_PREFIX)
                         | test("^( \\([0-9]{4}-[0-9]{2}-[0-9]{2}\\))?$"))
                | .number ] | sort | map(tostring)))
          | .[]'
}

# 先頭行の `scanned=N` と、それ以降の Issue 番号を分けて読む。
#
# **`scanned` が 10 進でなければ落とす。** 打ち切り判定 `[ "$scanned" -ge "$list_limit" ]` は
# `if` の条件なので `set -e` が効かず、非数値だと bash が `integer expression expected` を出して
# 非 0 を返したぶんが `truncated=false` として通過する（＝打ち切りを黙って成功へ倒す。実測）。
# 判定の手前で入力を検証して fail-closed にする（接頭辞が空のときと同じ扱い）。
read_matches() {
	scanned=0
	numbers=()
	while IFS= read -r line; do
		case "$line" in
		"") continue ;;
		scanned=*) scanned="${line#scanned=}" ;;
		*) numbers+=("$line") ;;
		esac
	done <<<"$1"
	case "$scanned" in
	'' | *[!0-9]*)
		echo "照会が返した走査件数が 10 進でない（scanned=\"$scanned\"）。打ち切りを判定できないので落とす" >&2
		return 1
		;;
	esac
}

# **`gh` の失敗を「追跡 Issue が無い」へ倒さない。** `$( )` を**代入**に置けば
# `set -e` が拾うが、**関数の引数**に置くとその終了コードは捨てられる（実測）。
# 捨てると、secondary rate limit（403）や 5xx を踏んだ週に「0 件」と読んで
# 既存 Issue を残したまま 2 本目を作り、run は緑で終わる。
# 出力と終了コードを分けて受け、非 0 はここで落とす（fail-closed）。
query_tracking_issues() {
	local out
	if ! out="$(find_tracking_issues "$@")"; then
		echo "gh issue list が失敗した。追跡 Issue を取り違えないようジョブを落とす" >&2
		return 1
	fi
	read_matches "$out"
}

# **鳴らすのは「実際に Issue を触った分岐」だけ。** 何もしない分岐で鳴らすと、
# 追跡 Issue が無い正常な定常状態で毎週ノイズになる（害が出るのは触ったときだけ）。
warn_if_truncated() {
	if [ "$truncated" = true ]; then
		echo "::warning::open Issue の照会が ${list_limit} 件で打ち切られた。$1"
	fi
}

# 照会して `numbers` / `scanned` / `truncated` を設定する。
#
# **0 件なら `--search` 無しでもう一度引く。** 検索インデックスは結果整合なので、
# Issue を作成・リネームした直後に workflow_dispatch で再実行すると未反映で
# 「無い」と答え、2 本目を立ててしまう（一覧 API は即時反映）。
#
# フォールバックが埋めるのは**この未反映の窓だけ**。その窓では対象が最も新しい
# Issue なので、作成日降順の先頭 100 件に必ず入る。一方、古い追跡 Issue を検索が
# 返さないケース（インデックス障害等）は、open Issue が 100 件を超えるリポジトリでは
# フォールバックでも拾えない。その可能性は**Issue を触った分岐でだけ**警告する
# （`warn_if_truncated`。何もしない分岐で鳴らすと、追跡 Issue が無い正常な定常状態で
# 毎週ノイズが出る）。
#
# 追加の 1 往復が走るのは一致 0 件のとき——つまり追跡 Issue が無い期間の定常 run でも
# 毎回走る。1 回の GET なので許容する。
resolve_tracking_issues() {
	# **接頭辞が空なら gh を呼ぶ前に落とす。** 空のまま進むと `startswith("")` が全 open
	# Issue に当たり、無関係な Issue をリネームして本文を上書きする。ワークフロー側の
	# `env:` 宣言を落とす退行も、ここで落ちれば run ログに出る（以前は空の接頭辞のまま
	# 緑で走った）。
	if [ -z "${ISSUE_TITLE_PREFIX:-}" ]; then
		echo "ISSUE_TITLE_PREFIX が空。全 open Issue に当たるため追跡 Issue を触らずに落とす" >&2
		return 1
	fi

	# **戻り値を捨てない。** `set -e` が効かない文脈（`if resolve_tracking_issues; then` や
	# `|| ...` の左辺、別のシェル設定で source した配布先）では、照会が 403 で失敗しても
	# 最後のコマンドの終了コードで 0 を返し、一致 0 件として新規作成へ倒れて 2 本目を立てる。
	query_tracking_issues --search "$ISSUE_TITLE_PREFIX in:title" || return 1
	# **どちらの照会が打ち切られても、窓の外に本物が残りうる。** 1 本の flag にまとめる。
	# `scanned` は照会が返した件数であって接頭辞一致の件数ではない（接頭辞の判定は jq 側）
	# ——警告文でもそう書く。
	truncated=false
	if [ "$scanned" -ge "$list_limit" ]; then
		truncated=true
	fi
	if [ "${#numbers[@]}" -eq 0 ]; then
		query_tracking_issues || return 1
		if [ "$scanned" -ge "$list_limit" ]; then
			truncated=true
		fi
		if [ "${#numbers[@]}" -gt 0 ]; then
			echo "検索インデックス未反映のため --search 無しで再取得した（番号: ${numbers[*]}）" >&2
		fi
	fi
}
