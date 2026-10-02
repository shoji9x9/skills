#!/usr/bin/env bash
# Bash 呼び出しの PreToolUse ゲート（このリポジトリのセッション用。配布物ではない）。
#
# 常時ロードの文章規約で防げず再発した 2 クラスを、決定論的に止める。
#
#   1. `gh api ... --body-file <path>`
#      `gh api` に `--body-file` は無く unknown flag で落ちる（`-F body=@<path>` か `--input <path>`）。
#      AGENTS.md に書いてあり、applied の学びもあるのに再発した。
#      `gh pr` / `gh issue` の `--body-file` は正当なので、**同じセグメントに `gh api` がある場合だけ**落とす。
#
#   2. パターンで撃つ `pkill -f` / `killall -f`
#      照合対象は full command line なので、そのコマンドを実行している自分のシェルにも一致し、
#      シェルごと落ちる（3 回踏んだ。症状は非 0 終了だけで、対象が死んだのか自分が死んだのか読めない）。
#      自分に一致しない形（`[d]ump-dom` のような文字クラス）と、PID 指定（`kill "$PID"`）は通す。
#
# 判定はセグメント単位で行う。`&&` / `||` / `;` / `|` / 改行で切り、セグメントごとに評価する
# （`gh pr create --body-file a && gh api x --body-file b` の後段だけを落とすため）。
#
# 判定の限界（Issue #423）。シェルを正規に解析せず引用状態の近似で読むので、次の穴は意図的に開けてある。
# 各行の挙動は bash-command-guard.test.js の「意図的な穴」「構造を解析せずに拾えている形」「ヒアドキュメント」で固定している。
#
#   失敗方向の優先順位: このゲートはローカルの開発支援で、セキュリティ境界ではない。
#   誤検知は正当な作業を止めるので、日常的に打つ形では誤検知を減らす側を選ぶ。見逃しは、
#   事故で打つ形（過去に再発した形）を拾えていれば許容し、故意の回避（名前を変数で組み立てる等）は対象外にする。
#
#   閉じたもの:
#   - ヒアドキュメントの本文は、読み手（`<<` を書いたコマンドとパイプの先の全段）が許可リスト
#     （cat / tee / git / gh / jq / python3 / python / node）のときだけデータとして読み飛ばす。それ以外の読み手、
#     区切り語を引用していない本文に $( ) / ` がある形、区切り語の行が見つからない形は従来どおりコードとして読む。
#     本文を実行するシェルを列挙する形にしない（引用・パス・行継続・env 経由と書き方が尽きず、漏れた形で退行する）。
#     同じ呼び出しで読み手の名前を定義し直す（関数・alias）か、探索先を変える（PATH= / hash）形では許可リストを使わない。
#     読み手がコマンド置換の中にあるときは、置換の結果を受け取る外側のコマンドも許可リストか代入（`msg=$(cat <<EOF …)`）
#     であることを確かめる（`eval "$(cat <<EOF …)"` は本文を実行する）。
#   - パラメータ展開（`cat ${x:-<<EOF;}`）の中の `<<` はヒアドキュメントを開かない（読み手が許可リストでも
#     後続の行を本文として飛ばしていた）。算術（`$(( 1 << 2 ))`）の `<<` は、読み手の境界 `(` の後の語
#     （数値・変数）が許可リストに無いので、本文をコードとして読む側に倒れる。
#   - awk の実装差: mawk 1.3.4 と BusyBox 1.35.0 の awk で回帰テストを実走して一致。gawk は未実測（手元に無い）。
#
#   閉じないもの（コストと失敗方向）:
#   - シェル委譲（sh -c / ssh / eval）はセグメント全文をコードとして扱う＝誤検知側（`bash -c '…' _ "<危険語>"` の
#     位置引数まで止める）。委譲先の引数だけを切り出すには委譲ごとの引数文法が要り、稀な形なので見合わない。
#   - 変数・間接で組み立てたコマンド名（`K=<名前>; $K -f …`）は見逃す。展開の評価が要り、事故ではなく故意の回避。
#   - 許可リストのインタプリタが読むヒアドキュメント（`python3 - <<EOF`）の本文は見逃す。本文の言語ごとに解釈が要り、
#     AGENTS.md が本文を quoted heredoc でインタプリタへ渡す形を推奨しているため、止めると日常の作業が止まる。
#   - 許可リスト外の読み手（`echo` 等、実行しない読み手を含む）の本文はコードとして読む＝誤検知側。
#   - 許可リストの読み手でファイルへ書き出してから実行する形（`cat > s.sh <<'EOF' … && bash s.sh`・次の行で実行）は見逃す。
#     書き出した内容の行方はゲートから追えない（Write ツールで書いてから実行するのと同じ）。
#   - 構造（リダイレクト・プロセス置換・case / 関数の本体）は解析しない。コード部分の部分一致で拾うので、xargs / env /
#     timeout / find -exec / case / 関数 / プロセス置換の中の実行は止まる。一方、引用していないリダイレクト先の
#     ファイル名に危険語が入ると誤検知になる（稀）。
#
# 終了コード: 0=通す / 2=ブロック（Claude Code / Codex は exit 2 だけがブロック）。
set -euo pipefail

