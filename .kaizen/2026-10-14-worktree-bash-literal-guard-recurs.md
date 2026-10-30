---
date: 2026-10-14
type: hook
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# worktree の隔離セッションで、本文に git の語を含む Bash 呼び出しの拒否が、適用済みの学びの後も再発した

## 事象

issue-batch の #631 の作業で、worktree に入った後の Bash 呼び出しが 6 回拒否された（`this command names git in a form too complex to verify`）。
拒否された形は次のとおりである。

- python の quoted heredoc の本文に `git(...)` や `GitHub` を含むもの
- `-t 'GitHub'` の引数や、`r.githubSkipped` を grep する引数
- `.agents/skills/git-worktree/...` のパスを含む複合コマンド
- `; git status --short` を末尾に付けた複合コマンド

どれも Write ツールでスクリプトを書いて `bash <絶対パス>` で実行する形に直して通した。

記録した後も、同じセッションで 9 回以上再発した。
例は、`kaizen-kedb-match.sh` に `"gh issue develop"` を渡した呼び出し（変数名 `githubTarget_` を置換する sed、`gh --jq` の `\(.number)` を含む式、`github.mjs` のパスを含む複合コマンドなど）。
記録が文脈にあっても、複合コマンドを書く時点では参照されなかった。

この制約は `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md` で記録し、`skills/git-worktree/references/isolation.md` に適用済みである。

2026-10-15、#616 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 6 回拒否された。
`this command names git in a form too complex to verify` が 5 回、`this command is too complex to verify` が 1 回である。
拒否された形は次のとおりである。

- `for` ループと `cp`・`mise trust`・`pnpm install` をつないだ準備の処理
- `git rev-list` と `git log` を `;` でつないだ処理
- `curl -o` と `||` を含む処理
- run の結果を確かめる `node -e` と、関数の定義を含む処理

どれも、単独の呼び出しに分けるか、Write ツールでスクリプトにして `bash <絶対パス>` で実行する形に直して通した。
この学びは、セッション開始時に pending として注入されていたが、最初の拒否が起きるまで書き方は変わらなかった。
注入した要約の 1 行だけでは、コマンドを書く時点の行動を変えられない。優先度を上げる根拠はこの再発であり、文書より先に決定論的な対策（PreToolUse の Hook）を適用する。

2026-10-16、#655 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 4 回拒否された。
拒否された形は次のとおりである。

- worktree に入った直後の準備の処理。`cd` と `git rev-parse` を `&&` でつないだ。
  続けて `for` ループ（`cp`）・`git status`・`mise trust`・`pnpm install`・`git fetch`・コマンド置換の `$(git rev-list ...)`・`git log` を `;` でつないだ。
  拒否のメッセージは `names git in a form too complex to verify` である
- handlebars を `pnpm update` で上げ、`pnpm audit` の結果を確かめる処理。
  `node -e '...' $S/findings-after.json` のように、`-e` のスクリプトと変数の引数を並べた `node` を含む。
  拒否のメッセージは `runs node with a value computed at runtime (the variable S) (a computed argument goes after the script or --)` である
- `bash <絶対パス>/kaizen-kedb-match.sh "worktree" "git" "Write"; echo rc=$?; cat <ファイル>`（`names git in a form too complex to verify`）
- `bash <絶対パス>/kaizen-kedb-match.sh "worktree" "heredoc"; echo rc=$?`（`runs bash inside a construct too complex to verify`）

