# 隔離が成立する条件

## 作るだけでは隔離にならない

`git worktree add <パス> <branch>` が作るのはディレクトリだけで、エージェントのセッションは元の場所で動き続ける。

「ツールの呼び出しを `cd <絶対パス> && ...` の形で書けば大丈夫」は成り立たない。
そこから起動する subagent・フォークして動くスキル・バックグラウンドの Bash は、
どれも起動したときの作業ディレクトリを引き継ぐので、共有ツリーで動く。

worktree を作った後で何もしなければ、次の流れで隔離されない状態になる。

1. `git worktree add <パス> -b <branch>` で worktree を作る
2. その後のツールの呼び出しを `cd <絶対パス> && ...` の形で書く
3. そこから subagent・フォークして動くスキル・バックグラウンドの Bash を起動する
4. それらは共有ツリーで動く

隔離のために作った worktree から起動したレビューが、共有の作業ツリーをレビューして
5 つのファイルを書き換え、未追跡のファイルを取り戻せない形で削除した実例がある。
その branch の変更は 1 件もレビューされていなかった。レビューしたつもりで、実際はレビューしていなかった。

**そのため、セッションを移す機能が無いなら、worktree で隔離できたと報告しない。**

## セッションを移す（Claude Code の場合）

Claude Code には `EnterWorktree` と `ExitWorktree` があり、セッションの作業ディレクトリごと移る。
入った後は、worktree の外に出るおそれのある git の操作を、ハーネスが拒否する。

以下は、公式のドキュメント（[Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees)）と、
2.1.243 の実装、`EnterWorktree` のツールの定義の本文を突き合わせて確かめた。版が変わったら読み直す。

## 入った後はハーネスが強制する

セッションが worktree に隔離されている間、Claude Code は次の 4 つをツールのエラーとして拒否する。
**この拒否は、そのセッションが起動する subagent にも同じように当てはまる**（公式のドキュメントの「How Claude Code enforces isolation」）。

| チェック | 拒否されるもの |
| --- | --- |
| ファイルの編集 | メインチェックアウトの中のパスを対象にする `Edit`・`Write`・`NotebookEdit` |
| コマンドの作業ディレクトリ | 作業ディレクトリがメインチェックアウトになる（または、worktree の外に留まると確かめられない）Bash・PowerShell・Monitor |
| git のリダイレクト | `git -C`・`--git-dir`・`GIT_DIR`・`GIT_WORK_TREE`・事前の `cd` で、メインチェックアウトに向ける git |
| コマンドの形 | worktree の中に留まると確かめられないコマンド。ブレース展開と、区切りを引用符で囲まないヒアドキュメントは、git を含まなくても拒否される |

**つまり、隔離の実体は「入る」ことである。** 入らなければどの拒否も行われず、入れば subagent まで守られる。

### 隔離中の Bash は 1 コマンドずつ素の形で書く

「コマンドの形」のチェックは範囲が広い。**プログラム名や引数を実行時に組み立てる呼び出しは、git を含まなくても拒否される。**
何が起動されるかを、文字列から確かめられないからである。

- 変数で組み立てる引数（`S=<dir>; node $S/x.mjs`）
- 複合コマンド（heredoc でファイルを書いて `wc -l` までつなげるなど）と `for` ループ
- コマンド置換を含む待機（`until [ "$(gh api ...)" != "0" ]; do sleep 30; done`）
- ヒアドキュメント（追記の `>>` でも同じ。scratchpad だけに書く場合も拒否される）

**組み立てが要る処理は、スクリプトのファイルに書いてから絶対パスで実行する。** ファイルを書く手段も、この手順に含まれる。
スクリプトはヒアドキュメントでは作れない（ヒアドキュメント自体が拒否される）。ファイルを書くツール（Claude Code なら
`Write` や `Edit`）で作り、`chmod +x` と実行は別々の呼び出しに分ける。

