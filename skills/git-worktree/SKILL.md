---
name: git-worktree
description: git worktree による作業隔離の機構を担うスキル。渡された branch に worktree を用意してセッションをそこへ移し、`.gitignore` 対象ファイルの運搬、検査ツールからの除外、clean 確認付きの後片付けまでを標準化する。「絶対パスで cd すれば隔離できる」は subagent・fork・background Bash が起動時の作業ディレクトリを継承するため成立しない。branch の作成と Issue との紐付けは行わず呼び出し側（issue-start / issue-batch 等）に委ねる。「worktree で作業して」「worktree を作って」「隔離して作業して」「git-worktree」や `setup` / `enter` / `cleanup` を伴う依頼で発動する。
argument-hint: "<setup | enter <branch> | cleanup [<worktree パス>]>"
license: MIT
---

# Git Worktree

worktree は**ディレクトリを作ることではなく、セッションを移すこと**で成立する。
このスキルは worktree の機構だけを担い、隔離の前提が破れる箇所を 1 か所に集約する。

## 使い方

```text
git-worktree setup
git-worktree enter <branch>
git-worktree cleanup [<worktree パス>]
```

- `setup`: 置き場所を決め、検査からの除外と運搬経路を整える。worktree は作らない
- `enter`: **既に存在する branch** に worktree を用意し、セッションをそこへ移す
- `cleanup`: clean を確認してから解除・削除する

自然文でも発動する:「worktree で作業して」「隔離した作業ツリーで進めて」。

置き場所・運搬経路は `setup` で決めた内容に従う。`enter` で個別に切り替えない
（切り替えたいときは `setup` をやり直す。判断が分散すると[除外漏れ](references/scanner-exclusions.md)になる）。

## 前提

- **ツール**: `git` **2.23+**（下の手順が使うコマンドの追加時期は
  `git worktree list --porcelain` が 2.7、`git worktree remove` が 2.17、`git branch --show-current` が 2.22、
  `git switch` が 2.23。2.5 では揃わない）。
  エージェント側にセッションを移す機能（Claude Code の `EnterWorktree` 等）
- **前提スキル**: なし
- **シェル**: bash。Windows では WSL / Git Bash 等を使う

セッションを移す機能が無いエージェントでは**隔離は成立しない**。`git worktree add` だけを行って
「隔離した」と報告せず、その旨を述べて停止する（理由は [`references/isolation.md`](references/isolation.md)）。

**`references/` を読めない場合は、推測で代替せず停止する。** 下の「破ってはいけない前提」はいずれも
根拠が reference 側にあり、要約だけで正しく判断できるようには書かれていない。

## 責務の境界

| 担当する | 担当しない |
| --- | --- |
| 渡された branch への worktree 作成 | branch の作成・命名 |
| セッションの移動と、移動が成立したことの確認 | Issue と branch の紐付け（Issue のワークフローの責務） |
| `.gitignore` 対象ファイルの運搬 | どの branch で何を実装するか（呼び出し側の責務） |
| 検査ツールからの除外 | 実装・レビュー・commit・PR |
| clean 確認付きの後片付け | |

**branch は渡してもらう。自分で作らない。**
worktree の作成手段（`git worktree add -b` / `EnterWorktree` の `name`）に branch を作らせると
`worktree-<名前>` のような別名になり、Issue との紐付けが失われる（[`references/isolation.md`](references/isolation.md) の「branch を作らせない」）。
呼び出し側が branch を用意していなければ、worktree を作らずその旨を述べて停止する。
停止したときに「このスキルを使わず私が直接 branch を作りましょうか」と**スキル外の代替を提案しない**。
必要な branch の名前と、それを作る手順（Issue のワークフロー）を示して呼び出し側へ返す。

この規律は散文だけでは守られない（このスキルを呼ばずに worktree を作れば、指示は読まれない）。
`setup` が配線する branch guard hook が、branch を作る経路を PreToolUse で捕捉して通知する
（[`references/branch-guard-hook.md`](references/branch-guard-hook.md)）。

## モード

### setup

置き場所と運搬経路を決め、リポジトリ設定へ反映する。詳細は
[`references/scanner-exclusions.md`](references/scanner-exclusions.md) と
[`references/carry-in.md`](references/carry-in.md) を参照する。

1. 置き場所を決める。**この判断が後続を縛る**ため最初に確定する（判断材料は下表）。
2. 置き場所がリポジトリ内なら、worktree ディレクトリを**全ての検査から除外する**。`.gitignore` 1 か所では足りない。
3. `.gitignore` 対象で worktree に必要なファイル（`.env`・受領物・ベンダー配布物）を列挙し、運搬経路を選ぶ。
4. 決めた内容を設定ファイル（`.config/skills/shoji9x9/skills.yml` 等、リポジトリの慣行に従う）へ記録する。エージェントが自身の設定ファイルを書けない場合は一時ファイルに出してユーザーへ適用を依頼する。
5. 同梱の branch guard hook（`scripts/git-worktree-branch-guard.sh`）を各エージェントの PreToolUse へ配線する。手順は [`references/branch-guard-hook.md`](references/branch-guard-hook.md) を参照する。上の「責務の境界」の「branch は渡してもらう」を散文の指示のままにせず機構で守らせる部分で、**ブロックはせず通知だけ**する。