どれも、単独の呼び出しに分けるか、Write ツールでスクリプトにして `bash <絶対パス>` で実行する形に直して通した。
この学びはセッション開始時に注入されていたが、worktree に入った最初の呼び出しから、この形を書いた。
1 回目と 2 回目は 19 秒しか離れておらず、拒否の理由も違う（2 回目は `git` の語ではなく `node` の引数）。1 回目のメッセージを読んでも、2 回目の形は避けられなかった。
2 回目の後、handlebars を上げて確かめる処理はスクリプトに直した。それでも、後の kaizen の照合では、同じ形の複合コマンドを再び書いて 2 回拒否された。
これで、#631・#616・#655 の 3 つのセッションで、worktree に入った後の複合コマンドが拒否されている。
文書の注入では書き方が変わらないことの裏付けであり、「## 提案」の PreToolUse の Hook を先に適用する根拠を強める。
ただし、今回の 4 回のうち、提案の Hook の条件（heredoc か `;`・`&&` と、`git` の語の両方）に当たるのは 1 回目と 3 回目だけである。
2 回目は `git` の語を含まず、4 回目は `bash` の起動を理由に拒否された。
Hook の条件は、`;`・`&&` と `node` や `bash` の起動の組まで広げる（「## 提案」に追記した）。広げた条件で、4 回とも拾える。

2026-10-16、issue-batch の #632 の作業で、worktree に入った後の Bash の呼び出しが 2 回拒否された。
1 回目は、worktree に入った直後の準備の処理である。`git rev-parse`・`git branch`・`cp`・`mise trust`・`pnpm install`・`git status` を `;` でつないだ（`names git in a form too complex to verify`）。
2 回目は、python の quoted heredoc で置換をまとめた処理で、本文の JavaScript に `git(...)` の呼び出しを含んでいた（`feeds python text naming git in a plain command`）。
どちらも、単独の呼び出しに分けるか、Write ツールでスクリプトにして実行する形に直して通した。
同じ run の前の段（issue-batch の preflight）でこの学びを読んでいたが、worktree に入った最初の呼び出しで同じ形を書いた。4 つ目のセッションでの再発である。

2026-10-17、同じセッションで #632 の run を再開した後にも、拒否が 6 回起きた。
拒否された呼び出しは、`git -C <共有のリポジトリ>`、`&&` でつないだ `git rev-parse` と `sed` と `bash`、python の quoted heredoc、`sed` でスクリプトを作る呼び出し、変数に入れたパスで `bash` を起動する呼び出しである。
python の heredoc の 1 回は、本文の文字列に `git` の語があっただけで、git を実行しない置換だった。
どれも Write ツールでスクリプトにして、絶対パスで実行する形に直して通した。この学びが注入されていて、前の日に同じ形で拒否されたことも文脈にあるのに、同じセッションの中で再び起きた。

2026-10-17、#576 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 2 回拒否された（`names git in a form too complex to verify`）。
1 回目は、`git fetch` と `$(git rev-list ...)` と `git log` を `&&` でつなぎ、続けて `grep`・`pnpm audit --help` を `;` でつないだ処理である。
2 回目は、`node scripts/gates/...` の検査 2 つと `git status --short` を `;` でつないだ処理である。
どちらも git の操作を単独の呼び出しに分けて通した。
この学びはセッション開始時に注入されていたが、worktree に入った後の最初の git を含む複合コマンドで同じ形を書いた。5 つ目のセッションでの再発である。

2026-10-17、#669 の作業（issue-start から git-worktree enter、pr-finalize-loop）で、worktree に入った後の Bash の呼び出しが 7 回拒否された。
拒否された形は次のとおりである。

- worktree に入った直後の準備。`git rev-parse`・`for` ループの `cp`・`git status`・`mise trust` を `;` でつないだ
- 変更したファイルだけに pre-commit を当てる処理。`$( { git diff ...; git ls-files ...; } | sort -u )` のコマンド置換を含む
- python の quoted heredoc の本文に `shell(git:*)` を含む置換
- `reinstall-skill.sh`・`git add -A`・`lefthook run` を `;` でつないだ処理
- `H=$(git rev-parse HEAD)` を含む受け入れ条件の検査
- `sed` と `diff` を含む Issue の本文の準備（`this command is too complex to verify`）
- kaizen の抽出で、`ls`・走査ツール・`kaizen-kedb-match.sh` を `;` でつないだ処理（この学びを照合する呼び出しそのもの）

