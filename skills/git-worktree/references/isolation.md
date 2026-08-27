# 隔離が成立する条件

## 作るだけでは隔離にならない

`git worktree add <パス> <branch>` が作るのはディレクトリだけで、**エージェントのセッションは元のまま**動き続ける。

「ツール呼び出しを `cd <絶対パス> && ...` で書けば大丈夫」は成立しない。
そこから起動するもの——**subagent・フォークして走るスキル・バックグラウンドの Bash**——は
**すべて起動時の作業ディレクトリを継承する**ため、共有ツリーで動く。

破れ方は、作った後に何もしなければそのまま再現する。

1. `git worktree add <パス> -b <branch>` で worktree を作る
2. 以後のツール呼び出しを `cd <絶対パス> && ...` で書く
3. そこから subagent・フォークして走るスキル・バックグラウンドの Bash を起動する
4. それらは共有ツリーで動く

隔離のために作った worktree から起動したレビューが、**共有の作業ツリーをレビューして
5 ファイルを書き換え、未追跡ファイルを復元経路なく削除した**実例がある。
当の branch の変更は 1 件もレビューされていない（レビューしたつもりで未レビュー）。

**したがって: セッションを移す機能が無いなら、worktree で隔離できたと report しない。**

## セッションを移す（Claude Code の場合）

Claude Code には `EnterWorktree` / `ExitWorktree` があり、セッションの作業ディレクトリごと移る。
入った後はハーネスが worktree の外へ出かねない git 操作を拒否する。

以下は公式ドキュメント（[Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees)）と、
2.1.243 の実装・`EnterWorktree` のツール定義本文を突き合わせて確認した。バージョンが変わったら読み直す。

## 入った後はハーネスが強制する

セッションが worktree に隔離されている間、Claude Code は次の 4 つを**ツールエラーとして拒否する**。
**この強制は、そのセッションが起動する subagent にも同じように及ぶ**（公式ドキュメント「How Claude Code enforces isolation」）。

| 検査 | 拒否されるもの |
| --- | --- |
| ファイル編集 | メインチェックアウト内のパスを対象にする `Edit` / `Write` / `NotebookEdit` |
| コマンドの作業ディレクトリ | 作業ディレクトリがメインチェックアウトに解決する（または外に留まると検証できない）Bash / PowerShell / Monitor |
| git のリダイレクト | `git -C` / `--git-dir` / `GIT_DIR` / `GIT_WORK_TREE` / 事前の `cd` でメインチェックアウトへ向ける git |
| コマンドの形 | worktree 内に留まると検証できないコマンド。**ブレース展開・区切りを引用しないヒアドキュメント**は git を含まなくても拒否される |

**つまり「入る」ことが隔離の実体である。** 入らなければ強制は 1 つも効かず、入れば subagent まで守られる。
最後の行のため、worktree 内ではブレース展開とヒアドキュメントを避け、素の分割したコマンドで書く。

## Hook のパスは worktree に追従しない

worktree に入っても、hook の `${CLAUDE_PROJECT_DIR}` は**セッションを起動したプロジェクトルートを指したまま**になる。
`${CLAUDE_PROJECT_DIR}/.claude/hooks/check.sh` のような hook は**メインチェックアウト側のスクリプトを実行する**。
worktree のパスが要る hook は、入力 JSON の `cwd` フィールドを読む（そちらは worktree ルートを指し、`cd` にも追従する）。

隔離を前提にした検査を hook で行っているなら、この点を確かめてから「worktree 内だけを検査した」と判断する。

### `path` と `name` の違い

| 引数 | 作るもの | branch | 置き場所 | 自動運搬（[carry-in.md](carry-in.md)） |
| --- | --- | --- | --- | --- |
| `path` | 既存 worktree に入るだけ | 触らない | 呼び出し側が選ぶ | **走らない** |
| `name` | 新規 worktree | **新規作成**（`worktree-<名前>`） | `.claude/worktrees/` 固定 | 走る |

- `path` は `git worktree list` に載っている worktree でなければ拒否される。
- `path` で入った worktree は `ExitWorktree` では**削除されない**（`action: "keep"` で元のディレクトリへ戻る）。後片付けは [cleanup.md](cleanup.md) の手順で自分で行う。
- `name` は `/` を `+` に置換したうえで、**ディレクトリ**を `.claude/worktrees/<置換後>`、**branch** を `worktree-<置換後>` として作る。
- `name` の base ref は `worktree.baseRef` 設定に従う（既定 `fresh`＝リモートのデフォルト branch、`head`＝現在のローカル HEAD）。branch 名は指定できない。
- **既存の名前を再利用すると、条件次第で既定 branch へリセットされる**（`fresh` かつ、未 commit の変更・未追跡ファイルが無く、作成時の branch のままで、独自 commit が無いか PR が merge 済みの場合）。「前回の続きから始まる」と決めてかからない。
- **`.claude/worktrees/` の外のパスへ入るときは、毎回ユーザーの承認が要る**（`EnterWorktree` の permission rule や「今後確認しない」では抑止できず、`bypassPermissions` だけが飛ばす）。無人実行では詰まる。