**判定は文字列で決まる。** 本文・コメント・置換の文字列にバージョン管理のコマンドの名前が現れるだけで拒否される。
そのため、「触る対象が scratchpad だから通るはず」という推論は当たらない。

待機やポーリングが要る手順（`pr-finalize-loop` のレビュー待ちなど）は、とくにこの形に当たりやすい。
最初からスクリプトのファイルに書く前提で設計する。

記録がコンテキストに注入されていても、コマンドを書く時点では参照されない。
`priority: high` の学びは、注入に頼らず、先に apply で反映する。

## Hook のパスは worktree に追従しない

worktree に入っても、hook の `${CLAUDE_PROJECT_DIR}` は、セッションを起動したプロジェクトのルートを指したままになる。
`${CLAUDE_PROJECT_DIR}/.claude/hooks/check.sh` のような hook は、メインチェックアウト側のスクリプトを実行する。
worktree のパスが要る hook は、入力の JSON の `cwd` フィールドを読む。こちらは worktree のルートを指し、`cd` にも合わせて変わる。

隔離を前提にしたチェックを hook で行っているなら、この点を確かめてから「worktree の中だけをチェックした」と判断する。

### `path` と `name` の違い

| 引数 | 作るもの | branch | 置き場所 | ファイルの自動の運搬（[carry-in.md](carry-in.md)） |
| --- | --- | --- | --- | --- |
| `path` | 既存の worktree に入るだけ | 触らない | 呼び出し側が選ぶ | 行われない |
| `name` | 新しい worktree | 新しく作る（`worktree-<名前>`） | `.claude/worktrees/` に固定 | 行われる |

- `path` は、`git worktree list` に載っている worktree でなければ拒否される。
- `path` で入った worktree は、`ExitWorktree` では削除されない（`action: "keep"` で元のディレクトリへ戻る）。後片付けは、[cleanup.md](cleanup.md) の手順で自分で行う。
- `name` は `/` を `+` に置き換えたうえで、ディレクトリを `.claude/worktrees/<置き換え後>`、branch を `worktree-<置き換え後>` として作る。
- `name` の base ref は、設定の `worktree.baseRef` に従う。デフォルトの `fresh` はリモートのデフォルト branch、`head` は現在のローカルの HEAD である。branch の名前は指定できない。
- **既存の名前を使い回すと、条件によってはデフォルトの branch にリセットされる。**
  条件は、`fresh` であることに加えて、次のすべてを満たすことである。
  commit していない変更も未追跡のファイルも無い。作ったときの branch のままである。独自の commit が無いか、PR が merge 済みである。
  「前回の続きから始まる」と決めつけない。
- **`.claude/worktrees/` の外のパスへ入るときは、毎回利用者の承認が要る。** `EnterWorktree` の permission rule や「今後確認しない」では省けず、`bypassPermissions` だけが承認を飛ばす。無人の実行ではここで止まる。

### branch を作らせない

**Issue に紐付く branch は、worktree より先に、Issue のワークフロー（`gh issue develop` など）で作る。**

`EnterWorktree` の `name` や `git worktree add -b` に作らせると、branch の名前がその仕組みの命名の規則
（`worktree-<名前>`）になり、Issue との紐付けが失われる。
`name` のデフォルトの base が `origin/<デフォルト branch>` であることも、意図した base とは違う所から、警告なしに branch を分ける原因になる。

正しい順序は次のとおりである。

```bash
# 1. branch は Issue のワークフローが作る（このスキルの担当外）
#    `--checkout` 無しの `gh issue develop` はリモート側にしか branch を作らないので、
#    呼び出し側は fetch してローカル ref まで起こしてから渡す（`enter` の前提）
gh issue develop <番号> --name "feature/<番号>-<説明>" --base main
git fetch --quiet origin "+refs/heads/feature/<番号>-<説明>:refs/remotes/origin/feature/<番号>-<説明>"
git branch "feature/<番号>-<説明>" FETCH_HEAD

# 2. 既存 branch に worktree を張る（-b を付けない）
git worktree add "<worktree パス>" "feature/<番号>-<説明>"

# 3. セッションをそこへ移す（EnterWorktree に path を渡す）
```