どれも、単独の呼び出しに分けるか、Write ツールでスクリプトにして `bash <絶対パス>` で実行する形に直して通した。
この学びはセッション開始時に注入されていたが、拒否のたびに形を直し、次の複合コマンドでまた拒否された。
同じ形は #631・#616・#655・#632・#576・#669 の 6 つのセッションで続いており、文書では書き方が変わらないことの裏付けが増えた。

2026-10-17、#606 の作業で、python の quoted heredoc に `git` の語や `gh` の引数を含めた呼び出しと、`&&` でつないだ `git commit` と `grep` が、10 回以上拒否された。
どれも、処理を Write ツールでスクリプトにして絶対パスで実行するか、git の操作を単独の呼び出しに分けて通した。#669 に続き、7 つ目のセッションでの再発である。

2026-10-18、issue-batch の #662 の作業で、worktree に入った後の Bash の呼び出しが 4 回拒否された。
1 回目は、`for` ループの中で変数 `q` を `gh api` の引数に渡し、GitHub の検索を 2 回実行する処理である（`runs gh with a value computed at runtime (the variable q)`）。
2 回目は、python の quoted heredoc で mutations.json に追記し、続けて `oxfmt`・`vitest`・`grep` を `;` でつないだ処理である（`this command is too complex to verify`）。
3 回目は、`grep -n -i 'eval' <ファイル>` と `ls` を `;` でつないだ処理である（`runs a string through eval`）。`eval` は grep の検索語で、実行していない。
4 回目は、記録のスクリプトの `--sha` に、手で書いた SHA の前半 8 文字と `$(git rev-parse HEAD | cut -c9-)` を連結して渡した処理である（`names git in a form too complex to verify`）。
この形は、拒否されなくても、表示された SHA を手で書き写す誤りに当たる。AGENTS.md は「ID・完全な SHA・長い prompt・スクリプト名は、表示された結果から手で書き写さない。」と定めている。PR の `headRefOid` を取得して渡すスクリプトに直した。
どれも、単独の呼び出しに分けるか、Write ツールでスクリプトにして絶対パスで実行する形に直して通した。
1 回目から 3 回目は、`git` の語を含まずに拒否された。提案の Hook の条件には、`gh` に変数の引数を渡す形、heredoc を含む複合コマンド、`eval` の語を含む形も含める。8 つ目のセッションでの再発である。

2026-10-18、#662 の PR #691 を利用者の決定 B で仕上げる作業で、worktree に入った後の Bash の呼び出しが 2 回拒否された。
1 回目は、python の quoted heredoc で mutations.json を表示し、続けて `sed -n` を 2 回つないだ処理である（`this command is too complex to verify`）。
2 回目は、`oxfmt` に続けて `echo rc=$?` と `git diff --stat` を `;` でつないだ処理である（`names git in a form too complex to verify`）。
どちらも、Write ツールでスクリプトにして絶対パスで実行するか、git の操作を単独の呼び出しに分けて通した。
同じセッションの #692 でこの記録に追記した直後でも、worktree に入った後の最初の複合コマンドで同じ形を書いた。
同じ日の #651 と #681 の再発は、「### apply のときに確かめること」の、#651 と #681 を名指しした箇条に書いてある。

2026-10-19、issue-batch の #689 の作業でも、`kaizen-extract-done.sh` の起動と `; echo rc=$?` をつないだ呼び出しが、`runs bash inside a construct too complex to verify` で拒否された。
単独の呼び出しに分けて通した。同じ形（`bash` の起動と `; echo rc=$?` の組）は、この記録の #655 の箇条に既に書いてある。
同じ作業で、python の quoted heredoc で benchmark.md を置換し、続けて `git add` と `git status` をつないだ呼び出しも、`feeds python text naming git in a plain command` で拒否された。Write ツールで書き直して通した。