| 置き場所 | 利点 | 代償 |
| --- | --- | --- |
| リポジトリ内（`.claude/worktrees/<名前>` 等） | 運搬経路が自動で走る（新規作成時）。セッション移動に承認が要らない | **全検査に除外が要る**。除外漏れは共有ツリー側の検査を落とす |
| リポジトリ外（`$(mktemp -d)` 配下等） | 除外が一切不要 | 運搬は手動。**セッションを移すたびユーザー承認が要る**（無人実行では詰まる）。**入れるのは起動ディレクトリからの 1 回だけ**で、worktree 間の移動はできない（[`references/isolation.md`](references/isolation.md)「入れ子と再入場」） |

### enter

1. 渡された branch が**存在すること**を確認する（`git rev-parse --verify --quiet refs/heads/<branch>`）。存在しなければ作らずに停止する。
2. 同じ branch を checkout 済みの worktree が既にないか `git worktree list --porcelain` で確認する。
   **一覧の先頭はメインチェックアウト**（共有ツリー）であり、そこを「既存 worktree」として再利用すると隔離にならない。再利用してよいのは**メインチェックアウト以外**のエントリだけ。
   メインチェックアウトがその branch を checkout している場合（`gh issue develop --checkout` の直後がこれ）、`git worktree add` は
   `fatal: '<branch>' is already used by worktree at ...` で失敗する。共有ツリーを base branch へ戻して（`git switch <base branch>`）から張り直すか、
   戻してよいか判断できなければ呼び出し側へ返して停止する。
3. worktree を用意する。**branch を作らせない形**で呼ぶ（[`references/isolation.md`](references/isolation.md)）。
4. **セッションをその worktree へ移す。** 移動が成立するまでは隔離されていない。
5. 移動を実測で確認する: `git rev-parse --show-toplevel` と `git branch --show-current` が期待値であること。
6. 運搬が必要なファイルを [`references/carry-in.md`](references/carry-in.md) に従って揃える。**エージェントの自動運搬は新規作成時にしか走らない**ため、既存 worktree に入った場合は手で運ぶ。
7. 運搬したファイルが検査対象に入っていないことを確認する（`.env` の**実物の資格情報**がシークレット走査に載る）。

### cleanup

[`references/cleanup.md`](references/cleanup.md) の規律に従う。要約すると:

1. worktree が clean であることを確認する。dirty なら削除せず、絶対パスと残作業を報告する。
2. **セッションがその worktree の中にいるなら、先に出る**（`ExitWorktree` の `action: "keep"`）。中にいるまま解除すると成功してしまい、自分の作業ディレクトリごと消える。
3. `git worktree remove` で解除する。
4. `git worktree list` を**取り直して**解除済みを確認する。
5. **完全一致した ref だけ**を削除する。**glob は使わない。** squash / rebase merge された branch は `git branch -d` が拒否するため、PR の MERGED を実測してから削除する。
6. いずれかが失敗したら止め、何が残ったかを報告する。

## 破ってはいけない前提

以下は実測で確かめた挙動であり、知らないと隔離したつもりで破れる。根拠と再現手順は各 reference にある。

- **作るだけでは隔離にならない。** subagent・フォークして走るスキル・バックグラウンドの Bash は**起動時の作業ディレクトリを継承する**。ツール呼び出しを `cd <絶対パス> && ...` で書いても、そこから起動したものは共有ツリーで動く（[`references/isolation.md`](references/isolation.md)）
- **逆に、セッションを移せばハーネスが subagent まで含めて強制する。** 「入る」ことが隔離の実体であり、代わりになる書き方は無い（[`references/isolation.md`](references/isolation.md)）
- **hook のパスは worktree に追従しない。** `${CLAUDE_PROJECT_DIR}` は起動時のプロジェクトルートを指したままで、hook はメインチェックアウト側のスクリプトを走らせる（[`references/isolation.md`](references/isolation.md)）
- **`.gitignore` 対象のファイルは checkout で入らない。** 明示的に運ぶ必要があり、自動運搬は**新規作成時だけ**走る（[`references/carry-in.md`](references/carry-in.md)）
- **共有ツリーへのシンボリックリンクは読み取り専用ではない。** リンク越しに実体へ**書ける・消せる**。`rm` を見るガードでは `sed -i` を捕まえられない（[`references/carry-in.md`](references/carry-in.md)）
- **除外は 1 か所では足りない。** `.gitignore` を読まない検査があるため、同じ除外を全ての検査へ入れる（[`references/scanner-exclusions.md`](references/scanner-exclusions.md)）
- **削除は完全一致だけ。** glob での worktree / branch 削除は行わない（[`references/cleanup.md`](references/cleanup.md)）

## 呼び出し側からの利用

`issue-start` / `issue-batch` / レビュー系フローは、worktree の機構をここへ委譲する。
呼び出し側は branch を用意し、`git-worktree enter <branch>` 相当の契約で入り、
作業後に `git-worktree cleanup` 相当の契約で片付ける。
**上記の前提を呼び出し側へ複製しない。**
