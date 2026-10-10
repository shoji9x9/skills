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
# 置き場所の相対パスは、呼び出し元の cwd から解決する（cd の前に絶対パスにする）。
# リポジトリの中は指させない。node_modules を含む worktree が untracked として、テストやリントの走査に入るため。
base="${MUTATION_PROOF_SHARDS_DIR:-$(dirname "${repo}")/$(basename "${repo}")-mutation-shards}"
case "${base}" in
/*) ;;
*) base="$(pwd -P)/${base}" ;;
esac
base=$(realpath -m -- "${base}" 2>/dev/null || printf '%s' "${base}")
case "${base}" in
"${repo}" | "${repo}"/*)
	echo "mutation-proof-shards: worktree の置き場所（${base}）がリポジトリの中にある。リポジトリの外を指す" >&2
	exit 2
	;;
esac
cd "${repo}"
# ランナーは相対パスをリポジトリのルートから解決する。このリポジトリの中を指す絶対パスは、worktree の中ではなく
# この作業ツリーのファイル（commit していない内容を含む）を読ませるので、リポジトリのルートからの相対パスに直す。
# シンボリックリンク越しの論理パスも同じファイルを指すので、物理パスに解決してから比べる（repo は物理パスである）。
args=()
for arg in "$@"; do
	real="${arg}"
	case "${arg}" in
	/*) real=$(realpath -m -- "${arg}" 2>/dev/null || printf '%s' "${arg}") ;;
	esac
	case "${real}" in
	"${repo}"/*) args+=("${real#"${repo}"/}") ;;
	*) args+=("${arg}") ;;
	esac
done
# リポジトリの中の宣言ファイル（相対パスに直したもの）は、HEAD に commit されていなければ worktree に無い。依存を入れる前に止める。
# リポジトリの外を指す絶対パスは、どの worktree からも同じファイルを読めるので確かめない。
for arg in ${args[@]+"${args[@]}"}; do
	case "${arg}" in
	/*) ;;
	*.mutations.json)
		if ! git ls-files --error-unmatch -- "${arg}" >/dev/null 2>&1; then
			echo "mutation-proof-shards: ${arg} は commit されていない（worktree は HEAD から作るので読めない）。commit してから実行する" >&2
			exit 2
		fi
		;;
	esac
done
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
	echo "mutation-proof-shards: tracked のファイルに commit していない変更がある。worktree は HEAD から作るので測られない。commit してから実行する" >&2
	git status --short --untracked-files=no >&2
	exit 2
fi
head=$(git rev-parse --verify HEAD)
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
# setsid があれば、シャードを新しいプロセスグループで起動する（中断のときに、子の vitest までまとめて止めるため）。
# setsid は、プロセスグループのリーダーでなければ fork せずに exec するので、バックグラウンドで起動したプロセスの pid がそのままグループの id になる。
launcher=()
group_kill=0
if command -v setsid >/dev/null 2>&1; then
	launcher=(setsid)
	group_kill=1
fi
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
		# 子の vitest まで止めるため、setsid で起動したシャードはプロセスグループごと止める。
		for pid in ${pids[@]+"${pids[@]}"}; do
			# 待ち終えたシャードの pid は空にしてある（回収済みの pid は再利用されうるので、送らない）。
			[ -n "${pid}" ] || continue
			# 起動の直後で setsid がまだ exec されていなければグループが無いので、pid そのものを止める（exec の前に止まる）。
			if [ "${group_kill}" -eq 1 ] && kill -- "-${pid}" 2>/dev/null; then continue; fi
			kill "${pid}" 2>/dev/null || true
		done
		for pid in ${pids[@]+"${pids[@]}"}; do
			[ -n "${pid}" ] || continue
			wait "${pid}" 2>/dev/null || true
		done
	fi
	for wt in ${created[@]+"${created[@]}"}; do
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
	# 導入は順に実行する（PR #589 のレビューで 3 回議論した）。1 回は store からのリンクだけで 2 秒ほどで、
	# 並べると同じ store への同時の書き込みと、どのシャードの導入が失敗したかの集め方の扱いが増える。
	(cd "${wt}" && mise trust --quiet && pnpm install --frozen-lockfile --prefer-offline --silent) </dev/null
done

for i in $(seq 1 "${total}"); do
	wt="${base}/shard-${i}"
	# 呼び出し元のシェルのランナー用の環境変数（ロック・テスト用の注入）を引き継がない。引き継ぐと、全シャードが同じロックを取り合う。
	(cd "${wt}" && exec ${launcher[@]+"${launcher[@]}"} env -u MUTATION_PROOF_LOCK -u MUTATION_PROOF_TEST_COMMAND -u MUTATION_PROOF_CHANGED_FILES \
		node scripts/mutation/check-mutation-proof.js ${args[@]+"${args[@]}"} --shard "${i}/${total}") \
		</dev/null >"${base}/shard-${i}.log" 2>&1 &
	pids+=("$!")
done
echo "mutation-proof-shards: 実行中（ログ: ${base}/shard-*.log）"

worst=0
for i in $(seq 1 "${total}"); do
	rc=0
	wait "${pids[$((i - 1))]}" || rc=$?
	pids[i - 1]=""
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