2026-10-26、#760 の作業（issue-start から worktree に入った後）で、Bash の呼び出しが 1 回拒否された。
拒否された形は、`for` ループで `gh issue view` を 4 回呼び、`--jq` に `\(.number)` を含む式を渡したものである。
拒否のメッセージは `names git in a form too complex to verify` で、git を実行しない呼び出しでも、検証できない形として止められた。
`gh issue list --search` の 1 回の呼び出しに書き換えて通した。
この学びはセッション開始時に注入されていたが、ループを書く時点では参照されなかった。
ループと jq の文字列の補間という、この記録に既に書いた形と同じ原因である。

## 根本原因

1. なぜ拒否されたか → 隔離セッションのガードは字面で判定し、本文・引数・パスに `git` を含む複合コマンドや heredoc を拒否する。
   `git` の語を含まなくても、git を実行しないことを示せない形は拒否する（#655 の 2 回目と 4 回目）。
   `node` では、`-e` のスクリプトと変数の引数を並べると、どのオペランドがプログラムかを決められないとして拒否し、変数の引数をスクリプトの後か `--` の後に置くよう案内する。
   複合コマンドの中の `bash` の起動も、渡すシェルの本文が git を実行しないことを示せないとして拒否する。
2. なぜ同じ形を書いたか → 適用先の `isolation.md` は worktree に入る時点で読む文書で、コマンドを書く時点（実装・検証の途中）には参照されない。
3. なぜ参照されないか → issue-batch・issue-start の実装の手順に、worktree の中では検証や編集のスクリプトを最初から Write ツールでファイルにする、という書き方の取り決めが無く、文書の 1 か所に頼っている ← 根本原因

## 提案

worktree の隔離セッションでは、heredoc・複合コマンド・`git` の語を含む処理を、最初から Write ツールでスクリプトにして絶対パスで実行し、git の操作は単独の呼び出しにする。

- 反映先の候補: `issue-batch` の `references/orchestration.md`「issue-start への handoff」と `issue-start` の worktree の項に、この書き方を 1 行で置く。
  原本は `git-worktree` の `isolation.md` のまま参照する。
- 決定論的な対策の候補: PreToolUse の Hook で、worktree のセッションの Bash の本文に heredoc か `;`・`&&` と `git` の語が両方あれば、実行前に「スクリプトファイルにする」と案内する（ハーネスの拒否より先に、直し方を示す）。
  #655 の拒否から、`;`・`&&` と組む形として、`-e` のスクリプトに変数の引数を並べた `node` と `bash` の起動も条件に含める。
  #655 の 4 回目の `bash <スクリプト> <引数>; echo rc=$?` は `git` の語を含まないので、起動の組で拾う。`echo` の引数の `$?` は実行時に決まる値なので、拒否の理由にこの展開が関わっている可能性もある。
- KEDB 照合: `worktree`・`Bash`・`拒否` で `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md`（applied）に一致。applied なので追記せず、この記録を新しく作った。

### apply のときに確かめること

PR #656 のレビューで出た指摘である。上の Hook の条件の細部は、apply の時点で次のことを確かめてから決める。

- 区切りを `;`・`&&` だけにすると、#616 の `curl -o` と `||` を含む拒否や、`for` ループ・パイプ・改行でつないだ形を拾えない。#631・#616・#655 のすべての拒否に条件を当てる。
  #662 の 4 つの拒否にも当てる。`for` ループの変数を `gh` の引数に渡した形（`runs gh with a value computed at runtime`）と、heredoc と `;` でつないだ形である。
  引数の中のコマンド置換 `$(git ...)` もある。
  検索語やパスに `eval` の語を含む形（`grep ... scripts/eval/` など）にも当てる。ハーネスはこの形を `runs a string through eval` として拒否する。