その後、移ったことを実際に確かめる。

```bash
git rev-parse --show-toplevel   # worktree のパスであること
git branch --show-current       # 渡した branch であること
```

この順序は、文書に書くだけでは守られない。同梱の branch guard hook を設定すると、branch を作る呼び出し
（`EnterWorktree` の `name`、`git worktree add -b`、commit-ish の無い `git worktree add`）を
PreToolUse で捕まえて通知する（[branch-guard-hook.md](branch-guard-hook.md)）。

#### 作らせてしまった後の回復

**回復できるのは、commit しておらず、作られた branch がベースと同じコミットを指している間だけである。**
`gh issue develop` が作る branch はベースの先端を指すので、commit した後では使えない。
その場合は commit を移すかの判断が要るので、呼び出し側か利用者に返す。

1. リモートに同じ名前の branch が無いことを確かめる。remote-tracking ref は fetch しないと古いままなので、
   `git ls-remote --exit-code --heads origin '<名前>'` でリモートに直接問い合わせる（終了コード 2 は「無い」）。
   紐付けの対象はリポジトリ側に在る ref なので、ローカルにしか無い branch は対象にならない。
2. ローカルの branch の名前が違っていれば、`git branch -m <正しい名前>` で名前を変える。
3. `gh issue develop <番号> --name <同じ名前> --base <同じベース>` を実行する。
   `--checkout` を付けないので、ローカルの ref は増えない（作られるのはリモート側の branch だけ）。
4. `git fetch origin '<名前>'` を実行してから、ローカルとリモート（`FETCH_HEAD`）が同じコミットであることと、
   `linkedBranches` に載ったことを確かめる。

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){ # pagination-ok（作った 1 本が載ったかの確認）
  repository(owner:$o,name:$r){
    issue(number:$n){ linkedBranches(first:10){ nodes { ref { name } } } } } }' \
  -F o=<owner> -F r=<repo> -F n=<番号>
```

### 入れ子と再入場

- 既に worktree にいる状態でも、`path` で別の worktree へ移れる。移る前の worktree は、ディスクにそのまま残る（片付けの対象として自分で把握しておく）。
- 起動したときに作業ディレクトリが固定された subagent（`isolation: "worktree"` や、cwd を明示したもの）からも `path` で移れる。影響はその subagent の中だけである。
- **ただし、この 2 つの場合（worktree にいる状態からの移動と、固定された subagent からの移動）では、移る先が
  「同じリポジトリの `.claude/worktrees/` の下」に限られる**（`EnterWorktree` のツールの定義の本文）。
  リポジトリの外（`$(mktemp -d)` の下など）に置いた worktree には、起動したディレクトリからの最初の 1 回しか入れない。
  worktree を行き来する使い方（Issue ごとに worktree を切り替えるバッチなど）では、この制約のため、worktree をリポジトリの中に置く必要がある。
- worktree のセッションにいる間は、`name` で新しく作ることはできない（`path` での移動だけができる）。
- さらに別の worktree へ移ると、前にいた worktree には書き込めなくなる。戻るには、`path` で入り直す。

### lock

`name` で作った、または再開した worktree には、`git worktree lock --reason "claude session <名前> (pid …)"` が掛かる。
`path` で入った worktree には掛からない。実装を読むと、lock を呼ぶ箇所は worktree を作る処理の 2 か所だけだった。
subagent の worktree にも実行中は lock が掛かり、終わると外れる。
`git worktree remove` が lock を理由に失敗したら、確かめずに `--force` を付けない。lock の理由を読み、
他のセッションが使っていないことを確かめてから、`git worktree unlock` を実行する。