input=""
if [ ! -t 0 ]; then
	IFS= read -r -d '' input || true
fi

# hot path: 危険語が生 JSON に現れない呼び出しはここで抜ける。
case "${input}" in
*--body-file*) ;;
*pkill*) ;;
*killall*) ;;
*) exit 0 ;;
esac

# Hook payload の形はエージェントごとに違う。Claude Code は `tool_input.command`、Codex は
# `toolArgs`（オブジェクトのことも JSON 文字列のこともある）、Copilot は `input.command` /
# 素の `command`。`.tool_input.command` だけを読むと、他 2 エージェントでは command が空になり、
# **JSON は読めているので警告も出ないまま全件素通り**する（3 エージェントへ配線したのに
# 効くのは 1 つだけ、という形で実測した）。同居する kaizen-precommit-gate.sh と同じ集合を読む。
extract_command() {
	if command -v jq >/dev/null 2>&1; then
		# 各取り出しに `?` を付ける——`.toolArgs.command` は toolArgs が**文字列**のとき
		# 「Cannot index string with string」で filter ごと失敗し、jq 経路が丸ごと落ちる
		# （実測: jq 1.8.2 で rc=5）。node が居れば後段が拾うので症状が出ないが、
		# jq だけの環境では Codex の JSON 文字列形が検査されないまま通る。
		# 候補を順に並べ、文字列のものだけを残して先頭を採る（優先順位は並び順）。
		printf '%s' "${input}" | jq -r '
			[ .tool_input.command?, .toolArgs.command?,
			  (.toolArgs | fromjson? | .command?),
			  .command?, .input.command? ]
			| map(select(type == "string" and . != "")) | first // empty
		' 2>/dev/null && return 0
	fi
	if command -v node >/dev/null 2>&1; then
		printf '%s' "${input}" |
			node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{let d;try{d=JSON.parse(s);}catch{process.exit(3);}const pick=(o)=>o&&typeof o==="object"&&typeof o.command==="string"?o.command:"";let c=pick(d?.tool_input)||pick(d?.toolArgs);if(!c&&typeof d?.toolArgs==="string"){try{c=pick(JSON.parse(d.toolArgs));}catch{c="";}}if(!c&&typeof d?.command==="string")c=d.command;if(!c)c=pick(d?.input);process.stdout.write(c);});' &&
			return 0
	fi
	return 3
}

command_text=""
if ! command_text="$(extract_command)"; then
	# 入力を読めないときは判定不能。fail-closed にすると全 Bash 呼び出しが止まるので通すが、
	# 「検査が動いていない」ことを黙らせない（0 件と未実行を同じ見え方にしない）。
	echo "bash-command-guard: 入力を解析できないため検査していない（jq / node が無いか JSON が不正）" >&2
	exit 0
