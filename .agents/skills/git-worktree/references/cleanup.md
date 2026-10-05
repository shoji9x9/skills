# 後片付けの規律

worktree の削除は、間違えると元に戻せない。未追跡のファイルや、push していない commit を含むからである。
「clean を確かめてから解除し、解除されたことをもう一度確かめてから、名前が完全一致した ref だけを削除する」という順序を守る。

## 手順

### 1. clean を確認する

```bash
git -C "<worktree パス>" --no-optional-locks status --porcelain
```

出力が空でなければ、削除しない。絶対パスと残りの作業を報告して止める。
push していない commit も確かめる。

```bash
git -C "<worktree パス>" rev-list --max-count=1 HEAD --not --remotes
```

出力があれば、push していない commit が残っている。削除しない。

### 2. 削除する対象が期待と完全一致することを確かめ直す

`git worktree list --porcelain` をもう一度実行し、
そのパスがその branch を checkout していることを確かめる。
記憶や、前の手順の出力を根拠にしない。

branch を削除する場合は、それがデフォルトの branch でも保護された branch でもないことと、
期待する名前の形（`feature/<Issue番号>-` など）であることまで確かめる。

### 3. 解除する

**セッションがその worktree の中にいるなら、先に出る。** Claude Code なら `ExitWorktree` の `action: "keep"` を使う。
`path` で入った worktree は `remove` を選んでも消えないので、解除は下のコマンドで行う。
中にいるまま解除しても、`git worktree remove` は成功する（実測で終了コード 0）。
自分の作業ディレクトリごと消えるので、その後のコマンドが `getcwd: cannot access parent directories` で失敗する。

```bash
git worktree remove "<worktree パス>"
```

lock が理由で失敗しても、確かめずに `--force` を付けない。
[lock の理由](isolation.md)を読み、他のセッションが使っていないことを確かめてから、
`git worktree unlock "<worktree パス>"` を実行してやり直す。

`--force` は「clean を確かめた」という前提を捨てる操作なので、利用者が明示的に許可した場合だけ使う。
公式のドキュメントは、commit していない変更がある worktree の削除に `--force` を案内している。
それは消してよいと判断した後の手順で、判断を省く手段ではない
（[Clean up worktrees](https://code.claude.com/docs/en/worktrees#clean-up-worktrees)）。

非対話の実行（`-p`）で作られた worktree は自動では片付かず、作ったときの lock も残る。
自分が作ったのではない worktree は、この手順の対象にする前に、呼び出し側か利用者に確認する。

### 4. 解除されたことをもう一度確かめる

```bash
git worktree list --porcelain
```

もう一度実行して、対象が消えていることを確かめる。`git worktree remove` の終了コードだけを根拠にしない。
`git worktree prune` は、ディレクトリを手で消した後に登録の情報を掃除するもので、解除の代わりにはならない。

### 5. ref を削除する（完全一致だけ）

local、remote の順に、名前が完全一致した ref だけを削除する。

```bash
git branch -d "<branch>"
git push origin --delete "<branch>"
```

`git branch -d` は、squash merge や rebase merge された branch を拒否する。
実測では `error: the branch '<branch>' is not fully merged` が出て、終了コードは 1 だった。
squash は merge commit を作らないので、`git branch --merged` にも現れない。
**これを理由に、確かめずに `-D` を付けない。**
マージ済みかどうかは、git で到達できるかではなく、PR の実際の状態で確かめる。確かめられたときだけ `-D` を使う。

```bash
gh pr view "<PR URL | 番号>" --json state,mergedAt,headRefName
```

`state` が `MERGED` で、`headRefName` が削除する branch と完全一致した場合だけ、`git branch -D "<branch>"` に進む。
一致しない場合や確かめられない場合は削除せず、branch を残して報告する。

**glob は使わない。** `feature/223-*` のようなパターンで削除しない。
`gh pr merge --delete-branch` のように「ついでに消す」方法も使わない。消す対象を自分で確かめていないからである。

### 6. 失敗したら止める

解除か削除のどちらかが失敗したら、続きに進まず、何が残ったかを報告する。
途中まで消えた状態を「片付いた」と報告しない。

## 削除しないケース

| 状況 | 扱い |
| --- | --- |
| dirty（commit していない変更や、未追跡のファイルがある） | 削除しない。絶対パスと残りの作業を報告する |
| push していない commit がある | 削除しない。push 先を確かめてから判断する |
| 作業が BLOCKED / FAILED で終わった | 削除しない。再開できる状態のまま残す |
| そのセッションが作ったのではない worktree | 削除しない。呼び出し側か利用者に確認する |
