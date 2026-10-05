---
name: git-worktree
description: git worktree による作業隔離の機構を担うスキル。渡された branch に worktree を用意してセッションをそこへ移し、`.gitignore` 対象ファイルの運搬、検査ツールからの除外、clean 確認付きの後片付けまでを標準化する。「絶対パスで cd すれば隔離できる」は subagent・fork・background Bash が起動時の作業ディレクトリを継承するため成立しない。branch の作成と Issue との紐付けは行わず呼び出し側（issue-start / issue-batch 等）に委ねる。「worktree で作業して」「worktree を作って」「隔離して作業して」「git-worktree」や `setup` / `enter` / `cleanup` を伴う依頼で発動する。
argument-hint: "<setup | enter <branch> | cleanup [<worktree パス>]>"
license: MIT
---

# Git Worktree

worktree は、ディレクトリを作っただけでは隔離にならない。セッションをそこへ移したときに隔離が成り立つ。
このスキルは worktree の仕組みだけを担い、隔離の前提が成り立たなくなる箇所を 1 か所にまとめる。

## 使い方

```text
git-worktree setup
git-worktree enter <branch>
git-worktree cleanup [<worktree パス>]
```

- `setup`: 置き場所を決め、チェックからの除外と、ファイルを運ぶ方法を整える。worktree は作らない
- `enter`: 既に在る branch に worktree を用意し、セッションをそこへ移す
- `cleanup`: clean であることを確かめてから、解除して削除する

自然文でも発動する（「worktree で作業して」「隔離した作業ツリーで進めて」）。

置き場所とファイルを運ぶ方法は、`setup` で決めた内容に従う。`enter` で個別に切り替えない。
切り替えたいときは `setup` をやり直す。判断が分かれると、[除外の抜け](references/scanner-exclusions.md)が出る。

## 前提

- ツール: `git` 2.23 以上。下の手順が使うコマンドが入った版は、`git worktree list --porcelain` が 2.7、
  `git worktree remove` が 2.17、`git branch --show-current` が 2.22、`git switch` が 2.23 である。2.5 では揃わない。
  加えて、エージェント側にセッションを移す機能（Claude Code の `EnterWorktree` など）が要る
- 前提スキル: なし
- シェル: bash。Windows では WSL や Git Bash などを使う

セッションを移す機能が無いエージェントでは、隔離は成り立たない。`git worktree add` だけを実行して
「隔離した」と報告せず、その旨を述べて停止する（理由は [`references/isolation.md`](references/isolation.md)）。

`references/` を読めない場合は、推測で代わりの方法を取らずに停止する。下の「破ってはいけない前提」は
どれも根拠が reference 側にあり、要約だけでは正しく判断できない。

## 責務の境界

| 担当する | 担当しない |
| --- | --- |
| 渡された branch への worktree 作成 | branch の作成・命名 |
| セッションの移動と、移動したことの確認 | Issue と branch の紐付け（Issue のワークフローの責務） |
| `.gitignore` 対象ファイルの運搬 | どの branch で何を実装するか（呼び出し側の責務） |
| 検査ツールからの除外 | 実装・レビュー・commit・PR |
| clean 確認付きの後片付け | |

**branch は渡してもらい、自分では作らない。**
worktree を作る手段（`git worktree add -b` や `EnterWorktree` の `name`）に branch を作らせると、
`worktree-<名前>` のような別の名前になる。その結果、Issue との紐付けが失われる
（[`references/isolation.md`](references/isolation.md) の「branch を作らせない」）。
呼び出し側が branch を用意していなければ、worktree を作らずにその旨を述べて停止する。
停止したときに「このスキルを使わず私が直接 branch を作りましょうか」のような、スキルの外の代わりの方法を提案しない。
必要な branch の名前と、それを作る手順（Issue のワークフロー）を示して、呼び出し側へ返す。

この規律は、文書に書くだけでは守られない。このスキルを呼ばずに worktree を作れば、指示は読まれないからである。
そこで `setup` で設定する branch guard hook が、branch を作るコマンドを PreToolUse で捕まえて通知する
（[`references/branch-guard-hook.md`](references/branch-guard-hook.md)）。

## モード

### setup

置き場所とファイルを運ぶ方法を決め、リポジトリの設定に反映する。詳細は
[`references/scanner-exclusions.md`](references/scanner-exclusions.md) と
[`references/carry-in.md`](references/carry-in.md) にある。

1. 置き場所を決める。この判断が後の手順を決めるので、最初に確定する（判断の材料は下の表）。
2. 置き場所がリポジトリの中なら、worktree のディレクトリをすべてのチェックから除外する。`.gitignore` の 1 か所では足りない。
3. `.gitignore` の対象のうち worktree で要るファイル（`.env`・受領物・ベンダーの配布物）を挙げ、運ぶ方法を選ぶ。
4. 決めた内容を設定ファイル（`.config/skills/shoji9x9/skills.yml` など。リポジトリの慣行に従う）に記録する。
   エージェントが自分の設定ファイルを書けない場合は、一時ファイルに書き出して、利用者に適用を依頼する。
5. 同梱の branch guard hook（`scripts/git-worktree-branch-guard.sh`）を、各エージェントの PreToolUse に設定する。
   手順は [`references/branch-guard-hook.md`](references/branch-guard-hook.md) にある。
   上の「責務の境界」の「branch は渡してもらう」を、文書の指示だけにせず仕組みで守らせる部分である。hook は止めずに通知だけする。