- `;`・`&&` と `node`・`bash` の起動の組は、ハーネスが通す正当な複合コマンド（定数の引数だけの `pnpm exec vitest run a.test.ts && node scripts/x.ts` など）にも当たる。ハーネスの拒否の理由（`computed at runtime`・`inside a construct too complex`）に対応する形に絞り、誤検知しないことを確かめる例を挙げる。
- 新しい Hook を書かず、Bash の呼び出しをセグメントに分けて判定する既存の PreToolUse の Hook（`scripts/hooks/bash-command-guard.sh`）に足せるかを先に確かめる。
- 2026-10-18、#676 の作業でも、README に 1 行を足す `printf ... >> README.md` と、続けて lint を `;` でつないだ処理が、引数に日本語の文を持つ `printf` として拒否された。Edit ツールで足す形に直して通した。
  同じ作業で、benchmark.md に 1 行を足す `printf` も同じ理由で拒否された。1 回目の拒否で Edit ツールに直した後、次の追記でまた `printf` を書いた。
- 2026-10-18、#651 の作業でも、`sha=$(gh pr view ...)` と `&&` でつないだ記録の投稿が `this command is too complex to verify` で拒否された。`gh` の出力を変数に入れて次のコマンドに渡す形も、条件に当てる。
- 2026-10-18、#681 の作業でも、`for` ループの変数を `node -e` の引数に渡して eval の結果を読む処理が `runs node with a value computed at runtime` で拒否された。Read ツールでファイルを読む形に直して通した。
  同じ作業で、`scripts/eval/` のパスを grep する呼び出しも、`eval` の語で `runs a string through eval` として拒否された。
- 2026-10-18、#681 と #651 の merge の作業でも 6 回拒否された。新しく出た形は 2 つある。
  引用符で囲まない変数を `sed` のオプションの位置に置く形（`sed -i ... $W/...`）は `computed at runtime where an option may stand` で拒否された。
  `for` ループの変数を `gh api` の URL に入れる形は `runs gh with a value computed at runtime` で拒否された。
  ほかは既知の形（`; echo rc=$?` と `bash` の起動の組、`scripts/eval/` の grep）だった。
  どれも、Write ツールでスクリプトにして絶対パスで実行するか、定数の引数だけの単独の呼び出しに分けて通した。
- 2026-10-18、#676 の merge の前の作業でも、`kaizen-kedb-match.sh` の引数に `"eval"` を渡し、`; echo rc=$?` と `grep docs/...` をつないだ呼び出しが `runs a string through eval` で拒否された。
  引数の語だけでも `eval` に当たる。単独の呼び出しに分けて通した。
- 2026-10-18、#676 の記録の投稿でも、`sha=$(gh pr view ...)` と `git rev-parse`・`git status` を `&&` でつないだ呼び出しが `names git in a form too complex to verify` で拒否された。Write ツールでスクリプトにして通した。

### 再発の記録（#679）

2026-10-18、issue-batch の #679 の作業で、worktree に入った後の Bash の呼び出しが 5 回拒否された。
python の quoted heredoc で置換スクリプトを渡した呼び出し、`cat >>` の heredoc で追記してから `sed -i` と `sed -n` を `&&` でつないだ呼び出し、再インストールと `git status` を `;` でつないだ呼び出しである。
kaizen のチェックが示した解消のコマンド（共有ツリー側の `kaizen-extract-done.sh` を `; echo` でつないだもの）と、`cd <worktree> &&` で始めた `git commit` も拒否された。
前者は worktree の中のコピーを絶対パスで、後者は `git commit` を単独で実行して通した。
どれも、Write ツールでスクリプトにして絶対パスで実行するか、`git` の操作を単独の呼び出しに分けて通した。

### 再発の記録（#697）

2026-10-19、issue-batch の #697 の作業で、別の worktree にある `kaizen-candidate-scan.sh` を `bash` で起動した呼び出しが拒否された。
出力をファイルに書いて `; echo rc=$?; tail` をつないだ形で、理由は `runs bash inside a construct too complex to verify` だった。
既知の形（`bash` の起動と `; echo` の組）で、Write ツールでスクリプトにして絶対パスで実行して通した。
同じ作業で、`for` ループの変数を `sed -n "${n}p"` に渡して transcript の行を読む呼び出しも、`runs sed with a program computed at runtime` で拒否された。
python のスクリプトを Write ツールで書き、行番号を引数で渡して通した。

