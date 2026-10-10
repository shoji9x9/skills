#!/usr/bin/env bash
# ミューテーションテストを、手元で N 個のシャードに分けて並列に実行する（Issue #588）。
#
# ランナー（scripts/mutation/check-mutation-proof.js）は作業ツリーの対象を書き換えて戻し、
# 同時の実行をロック（node_modules/.cache/mutation-proof/）で止める。
# そのため、同じ作業ツリーでは並列にできない。ロックを外しても、互いの変異を読んで無関係なテストが落ちる。
# そこで、シャードごとに HEAD の別の worktree を作り、それぞれに依存を入れてから --shard i/N で実行する。
# worktree は commit した内容しか持たないので、tracked のファイルに commit していない変更があれば止める。
#
# 使い方: `scripts/tools/mutation-proof-shards.sh <N> [ランナーの引数...]`。
# ランナーの宣言を 4 つに分ける例: `scripts/tools/mutation-proof-shards.sh 4 scripts/mutation/check-mutation-proof.mutations.json`。
# 差分に当たる宣言を 4 つに分ける例: `scripts/tools/mutation-proof-shards.sh 4 --changed-since origin/main`。
# worktree の置き場所は MUTATION_PROOF_SHARDS_DIR（デフォルトはリポジトリの隣の <リポジトリ名>-mutation-shards）。
# 終わったら worktree を消す。対象が戻っていない worktree は消さずに残し、パスを出す。
#
# 終了コード: 0 = 全シャードが 0 / 1 = 実証できない変異がある（他は 0）/ 2 = 使い方・前提の誤り、またはシャードが 2 以上で終わった
set -euo pipefail

usage() {
	echo "usage: scripts/tools/mutation-proof-shards.sh <N> [runner args...]" >&2
	exit 2
}

[ "$#" -ge 1 ] || usage
total="$1"
shift
case "${total}" in
'' | *[!0-9]* | 0*)
	echo "mutation-proof-shards: N は 1 以上の整数で指定する: ${total}" >&2
	exit 2
	;;
esac
for arg in "$@"; do
	if [ "${arg}" = "--shard" ]; then
		echo "mutation-proof-shards: --shard はこのスクリプトが付ける（引数に含めない）" >&2
		exit 2
	fi
done

repo=$(git rev-parse --show-toplevel)
cd "${repo}"
# ランナーは相対パスをリポジトリのルートから解決する。このリポジトリの中を指す絶対パスは、worktree の中ではなく
# この作業ツリーのファイル（commit していない内容を含む）を読ませるので、リポジトリのルートからの相対パスに直す。
args=()
for arg in "$@"; do
	case "${arg}" in
	"${repo}"/*) args+=("${arg#"${repo}"/}") ;;
	*) args+=("${arg}") ;;
	esac
done
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
	echo "mutation-proof-shards: tracked のファイルに commit していない変更がある。worktree は HEAD から作るので測られない。commit してから実行する" >&2
	git status --short --untracked-files=no >&2
	exit 2
fi
head=$(git rev-parse --verify HEAD)
base="${MUTATION_PROOF_SHARDS_DIR:-$(dirname "${repo}")/$(basename "${repo}")-mutation-shards}"
mkdir -p "${base}"
echo "mutation-proof-shards: HEAD ${head} を ${total} 個の worktree（${base}/shard-*）で測る"

# 前回の worktree が残っていれば、内容を確かめずに消さない（対象が戻っていない可能性がある）。
for i in $(seq 1 "${total}"); do
	if [ -e "${base}/shard-${i}" ]; then
		echo "mutation-proof-shards: ${base}/shard-${i} が既にある。中を確かめてから git worktree remove で消す" >&2
		exit 2
	fi
done

created=()
pids=()
waited=0
# 途中で止まっても（依存の導入の失敗・中断）、作った worktree を残さない。残すと次の実行が「既にある」で止まる。
# 実行中のシャードは先に止めて待つ。対象が戻っていない worktree は --force を付けずに消すので、消せずに残る。
# shellcheck disable=SC2329 # trap から呼ぶ
cleanup() {
	local rc=$?
	trap - EXIT
	if [ "${waited}" -eq 0 ]; then
		# 全シャードを待つ前に終わったのは前提の誤りか中断で、exit 1（実証できない変異がある）と取り違えさせない。
		[ "${rc}" -eq 0 ] || rc=2
		for pid in "${pids[@]}"; do kill "${pid}" 2>/dev/null || true; done
		for pid in "${pids[@]}"; do wait "${pid}" 2>/dev/null || true; done
	fi
	for wt in "${created[@]}"; do
		if ! out=$(git worktree remove "${wt}" 2>&1); then
			echo "mutation-proof-shards: ${wt} を消さずに残す（git -C ${wt} status で確かめる）: ${out}" >&2
			rc=2
		fi
	done
	exit "${rc}"
}
trap cleanup EXIT
for i in $(seq 1 "${total}"); do
	wt="${base}/shard-${i}"
	git worktree add --quiet --detach "${wt}" "${head}"
	created+=("${wt}")
	# 新しいパスの worktree は mise の trust を引き継がない。依存はロックファイルどおりに入れる。
	(cd "${wt}" && mise trust --quiet && pnpm install --frozen-lockfile --prefer-offline --silent) </dev/null
done

for i in $(seq 1 "${total}"); do
	wt="${base}/shard-${i}"
	(cd "${wt}" && exec node scripts/mutation/check-mutation-proof.js "${args[@]}" --shard "${i}/${total}") \
		</dev/null >"${base}/shard-${i}.log" 2>&1 &
	pids+=("$!")
done
echo "mutation-proof-shards: 実行中（ログ: ${base}/shard-*.log）"

worst=0
for i in $(seq 1 "${total}"); do
	rc=0
	wait "${pids[$((i - 1))]}" || rc=$?
	last=$(grep -E '^mutation-proof: ' "${base}/shard-${i}.log" | tail -n 1 || true)
	echo "shard ${i}/${total}: exit ${rc} ${last:-（集計の行が無い。ログを見る）}"
	if [ "${rc}" -ge 2 ]; then
		worst=2
	elif [ "${rc}" -eq 1 ] && [ "${worst}" -lt 1 ]; then
		worst=1
	fi
done
waited=1

# 対象が戻っていれば worktree は clean なので、cleanup が --force を付けずに消す。消せなければ残して調べられるようにする。
exit "${worst}"