| 置き場所 | 利点 | 代償 |
| --- | --- | --- |
| リポジトリの中（`.claude/worktrees/<名前>` など） | 新しく作るときは、ファイルが自動で運ばれる。セッションの移動に承認が要らない | すべてのチェックに除外が要る。除外を忘れると、共有ツリー側のチェックが失敗する |
| リポジトリの外（`$(mktemp -d)` の下など） | 除外がまったく要らない | ファイルは手で運ぶ。セッションを移すたびに利用者の承認が要るので、無人の実行では止まる。入れるのは起動したディレクトリからの 1 回だけで、worktree の間は移れない（[`references/isolation.md`](references/isolation.md)「入れ子と再入場」） |

### enter

1. 渡された branch が在ることを確かめる（`git rev-parse --verify --quiet refs/heads/<branch>`）。無ければ作らずに停止する。
2. 同じ branch を checkout している worktree が既に無いかを、`git worktree list --porcelain` で確かめる。
   一覧の先頭はメインチェックアウト（共有ツリー）である。そこを「既存の worktree」として使い回すと、隔離にならない。
   使い回してよいのは、メインチェックアウト以外の項目だけである。
   メインチェックアウトがその branch を checkout している場合（`gh issue develop --checkout` の直後がこれに当たる）、
   `git worktree add` は `fatal: '<branch>' is already used by worktree at ...` で失敗する。
   共有ツリーを base branch に戻して（`git switch <base branch>`）から作り直す。
   戻してよいか判断できなければ、呼び出し側へ返して停止する。
3. worktree を用意する。branch を作らせない形で呼ぶ（[`references/isolation.md`](references/isolation.md)）。
4. セッションをその worktree へ移す。移るまでは隔離されていない。
5. 移ったことを、`git rev-parse --show-toplevel` と `git branch --show-current` が期待どおりの値を返すことで確かめる。
6. 運ぶ必要があるファイルを、[`references/carry-in.md`](references/carry-in.md) に従って揃える。
   エージェントがファイルを自動で運ぶのは新しく作るときだけなので、既存の worktree に入った場合は手で運ぶ。
7. 運んだファイルがチェックの対象に入っていないことを確かめる（`.env` の本物の資格情報が、シークレットのスキャンで検出される）。
8. パスで信頼や承認を判定するツール（mise の trust など）で、信頼の設定を通す。worktree は新しいパスなので、
   共有ツリーで通した信頼は引き継がれない（`mise ERROR ... are not trusted` で `node -e` も失敗する）。
9. ツールが動くことを確かめる。入った直後に検証のコマンドを 1 つ実行し（lint か test を 1 つなど）、
   通ることを確かめてから作業に進む。運び忘れや信頼の不備は、作業を進めた後で「どのツールも動かない」という形で現れる。

### cleanup

[`references/cleanup.md`](references/cleanup.md) の規律に従う。要点は次のとおりである。

1. worktree が clean であることを確かめる。dirty なら削除せず、絶対パスと残りの作業を報告する。
2. セッションがその worktree の中にいるなら、先に出る（`ExitWorktree` の `action: "keep"`）。
   中にいるまま解除すると、解除は成功し、自分の作業ディレクトリごと消える。
3. `git worktree remove` で解除する。
4. `git worktree list` をもう一度実行して、解除されたことを確かめる。
5. 名前が完全一致した ref だけを削除する。glob は使わない。
   squash merge や rebase merge された branch は `git branch -d` が拒否するので、PR が MERGED であることを確かめてから削除する。
6. どれかが失敗したら止め、何が残ったかを報告する。

## 破ってはいけない前提

次の挙動は実際に確かめたもので、知らないと、隔離したつもりで隔離されていない状態になる。根拠と再現の手順は各 reference にある。

- worktree を作るだけでは隔離にならない。subagent・フォークして動くスキル・バックグラウンドの Bash は、起動したときの作業ディレクトリを引き継ぐ。
  ツールの呼び出しを `cd <絶対パス> && ...` の形で書いても、そこから起動したものは共有ツリーで動く（[`references/isolation.md`](references/isolation.md)）
- 逆に、セッションを移せば、ハーネスが subagent まで含めて隔離する。隔離の実体は「入る」ことで、代わりになる書き方は無い（[`references/isolation.md`](references/isolation.md)）
- hook のパスは worktree に合わせて変わらない。`${CLAUDE_PROJECT_DIR}` は起動したときのプロジェクトのルートを指したままで、
  hook はメインチェックアウト側のスクリプトを実行する（[`references/isolation.md`](references/isolation.md)）
- `.gitignore` の対象のファイルは、checkout では入らない。明示的に運ぶ必要があり、自動で運ばれるのは新しく作るときだけである（[`references/carry-in.md`](references/carry-in.md)）
- 共有ツリーへのシンボリックリンクは読み取り専用ではない。リンク越しに実体を書き換えたり消したりできる。
  `rm` を見るガードでは、`sed -i` を止められない（[`references/carry-in.md`](references/carry-in.md)）
- 除外は 1 か所では足りない。`.gitignore` を読まないチェックがあるので、同じ除外をすべてのチェックに入れる（[`references/scanner-exclusions.md`](references/scanner-exclusions.md)）
- 削除は名前が完全一致したものだけにする。glob で worktree や branch を削除しない（[`references/cleanup.md`](references/cleanup.md)）

## 呼び出し側からの利用

`issue-start`・`issue-batch`・レビュー系の流れは、worktree の仕組みをこのスキルに任せる。
呼び出し側は branch を用意し、`git-worktree enter <branch>` と同じ取り決めで入り、
作業の後は `git-worktree cleanup` と同じ取り決めで片付ける。
上の前提を呼び出し側に書き写さない。