### 再発の記録（#701・#710）

2026-10-19、issue-batch の #701 と #710 の作業で、worktree に入った後の Bash の呼び出しが 10 回以上拒否された。
新しく出た形は 2 つある。1 つは、`cat evals/README.md` や `scripts/eval/*.sh` のように、パスに `eval` の語を含む読み取りの呼び出しである（`runs a string through eval`）。
もう 1 つは、`for` ループの変数を `find` の引数に渡す呼び出しである（`runs find with a value computed at runtime`）。
ほかは既知の形（準備の処理を `;` でつないだもの、`bash` の起動と `; echo rc=$?` の組、`cat >>` の heredoc でテストに追記するもの、変数に入れたパスで `python3` を起動するもの）だった。
どれも、Write ツールでスクリプトにして絶対パスで実行するか、Edit ツールで編集するか、定数の引数だけの単独の呼び出しに分けて通した。
この学びはセッション開始時に注入され、preflight の間も文脈にあったが、worktree に入った後の最初の準備の処理で同じ形を書いた。

### 再発の記録（#678）

2026-10-19、issue-batch の #678 の作業で、単独の `git add` が 2 回拒否された（`names git more than once`）。
引数のパス `scripts/skills/git-worktree` の語 `git` を、2 回目の git の起動として数えたためである。
1 回目は `git commit` を同じレスポンスで並行して送っていたので、commit だけが実行され、記録の CSV 2 件だけの commit ができた。`--amend` は使えないので、コードの変更は別の commit に入れた。
glob（`'scripts/skills/*-worktree/'`）に変えた 3 回目は、git が pathspec を解決できずに失敗した。`git add scripts/skills` とパスを広げて通した。
`git add` と `git commit` は同じレスポンスで並行して送らず、`git add` の成功を確かめてから `git commit` を送る。
同じ作業の PR #716 の反復 1 でも、`for` の変数を `sed -n "${n}p"` に渡して transcript を読む呼び出しが `sed with a program computed at runtime` で拒否された。
この形は同じセッションで 2 回目である。python のスクリプトにして通した。
反復 2 でも、scratchpad のパスを変数 `d` に入れて `bash $d/reply.sh` を `&&` でつないだ返信の呼び出しが `runs bash in a plain command` で拒否された。パスをそのまま書いた単独の呼び出しに分けて通した。
PR #716 の merge の前後でも 3 回拒否された。新しい形は 3 つある。
環境変数の前置き（`BASH_ENV=<パス> pnpm exec vitest ...`）は `runs BASH_ENV= with a value the shell or another program acts on` で拒否された。
`powershell.exe` の起動（Windows のイベントログを読むもの）は `runs powershell in a plain command` で拒否され、利用者に `!` で実行してもらった。
`until` のループで `gh ... --jq '"\(.state) ..."'` を回す待機は `inside a construct too complex to verify` で拒否された。
前の 2 つは Write ツールのスクリプトにして通した。`sleep` と後続のコマンドの組は、ハーネスが Monitor かバックグラウンドの実行を使うよう求めて止めた。

### 再発の記録（#688）

2026-10-20、issue-batch の #688 で、PR #720 に停止の記録を投稿する呼び出しが `names git in a form too complex to verify` で拒否された。
`sha=$(gh pr view ...)` と `git rev-parse HEAD` の比較を `&&` でつなぎ、記録のスクリプトと `gh pr comment` を続けた形である。
2026-10-18 の #676 と同じ形である。Write ツールでスクリプトにして絶対パスで実行して通した。

### 再発の記録（#690）