fi

# ここまで来た入力は hot path で危険語を含むと判定済みなので、command が取れないのは
# 「危険語が command 以外の場所にある」か「payload の形を読めていない」のどちらか。
# 後者を黙って通すと 0 件と未実行が同じ見え方になるので、理由を残して通す。
if [ -z "${command_text}" ]; then
	echo "bash-command-guard: 危険語を含む入力から command を取り出せなかったため検査していない（payload の形が未対応）" >&2
	exit 0
fi

violations=""

# セグメントへの分割と「コードとして実行される部分」の抽出を、同じ引用状態の解釈で行う。
#
# 判定の土台を「前置きを剥いで先頭語を見る」から変えた理由——
# 前置き（制御構文・env 代入・ラッパー・コマンド置換）は列挙しても尽きず、
# レビュー 4 巡で毎回どちらかの方向へ穴が出た（正当な呼び出しを止める／実行される形を通す）。
# 実際に効くのは「その文字列がコードとして実行されるか、引用符の中のデータか」だけなので、
# そこだけを解釈する。
#
#   - 単引用符の中は**データ**（$( ) も展開されない）。丸ごと落とす
#   - 二重引用符の中もデータだが、`$( ... )` と `` ` ` `` の中は**コード**なので拾う
#   - コマンド置換の中も引用を追跡する（中の `)` で早く閉じない）
#   - 引用符の外はコード。`#` から行末はコメント＝データ
#   - 区切り（; & | 改行）は**コードとして実行される文脈**でだけセグメント境界にする
#     （`git commit -m "fix; pkill ..."` の引用内では切らず、`$( a; b )` の中では切る）
#   - ヒアドキュメントの本文は、区切り語の行まで読み飛ばす（データ）。実行される形の判定は冒頭の「閉じたもの」
#
# **引用が閉じていない入力は解釈できないので、fail-safe に倒す**（全文をコードとして扱う）。
# ヒアドキュメント本文のアポストロフィ 1 個で以降が全部データ扱いになり、
# 黙って最強の免除になっていた（実測）。本文を読み飛ばすようになった後も、
# 本文をコードとして読む形（冒頭参照）ではこの fail-safe が効く。誤検知側に倒れた場合は
# ファイル編集ツールへ迂回する（AGENTS.md に手順あり）。
split_segments() {
	awk '
	# RS で入力全体を 1 レコードにしない（`RS="\0"` は POSIX / busybox awk では空文字＝
	# paragraph mode に倒れうる。実装差で走査単位が変わる）。行を貯めて END で 1 回処理する。
	{ buf = buf $0 "\n" }
	END {
		raw = buf; sub(/\n$/, "", raw); n = length(raw)
		# 同じ呼び出しで許可リストの名前を関数・alias として定義し直した形（`cat() { bash; }`）や、
		# コマンドの探索先を変える形（`PATH=…` / `hash -p`）では、読み手の名前が実体を表さない。
		# その呼び出しでは読み手の許可リストを使わない（本文をコードとして読む＝親版と同じ）。
		reader_trusted = (raw !~ /(^|[^A-Za-z0-9_])PATH[[:space:]]*\+?=/ && raw !~ /(^|[^A-Za-z0-9_-])hash[[:space:]]/ && raw !~ /(^|[^A-Za-z0-9_-])(alias|function)[[:space:]]/ && raw !~ /(^|[^A-Za-z0-9_.-])(cat|tee|git|gh|jq|python3|python|node)[[:space:]]*\([[:space:]]*\)/)
		# 文脈は**スタック**で持つ。単一の変数で「戻り先」を覚えると、入れ子
		# （"$(dirname "$0")/x" のような日常的な形）で内側が外側の戻り先を壊し、
		# 閉じたのに閉じていない扱いになる。
		#   CODE = 引用の外 / SUB = $( ) の中 / BT = ` ` の中 … コードとして実行される
		#   SQ   = 単引用符の中 / DQ = 二重引用符の中 … データ
		sp = 0; stack[0] = "CODE"; hn = 0
		code = ""; full = ""; nfull = ""; nseg = 0
		for (i = 1; i <= n; i++) {
			c = substr(raw, i, 1); nx = substr(raw, i + 1, 1)
			cur = stack[sp]
			if (cur == "CODE" || cur == "SUB" || cur == "BT" || cur == "PARAM") {
				if (c == "\\") { addfull(nx); code = code nx; i++; continue }
				if (c == "\047") { push("SQ"); addfull(c); continue }
				if (c == "\"") { push("DQ"); addfull(c); continue }
				if (c == "`") {
					addfull(c); code = code " "
					if (cur == "BT") pop(); else push("BT")
					continue
				}
				# パラメータ展開（`${x:-<<EOF;}`）の中の `<<` は置換文字列で、ヒアドキュメントではない。
				# 中はコードとして読み（従来どおり）、最初の `}` で閉じる。入れ子は `${` だけで、素の `{` は数えない
				# （bash 5 の実測: `${x:-{a}b}` は `{a` で閉じて `{ab}` を出す）。
				if (cur == "PARAM" && c == "}") { pop(); addfull(c); code = code c; continue }
				if (c == "$" && nx == "{") { push("PARAM"); addfull("${"); code = code "${"; i++; continue }
				if (c == "$" && nx == "(") { push("SUB"); addfull(c); addfull("("); code = code " "; i++; continue }
				if (c == ")" && cur == "SUB") { pop(); addfull(c); code = code " "; continue }
				# ヒアドキュメントの開始。区切り語を控えておき、この行の改行で本文を読み飛ばす。
				# ヒアストリング `<<<` は 3 文字まとめて進める——1 文字目で見送るだけだと、
				# 2 文字目からの `<<` を区切り語付きのヒアドキュメントと読み、後続の行をデータとして飛ばす。
				if (c == "<" && nx == "<" && cur != "PARAM") {
					if (substr(raw, i + 2, 1) == "<") { addfull("<<<"); code = code "<<<"; i += 2; continue }
					if (heredoc_open()) continue
				}
				# 行コメントはデータ。コード側へ入れると、注意書きの文章で発動する。
				# full には残すが nfull（コメント抜き）には入れない——シェルへ委譲する形では
				# 全文をコード扱いにするので、そこでコメントが復活しないようにする。
				if (c == "#" && (code == "" || substr(code, length(code), 1) ~ /[[:space:]]/)) {
					while (i <= n && substr(raw, i, 1) != "\n") { full = full substr(raw, i, 1); i++ }
					i--
					continue
				}
				# 区切りはセグメント境界。どちらのセグメントにも積まない
				# （次の先頭へ混ぜると、打っていないコマンドを引用することになる）。
				if (c == ";" || c == "&" || c == "|") { emit(); continue }
				if (c == "\n") { emit(); if (hn > 0) heredoc_bodies(); continue }
				code = code c; addfull(c); continue
			}
			if (cur == "SQ") { addfull(c); if (c == "\047") pop(); continue }
			if (cur == "DQ") {
				addfull(c)
				if (c == "\\") { addfull(nx); i++; continue }
				if (c == "\"") { pop(); continue }
				if (c == "$" && nx == "(") { push("SUB"); addfull("("); code = code " "; i++; continue }
				if (c == "`") { push("BT"); code = code " "; continue }
				continue
			}
		}
		emit()
		if (sp != 0) {
			# 引用が閉じていない＝この解釈は信用できない。全文をコードとして 1 セグメントだけ出す
			# （通常分は捨てる。両方出すと同じ違反が 2 行重複する）。
			one = collapse(raw)
			printf "#C#%s\n#F#%s\n#N#%s\n", one, one, one
		} else {
			for (j = 1; j <= nseg; j++) printf "#C#%s\n#F#%s\n#N#%s\n", segc[j], segf[j], segn[j]
		}
	}
	# `<<` の位置（i）から区切り語を読み、控える。区切り語が無ければ 0 を返す（ヒアドキュメントではない）。
	function heredoc_open(    j, strip, quoted, delim, ch, q, lv) {
		j = i + 2; strip = 0; quoted = 0; delim = ""
		if (substr(raw, j, 1) == "-") { strip = 1; j++ }
		while (substr(raw, j, 1) == " " || substr(raw, j, 1) == "\t") j++
		while (j <= n) {
			ch = substr(raw, j, 1)
			if (ch == "\047" || ch == "\"") {
				quoted = 1; q = ch; j++
				while (j <= n && substr(raw, j, 1) != q) { delim = delim substr(raw, j, 1); j++ }
				j++; continue
			}
			if (ch == "\\") { quoted = 1; delim = delim substr(raw, j + 1, 1); j += 2; continue }
			if (ch ~ /[[:space:];&|<>()]/) break
			delim = delim ch; j++
		}
		if (delim == "") return 0
		hn++; hdelim[hn] = delim; hstrip[hn] = strip; hquoted[hn] = quoted; hpos[hn] = i
		# 読み手がコマンド置換の中にあるとき、置換の結果を受け取る外側のコマンドも本文を実行しうる
		# （`eval "$(cat <<EOF …)"`）。外側の置換の開始位置を控え、heredoc_bodies で各段の読み手を確かめる。
		hencl[hn] = ""
		for (lv = 1; lv <= sp; lv++) if (stack[lv] == "SUB" || stack[lv] == "BT") hencl[hn] = hencl[hn] " " spos[lv]
		addfull(substr(raw, i, j - i)); code = code " "
		i = j - 1
		return 1
	}
	# 改行の直後（i は改行の位置）から、控えた順に本文を読み飛ばす。読み飛ばすのは本文を読むコマンドが
	# 許可リストにあるとき（heredoc_consumer_ok）で、区切り語を引用していない本文に $( ) / ` が無く、
	# 区切り語の行が見つかったときだけ。どれかを満たさなければ、そこから先は読み飛ばさず通常のコードとして
	# 解釈させる（この変更の前と同じ扱い＝安全側）。
	# **本文を実行する読み手（シェル）を列挙する形にしない**——`bash` / `sh` / `ssh` / `.` / 引用したシェル名 /
	# 行継続・パス・`env bash` と書き方が尽きず、列挙から漏れた形で本文を飛ばして退行する（PR #448 のレビューで 3 回）。
	# 区切り語が無いときに全文 fail-safe へ倒さないのは、fail-safe が全文で文字クラスの免除を見るため
	# （別セグメントの `[d]x` で素の pkill -f まで免除される）。
	function heredoc_bodies(    k, p, e, line, body, found, lend) {
		lend = i
		p = i + 1
		for (k = 1; k <= hn; k++) {
			if (!heredoc_consumer_ok(hpos[k], lend) || !heredoc_enclosing_ok(hencl[k])) { hn = 0; return }
			body = ""; found = 0
			while (p <= n) {
				e = index(substr(raw, p), "\n")
				line = e ? substr(raw, p, e - 1) : substr(raw, p)
				if (hstrip[k]) sub(/^\t+/, "", line)
				p = e ? p + e : n + 1
				if (line == hdelim[k]) { found = 1; break }
				body = body line "\n"
			}
			if (!found) { hn = 0; return }
			if (!hquoted[k] && (index(body, "$(") || index(body, "`"))) { hn = 0; return }
			i = p - 1
		}
		hn = 0
	}
	# `pos` の `<<` の本文を読むコマンドと、その後ろのパイプの先が、すべて本文を実行しない読み手か。
	# 読み手は `<<` の手前で最も近い境界（行頭・| ; & ( `）の後の最初の語。行継続は境界にしない。
	# パイプの先（`cat <<EOF | bash`）も本文を受け取るので、論理行の残りを `|` で切った各段にも当てる。
	function heredoc_consumer_ok(pos, lend,    b, ch, rest, parts, np, j) {
		b = pos - 1
		while (b >= 1) {
			ch = substr(raw, b, 1)
			if (ch == "\n" && b > 1 && substr(raw, b - 1, 1) == "\\") { b -= 2; continue }
			if (ch ~ /[|;&(`\n]/) break
			b--
		}
		if (!heredoc_reader(substr(raw, b + 1, pos - b - 1))) return 0
		rest = substr(raw, pos, lend - pos)
		# プロセス置換（`cat <<EOF > >(bash)`）は読み手の出力を別のコマンドへ渡すので、パイプと同じく本文が実行されうる。
		# 置換の中身の読み手は解析せず、本文をコードとして読む側へ倒す。
		if (index(substr(raw, b + 1, lend - b - 1), ">(") || index(substr(raw, b + 1, lend - b - 1), "<(")) return 0
		np = split(rest, parts, /\|/)
		for (j = 2; j <= np; j++) if (parts[j] != "" && !heredoc_reader(parts[j])) return 0
		return 1
	}
	# 外側のコマンド置換それぞれについて、置換の結果を受け取るコマンドが許可リストの読み手か、
	# 変数への代入（`msg=$(cat <<EOF …)`）であること。`eval "$(cat <<EOF …)"` の `eval` を通さない。
	function heredoc_enclosing_ok(list,    parts, np, j, b, ch, seg) {
		np = split(list, parts, " ")
		for (j = 1; j <= np; j++) {
			if (parts[j] == "") continue
			b = parts[j] - 1
			while (b >= 1) {
				ch = substr(raw, b, 1)
				if (ch == "\n" && b > 1 && substr(raw, b - 1, 1) == "\\") { b -= 2; continue }
				if (ch ~ /[|;&(`\n]/) break
				b--
			}
			seg = substr(raw, b + 1, parts[j] - b - 1)
			gsub(/["\047]/, "", seg)
			if (seg ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[[:space:]]*$/) continue
			if (!heredoc_reader(seg)) return 0
		}
		return 1
	}
	# 本文をシェルとして実行しない読み手の許可リスト。先頭の代入（`GIT_EDITOR=true git …`）は読み飛ばす。
	# 引用した語・パス付きの語・リストに無い語は本文をコードとして読む。
	# インタプリタ（python3 / python / node）は、AGENTS.md が本文を quoted heredoc で渡す形を推奨しているので入れる
	# （本文の言語は解釈しない＝冒頭の「閉じないもの」の見逃し）。
	function heredoc_reader(s,    t) {
		gsub(/\\\n/, " ", s)
		sub(/^[[:space:]]+/, "", s)
		while (s ~ /^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+/) sub(/^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+/, "", s)
		t = s
		sub(/[[:space:]].*/, "", t)
		return reader_trusted && (t == "cat" || t == "tee" || t == "git" || t == "gh" || t == "jq" || t == "python3" || t == "python" || t == "node")
	}
	function push(s) { sp++; stack[sp] = s; spos[sp] = i }
	function pop() { if (sp > 0) sp-- }
	function addfull(s) { full = full s; nfull = nfull s }
	function collapse(t) { gsub(/\n/, " ", t); return t }
	function emit() {
		gsub(/\n/, " ", code); gsub(/\n/, " ", full); gsub(/\n/, " ", nfull)
		if (full ~ /[^[:space:]]/) { nseg++; segc[nseg] = code; segf[nseg] = full; segn[nseg] = nfull }
		code = ""; full = ""; nfull = ""
	}
	'
}

# 免除の目印は **1 文字の文字クラス**（`[d]`）だけにする。
# 範囲クラス（`[0-9]`）や複数文字（`[cC]`）は、括弧の中の文字が自分のコマンドライン上に
# そのまま現れるため、パターンが**自分自身に一致する**（`chrome.*[0-9]+` は
# 引数リテラルの `0` に一致する。実測）。自爆を避けられない形を免除にはできない。
# 配列添字は ${...} を取り除いた時点で消えているので、ここで位置は問わない。
class_escape_re='\[[^][[:space:]]\]'
# 引用文字列をそのままシェルへ渡すコマンド（中身がコードとして実行される）。
# `-lc` / `-xc` のようにオプションを束ねた形も拾う。
delegate_re='(^|[[:space:]])(ba|z|k|da|a)?sh[[:space:]]+-[A-Za-z]*c([[:space:]]|$)|(^|[[:space:]])(ssh|eval)([[:space:]]|$)'
add_violation() { violations="${violations}${violations:+$'\n'}  - $1"; }

# 分割は split_segments に委ねる（区切りの解釈と引用状態の解釈を 1 箇所にまとめる）。
segments="$(printf '%s\n' "${command_text}" | split_segments)"

seg_code=""
segment=""
while IFS= read -r line; do
	case "${line}" in
	'#C#'*)
		seg_code="${line#\#C\#}"
		continue
		;;
	'#F#'*)
		segment="${line#\#F\#}"
		continue
		;;
	'#N#'*) seg_nocomment="${line#\#N\#}" ;;
	*) continue ;;
	esac

	# 引用文字列をそのままシェルへ渡すコマンドは、その引数が**コードとして実行される**。
	# 引用の中を一律データにすると、ゲートが止めるために作られた形そのものが素通りする
	# （`bash -c "pkill -f chrome"` / `ssh host 'pkill -f node'`。実測）。
	# リテラル "sh -c" の部分一致では、短オプションを束ねた `bash -lc` / `sh -xc` を取りこぼす。
	# 委譲したら**コメントを除いた全文**をコードとして扱う（`${segment}` にするとコメント本文が
	# 検査対象へ戻り、同じ commit で入れた「行コメントはデータ」を取り消してしまう）。
	if [[ ${seg_code} =~ ${delegate_re} ]]; then
		seg_code="${seg_nocomment}"
	fi

	# 1. gh api と --body-file が同じセグメントにある。
	#    コード部分で見るので、引用符の中の文章（このゲート自身の話題を書いた --title 等）では
	#    発動せず、実行される形（制御構文の後・ラッパー越し・コマンド置換の中）は位置に依らず拾う。
	case "${seg_code}" in
	*"gh api"*)
		case "${seg_code}" in
		*--body-file*)
			add_violation "gh api に --body-file は無い（unknown flag で落ちる）。-F body=@<path> か --input <path> を使う: ${segment}"
			;;
		esac
		;;
	esac

	# 2. pkill / killall をパターン（-f）で撃っている。
	#    発動はコード部分で見る（コミットメッセージや echo で**話題にしているだけ**の
	#    呼び出しを止めないため。ルール 1 と同じ扱いに揃える）。
	case "${seg_code}" in
	*pkill* | *killall*)
		case "${seg_code}" in
		*-f*)
			# 免除（文字クラス）はパターン本体＝引用の中に書かれるので**全文**で見る。
			# 配列添字 ${...} と行コメントは取り除いてから見る（免除に数えない）。
			scan="$(printf '%s' "${seg_nocomment}" | sed -e 's/\${[^}]*}//g')"
			if [[ ${scan} =~ ${class_escape_re} ]]; then
				:
			else
				add_violation "pkill/killall -f の照合対象は full command line で、この呼び出し自身にも一致する（シェルごと落ちる）。PID 指定（kill \"\$PID\"）にするか、パターンを [d]ump-dom の形にする: ${segment}"
			fi
			;;
		esac
		;;
	esac
done <<<"${segments}"

if [ -n "${violations}" ]; then
	echo "bash-command-guard: 実行前に止めた（過去に再発した形）:" >&2
	echo "${violations}" >&2
	exit 2
fi
exit 0
