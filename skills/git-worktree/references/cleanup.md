# 後片付けの規律

worktree の削除は、**間違えると復元できない**（未追跡ファイル・未 push の commit を含むため）。
「clean を確かめてから解除し、解除済みを再確認してから完全一致した ref だけを削除する」という順序を守る。

## 手順

### 1. clean を確認する

```bash
git -C "<worktree パス>" --no-optional-locks status --porcelain
```

出力が空でなければ**削除しない**。絶対パスと残作業を報告して止める。
未 push の commit も確認する。

```bash
git -C "<worktree パス>" rev-list --max-count=1 HEAD --not --remotes
```

出力があれば未 push の commit が残っている。削除しない。

### 2. 削除対象が期待と完全一致することを再検証する

`git worktree list --porcelain` を取り直し、
**そのパスがその branch を checkout している**ことを確かめる。
記憶や前段の出力を根拠にしない。

branch を削除する場合は、それがデフォルト branch でも保護対象 branch でもないこと、
期待する命名（`feature/<Issue番号>-` 等）を持つことまで確認する。

### 3. 解除する

**セッションがその worktree の中にいるなら、先に出る**（Claude Code なら `ExitWorktree` の `action: "keep"`。
`path` で入った worktree は `remove` を選んでも消えないので、解除は下のコマンドで行う）。
中にいるまま解除しても `git worktree remove` は**成功し**（実測: 終了コード 0）、
自分の作業ディレクトリごと消えるため、以後のコマンドが `getcwd: cannot access parent directories` で失敗する。

```bash
git worktree remove "<worktree パス>"
```

lock を理由に失敗したら、**`--force` を反射的に付けない**。
[lock の理由](isolation.md)を読み、他のセッションが使っていないことを確かめてから
`git worktree unlock "<worktree パス>"` して再試行する。

`--force` は「clean を確認した」という前提を捨てる操作なので、
ユーザーが明示的に許可した場合以外は使わない
（公式ドキュメントは未 commit の変更がある worktree の削除に `--force` を案内するが、
それは**消してよいと判断済み**の場合の手順であって、判断を省く手段ではない。
[Clean up worktrees](https://code.claude.com/docs/en/worktrees#clean-up-worktrees)）。

非対話実行（`-p`）で作られた worktree は自動で片付かず、作成時の lock も残る。
自分が起点でない worktree は、この手順の対象にする前に呼び出し側・ユーザーへ確認する。

### 4. 解除済みを再確認する

```bash
git worktree list --porcelain
```

**取り直して**、対象が消えていることを確認する。`git worktree remove` の終了コードだけを根拠にしない。
（`git worktree prune` は、ディレクトリを手で消した後の登録情報の掃除であって、解除の代わりにならない。）

### 5. ref を削除する（完全一致だけ）

local → remote の順に、**完全一致した ref だけ**を削除する。

```bash
git branch -d "<branch>"
git push origin --delete "<branch>"
```

`git branch -d` は **squash merge / rebase merge された branch を拒否する**
（実測: `error: the branch '<branch>' is not fully merged`・終了コード 1。squash は merge commit を作らないため
`git branch --merged` にも現れない）。**これを理由に `-D` を反射的に付けない。**
マージ済みかどうかは git の到達可能性ではなく **PR の実状態**で確かめ、確かめられたときだけ `-D` を使う。

```bash
gh pr view "<PR URL | 番号>" --json state,mergedAt,headRefName
```

`state` が `MERGED`、`headRefName` が削除対象 branch と**完全一致**した場合だけ `git branch -D "<branch>"` へ進む。
一致しない・確認できない場合は削除せず、branch を残して報告する。

**glob は使わない。** `feature/223-*` のようなパターンでの削除も、
`gh pr merge --delete-branch` のような「ついでに消す」経路も使わない
（消す対象を自分で確認していないため）。

### 6. 失敗したら止める

解除・削除のいずれかが失敗したら、続きを進めずに**何が残ったか**を報告する。
中途半端に消えた状態を「片付いた」と report しない。

## 削除しないケース

| 状況 | 扱い |
| --- | --- |
| dirty（未 commit の変更・未追跡ファイルがある） | 削除しない。絶対パスと残作業を報告する |
| 未 push の commit がある | 削除しない。push 先を確認してから判断する |
| 作業が BLOCKED / FAILED で終わった | 削除しない。再開できる状態のまま残す |
| そのセッションが作ったのではない worktree | 削除しない。呼び出し側・ユーザーに確認する |