2026-10-20、issue-batch の #690 の作業で、Bash の呼び出しが 2 回拒否された。
1 回目は、`git commit` の出力をファイルに書き、`; echo rc=$?` と `tail` を続けた呼び出しである。
2 回目は、python の quoted heredoc と `git log` を 1 つの呼び出しに並べた形である。
1 回目は `git commit` を単独で、2 回目は Write ツールでスクリプトにして絶対パスで実行して通した。
同じ作業で、main の kaizen のチェックが transcript の形式を読めずに commit を止めた。#710 で直している形で、#710 のバージョンのスキャナで候補を確かめてから処理済みにした。

### 再発の記録（#697 の仕上げ）

2026-10-20、issue-batch の BLOCKED になった PR #715 を仕上げる作業で、worktree の中の Bash の呼び出しが拒否された。
`reinstall-skill.sh` と `markdownlint-cli2` を `&&` と `;` でつなぎ、最後に `git status --short` を置いた形である。
理由は `names git in a form too complex to verify` だった。
既知の形（準備の処理を `;` でつないだものに `git` の語が入る）で、Write ツールでスクリプトにして絶対パスで実行して通した。
この学びはセッション開始時に注入されていたが、`git status` を確認のために末尾に足した 1 語で同じ形になった。
続けて BLOCKED の PR を順に仕上げた作業（#718・#722・#720・#714・#721）でも、同じ形が 5 回以上拒否された。
PR の HEAD を待つ `for` のループの中で `git rev-parse` を変数に入れる形と、`gh pr checks` の後に `git status` をつないだ形である。
どれも、`git` の操作を単独の呼び出しに分けるか、Write ツールのスクリプトにして通した。

### 再発の記録（#653）

2026-10-20、issue-batch の #653 の作業で、worktree に入った後の Bash の呼び出しが 4 回拒否された。
1 回目は、`git mv` の後に `sed` の一括置換と `grep` を `;` でつないだ形である（`names git in a form too complex to verify`）。
2 回目は、同じ処理で除外の対象に `^./.git` を書いた `grep` を含む形で、`git` の語だけで同じ理由で拒否された。
3 回目は、`for` ループの変数を `node` の引数に渡して検査を順に実行する形である（`runs node with a value computed at runtime`）。
4 回目は、manifest を書き換える python の quoted heredoc と、eval のランナーを書く `cat >` の heredoc を 1 つの呼び出しに並べた形である（`this command is too complex to verify`）。
どれも、Write ツールでスクリプトにして絶対パスで実行するか、`git mv` を単独の呼び出しに分けて通した。
この学びはセッション開始時に注入されていたが、worktree に入った後の最初の一括の処理で同じ形を書いた。
同じ作業の後半（PR #728 の受け入れ条件の検査・PR の作成・manifest の更新・eval の結果の確認）でも、4 回拒否された。
URL の `github.com` を含む `node` の検査、`gh pr create` のタイトルに `refactor(...)` を含む複合コマンド、`git` の語を含む JSON を渡す python の連続の呼び出し、`for` ループの変数を `sed -n` に渡す形である。
どれも、Write ツールでスクリプトにして、引数を定数にした単独の呼び出しで通した。
同じ run の #687・#719 でも、テストに追記する `cat >>` の heredoc と、`for` ループの変数を `bash` や `node` の引数に渡す形が、それぞれ拒否された。Edit ツールとスクリプトに直して通した。
同じ run の #724 でも、再インストールと同期の検査の後に `git status --short` をつないだ形が拒否された。`git` の操作を外した呼び出しにして通した。

### 再発の記録（#762）

2026-10-22、#762 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 3 回拒否された（`names git in a form too complex to verify`）。
1 回目は、worktree に入った直後の準備で、`git rev-parse`・`for` ループの `cp`・`git status`・`mise trust` を `;` でつないだ形である。#669 の 1 つ目の箇条と同じ形である。
2 回目は、`git diff` と検査のスクリプトを `;` でつないだ形である。
3 回目は、`kaizen-kedb-match.sh` に `"git"` を引数で渡し、`; echo rc=$?; cat` をつないだ形である（#655 の 3 つ目の箇条と同じ）。
どれも、Write ツールでスクリプトにして絶対パスで実行するか、単独の呼び出しに分けて通した。
この学びはセッション開始時に注入されていたが、worktree に入った最初の準備の処理で同じ形を書いた。
同じ原因の再発を確かめたので、confidence を high にした。