### branch を作らせない

**Issue に紐づく branch は、worktree より先に Issue のワークフロー（`gh issue develop` 等）で作る。**

`EnterWorktree` の `name` や `git worktree add -b` に作らせると、branch 名がその機構の命名規則
（`worktree-<名前>`）になり、**Issue との紐付けが失われる**。
`name` の既定 base が `origin/<デフォルト branch>` である点も、意図した base からの分岐を静かに変える。

正しい順序:

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

その後、移動が成立したことを実測で確かめる。

```bash
git rev-parse --show-toplevel   # worktree のパスであること
git branch --show-current       # 渡した branch であること
```

この順序は散文だけでは守られない。同梱の branch guard hook を配線すると、branch を作る経路
（`EnterWorktree` の `name`、`git worktree add -b`、および commit-ish の無い `git worktree add`）を
PreToolUse で捕捉して通知する（[branch-guard-hook.md](branch-guard-hook.md)）。

#### 作らせてしまった後の回復

**未 commit で、作られた branch がベースと同一コミットの間だけ回復できる。**
`gh issue develop` が作る branch はベースの先端を指すため、commit 済みの場合は使えない
（その場合は commit を移す判断が要るので、呼び出し側／ユーザーへ返す）。

1. リモートに同名 branch が無いことを確かめる。**remote-tracking ref は fetch しないと古いまま**なので、
   `git ls-remote --exit-code --heads origin '<名前>'` でリモートへ直接問い合わせる（終了コード 2 ＝ 無い）。
   紐付けの対象はリポジトリ側に存在する ref なので、ローカルにしか無い branch は対象になり得ない。
2. ローカルの branch 名が違っていれば `git branch -m <正しい名前>` で改名する。
3. `gh issue develop <番号> --name <同じ名前> --base <同じベース>` を実行する。
   `--checkout` を付けないので**ローカル ref は増えない**（作られるのはリモート側の branch だけ）。
4. `git fetch origin '<名前>'` してから、ローカルとリモート（`FETCH_HEAD`）が同一コミットであることと、
   `linkedBranches` に載ったことを確認する。

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){ # pagination-ok（作った 1 本が載ったかの確認）
  repository(owner:$o,name:$r){
    issue(number:$n){ linkedBranches(first:10){ nodes { ref { name } } } } } }' \
  -F o=<owner> -F r=<repo> -F n=<番号>
```

### 入れ子と再入場

- 既に worktree にいる状態でも `path` で別の worktree へ移れる。移る前の worktree は**ディスク上にそのまま残る**（片付けの対象として自分で追跡する）。
- 作業ディレクトリを起動時に固定された subagent（`isolation: "worktree"` や明示 cwd）からも `path` で移れ、影響はその subagent だけに閉じる。
- **ただし、この 2 つの経路（worktree にいる状態からの移動・固定された subagent からの移動）では、移動先が
  「同一リポジトリの `.claude/worktrees/` 配下」に限られる**（`EnterWorktree` のツール定義本文）。
  リポジトリ外（`$(mktemp -d)` 配下等）に置いた worktree へは、**起動ディレクトリからの最初の 1 回しか入れない**。
  worktree を渡り歩く使い方（Issue ごとに worktree を切り替えるバッチ等）は、この制約から**リポジトリ内に置く**必要がある。
- `name` での新規作成は、既に worktree セッションにいる間は受け付けられない（`path` での移動だけが可能）。
- さらに別の worktree へ移ると、**以前に居た worktree は書き込めなくなる**。戻るには `path` で入り直す。

### lock

`name` で作成／再開した worktree には `git worktree lock --reason "claude session <名前> (pid …)"` が掛かる
（`path` で入った worktree には掛からない。実測: lock 呼び出し箇所は作成経路の 2 か所だけ）。
subagent の worktree にも実行中は lock が掛かり、終了時に解放される。
`git worktree remove` が lock を理由に失敗したら、**`--force` を反射的に付けず** lock の理由を読み、
他セッションが使っていないことを確かめてから `git worktree unlock` する。