### 再発の記録（#781）

2026-10-26、#781 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 5 回拒否された。
1 回目は、worktree に入った直後の準備で、`git rev-parse`・`git branch`・`cp`・`mise trust`・`pnpm install` を `;` でつないだ形である（#669 の 1 つ目の箇条と同じ）。
2 回目は、引用符で囲まない変数を `sed -i` のオペランドに置いた形である（#681 と #651 の merge の箇条と同じ）。
3 回目と 4 回目は、`git diff --stat` を先頭に置き、typecheck と lint を `;` でつないだ形と、`kaizen-kedb-match.sh` に `"git"` を渡した形である（#762 と同じ）。
5 回目は、`kaizen-kedb-match.sh` の起動と `; echo rc=$?` の組である（#655 の 4 つ目の箇条と同じ）。
どれも、単独の呼び出しに分けるか、Read ツールで読む形に直して通した。
この学びはセッション開始時に注入されていたが、worktree に入った最初の準備の処理で同じ形を書いた。新しい形は無かった。

### 再発の記録（#748）

2026-10-26、issue-batch の #748 の作業で、worktree に入った後の Bash の呼び出しが 2 回拒否された（`names git in a form too complex to verify`）。
1 回目は、`for` ループで `git grep -l` を呼んで、廃止するチェックの参照を挙げる形である。
2 回目は、同じ処理を `grep -rl` に変えたが、除外の引数に `--exclude-dir=.git` を書いていた。git を実行しない `grep` でも、引数の `.git` の語で拒否された（#653 の 2 回目と同じ形）。
Write ツールでスクリプトにして絶対パスで実行して通した。
同じ run の preflight でこの学びを読んでいたが、worktree に入った最初の調査の処理で同じ形を書いた。
同じ run の #750 でも、`reinstall-skill.sh` の起動に `> /dev/null 2>&1; echo rc=$?` をつないだ呼び出しが拒否された。
理由は `runs bash inside a construct too complex to verify` で、#655 の 4 つ目の箇条と同じ形である。単独の呼び出しに分けて通した。

### 再発の記録（#797）

2026-10-28、issue-batch の run の #797 で、worktree に入った後の Bash の呼び出しが 10 回ほど拒否された。
拒否された形は、`for` ループで local の設定をコピーする準備の処理と、`.github/workflows/` や `git-worktree` のパスを含む呼び出しである。
quoted heredoc の python の本文に `git-worktree` を含むものも拒否された。
新しく出た形は、`/usr/bin/time` のように、実行するコマンドの名前を引数に取るコマンドである。「### apply のときに確かめること」の条件にも、この形を当てる。
どれも単独の呼び出しに分けるか、Write ツールでスクリプトにして実行する形に直して通した。
この学びは pending として注入されていたが、最初の拒否が起きるまで書き方は変わらなかった。

### 再発の記録（#766 の作り直し）

2026-10-30、issue-batch の run の #766 で、worktree に入った後の Bash の呼び出しが 8 回ほど拒否された。
拒否された形は、`mise trust` と `pnpm install` と `git diff` を `;` でつないだ呼び出しである。
コメントに `git` の語を含む TypeScript の本文を、python の quoted heredoc で渡した呼び出しも拒否された。
`kaizen-candidate-scan.sh` を変数のパスと `</dev/null` 付きで起動した呼び出しと、`git commit` の出力をファイルに書いて `; rc=$?` を続けた呼び出しも拒否された。
manifest を更新する JSON の heredoc と python の起動を並べた呼び出しも、本文に `git` を含まないのに拒否された。
どれも単独の呼び出しに分けるか、Write ツールでスクリプトにして絶対パスで実行する形に直して通した。
