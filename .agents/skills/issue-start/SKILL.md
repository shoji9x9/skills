---
argument-hint: <Issue URL | 番号> [--branch-only | --plan | --commit | --pr | --acceptance]
description: GitHub Issue を起点に作業開始フローを標準化するスキル。Issue URL や Issue 番号を受け取り、リポジトリ一致確認・feature ブランチ作成と checkout（gh issue develop）・調査・実装・commit・push・PR 作成までを段階的に進めたいときに使う。ブランチを用意した時点で呼び出し元へ返す `--branch-only` があり、実装を自分で持つスキルからの委譲に使う。push の前と `--acceptance` で、Issue の受け入れ条件を 1 項目ずつ根拠と突き合わせた表を同梱の検査で確かめる。「Issue から始める」「この issue に着手」「受け入れ条件を確かめて」「issue-start」や、`--branch-only` / `--plan` / `--commit` / `--pr` / `--acceptance` を伴う依頼で発動する。
license: MIT
name: issue-start
---
# Issue Start

GitHub Issue を起点にした作業の始め方を、`gh` で標準化する。ブランチの名前・ベースブランチ・PR の運用・commit の規約は、後の「ブランチ運用・commit 規約の参照」で決める。

## 使い方

```text
issue-start <Issue URL | 番号> [--branch-only | --plan | --commit | --pr | --acceptance [--out <path>] [--decisions <path>] [--allow-later <owner>]]
```

- モードの指定なし（`--branch-only`・`--plan`・`--commit`・`--pr`・`--acceptance` のどれも無い）: ブランチを作って checkout した後、そのまま調査と実装に進む。commit・push・PR はしない
- `--branch-only`: ブランチの作成と checkout（と基本フローの step 8 の現状の確認）までを行い、調査と実装には進まずに返る。
  実装を自分で持つスキルから任されたときに使う。モードを指定せずに呼ぶと、このスキルはそのまま実装に進む取り決めである。
  そのため、呼び出し元が続けて実装すると、同じ Issue の実装が二重に行われる。
  文書に「実装は任せない」と書いても取り決めは変わらないので、モードで区別する
- `--plan`: 関連するファイルと Issue を確かめ、必要なことだけを追加で確認して、詳しい計画を作る。実装は、利用者が始めるよう指示した後に進める
- `--commit`: 実装、必要な確認、関連するファイルだけの staging、論理的な単位での commit までを行う
- `--pr`: 実装、必要な確認、commit、push、PR の作成までを行う。push の前に、受け入れ条件の突き合わせ（基本フローの step 10）を通す
- `--acceptance`: 現在のブランチで、Issue の受け入れ条件を 1 項目ずつ根拠と突き合わせた表を作り、同梱の検査を通して返る（ブランチの作成・実装・commit・push はしない）。
  実装を自分で持つスキル（`parity-replace` など）が、完了の判定をこのスキルに任せるときにも使う。
  `--out` は表の置き場所、`--decisions` は判断待ちの記録（`pending_decisions` を持つ JSON）、`--allow-later` は後の工程へ回してよい条件を満たす担当（呼び出し元が決める）である。
  手順は [`references/acceptance.md`](references/acceptance.md) で定義する

`--commit` と `--pr` は、利用者がその段階までの実行を明示的に任せたという合図である。指定が無い限り commit しない。

例を次に挙げる。

```text
issue-start 220
issue-start 220 --plan
issue-start 220 --branch-only
issue-start 220 --acceptance
issue-start https://github.com/<owner>/<repo>/issues/220 --pr
```

- 自然文でも発動する（「Issue から始める」「この issue に着手」）。

## 前提

- ツール: `gh`（GitHub CLI）、`git`
- 前提スキル: なし（worktree で作業する場合だけ `git-worktree`）
- MCP: なし
- シェル: bash（POSIX 互換のシェル）。コマンドの例は bash を前提にしているので、Windows では WSL や Git Bash などの bash の環境で実行する
- Node.js は、受け入れ条件の突き合わせ（`--acceptance` と、`--pr` の push の前）でだけ要る（同梱の [`scripts/acceptance-check.mjs`](scripts/acceptance-check.mjs) を実行する）。
  無ければ、突き合わせを合格として扱わずに止まる。それ以外のモードは、pnpm や python を含めて、ランタイムが要らない。

## ブランチ運用・commit 規約の参照

ブランチの運用と commit の規約は、リポジトリごとに違う。
決め方（設定ファイル、標準のドキュメントの探索、利用者への確認の順）と、設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは、[`references/conventions.md`](references/conventions.md) にある。
規約を決めた結果に関わらず、次の操作の決まりは常に守る。`--amend` と force push をしない。関連するファイルだけを stage する。長い commit の本文は `git commit -F <file>` で渡す。

## 基本フロー

1. Issue の URL から、owner・repo・Issue の番号を取り出す（番号だけが渡された場合は、現在の repo を対象にする）
2. 現在の repo と Issue の owner・repo が一致するかを確かめる
   - 一致しない場合は、その後の `gh issue view` もブランチの作成もせずに中断し、利用者に確認する
3. 一致を確かめられた場合だけ、title と body、コメントの両方を確かめる。
   TTY でない実行（パイプやエージェントからの実行）では、`gh issue view --comments` はコメントだけを出力し、body を含めない。
   コメントが 0 件だと、出力は空になる（TTY では body も表示される）。エージェントで実行するときは、次のどちらかで両方を確実に取得する
   - `gh issue view <番号> --repo <owner>/<repo> --json title,body,comments,createdAt --jq ...` で、1 つのコマンドでまとめて取得する（推奨）。`createdAt` は step 8 の現状の確認で使う
   - または、title と body を `gh issue view <番号> --repo <owner>/<repo>` で、コメントを `gh issue view <番号> --repo <owner>/<repo> --comments` で、分けて取得する（0 件なら空でよい）。
     この場合も、`createdAt` は `--json createdAt` で別に取得する（合わせて 3 回の呼び出し）
   - 設計の改訂や、実測に基づく方針の変更は、コメントに追記されることが多い。本文が最新とは限らない。
     本文とコメントに改訂・追記・両方の案の併記があれば、最新の決定を優先して、計画と実装に反映する
4. ブランチの名前を `feature/<番号>-<英語の短い説明>` の形で決める（リポジトリの規約に別の名前の決まりがあれば、それに従う）
   - title が主に日本語なら、そのまま書き写さず、作業の内容を表す短い英語の kebab-case にまとめる
5. **担当者（assignee）を確かめ、空なら自分を割り当てて、読み直す。** そのうえで、同じ Issue の番号のブランチが既に無いかを確かめる
   - 担当者の手順と止まる条件は [`references/assignee.md`](references/assignee.md) で定義する（読めなければ、着手せずに止まる）。
     自分以外が付いている場合や、読み直して自分以外も付いていた場合は、ブランチを作らず既存のブランチにも入らずに利用者に確認する。
     割り当てるだけでは排他にならない（担当者は複数付けられる）ので、読み直しを省かない
   - local: `git --no-pager branch --list 'feature/<番号>-*'`
   - remote: `git ls-remote --heads origin 'refs/heads/feature/<番号>-*'`
     - `git branch -r --list` を使わない。手元の remote-tracking ref を読むだけなので、fetch していないと、
       実在する branch を 0 件と判定してしまう。step 6 の紐付けの判定がこの結果に頼るので、リモートに直接問い合わせる
6. 同じ番号のブランチが見つかった場合は、重ねて作らずに、次のように分ける
   - 1 本だけで、意図がはっきりしていれば、その branch を使って続ける。
     ただし、入る前に Issue との紐付けを確かめる。既存の branch は、
     worktree を作る手段や `git switch -c` で作られていることがあり、その場合は紐付けが無い
     - local にしか無い場合（step 5 の remote の検索が 0 件）: 紐付けの対象はリポジトリ側に在る ref なので、
       紐付けは作られていない。`git-worktree` の `references/isolation.md`「作らせてしまった後の回復」に従う。
       commit しておらず、ベースと同じコミットなら、`gh issue develop --name <同じ名前> --base <ベース>`（`--checkout` なし）で
       回復してから続ける。commit した後なら回復できないので、利用者に確認する
     - remote にもある場合: `gh issue develop --list <番号> --repo <owner>/<repo>` で、紐付けを実際に確かめる。
       PR が既にあると、紐付けは PR へ移り、この一覧は空になる（実測）。
       そのため、空だったときは `gh pr list --head <branch>` も見てから判断する。PR があれば紐付け済みで、無ければ上と同じ回復を考える
     - 紐付けを確かめられたら、branch に入る。共有ツリーなら checkout する
     - worktree で作業する場合は、branch は既にあるので、`gh issue develop` で作り直さない。
       local の ref が無ければ、`git fetch origin '+refs/heads/<branch>:refs/remotes/origin/<branch>'` と
       `git branch <branch> FETCH_HEAD` で作ってから、`git-worktree enter <branch>` と同じ取り決めで入る。
       step 7 の worktree の項は「branch が見つからない場合」の手順なので、その中の branch を作る部分は当てはめない
   - 候補が複数ある場合や、意図が分からない場合は、利用者に確認する
7. 見つからない場合だけ、ベースブランチから作る
   - ベースブランチは「ブランチ運用・commit 規約の参照」で決める。規約に統合ブランチの指定（例: `main`・`master`・`develop`）があればそれに従い、`main` に固定しない
   - 規約から判断できなければ、ベースブランチを勝手に決めない。
     リポジトリのデフォルトブランチ（`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`）を候補として示し、利用者に確認する
   - **ブランチは `gh issue develop` で作る**。worktree を使うかどうかに関わらない取り決めである。
     worktree を作る手段（`git worktree add -b` や、Claude Code の `EnterWorktree` の `name`）に作らせると、
     ブランチの名前がその仕組みの決まり（`worktree-<名前>` など）になり、デフォルトの base も変わる。
     その結果、Issue とブランチの紐付け（linked branches）が作られない。
     紐付けが無くても作業は成功したように見えるので、Issue の画面を見るまで気付けない
   - 共有ツリーでそのまま作業する場合: `gh issue develop <番号> --name "feature/<番号>-<英語の短い説明>" --base <ベースブランチ> --checkout`
   - worktree で作業する場合（別のセッションが現在のブランチを使っているときなど）: `--checkout` を付けずにブランチだけを作り、その既存のブランチに worktree を用意して、セッションを移す

     `--checkout` を付けない `gh issue develop` は、リモート側にブランチを作るだけである。ローカルの
     `refs/heads/<branch>` も remote-tracking ref も作らない（fetch と checkout は `--checkout` が行っている）。
     `git-worktree` の `enter` は、渡されたブランチがローカルに在ることを前提に worktree を作る。
     そのため、続けて fetch してローカルのブランチを作ってから渡す。

     ```bash
     BRANCH="feature/<番号>-<英語の短い説明>"
     gh issue develop <番号> --name "${BRANCH}" --base <ベースブランチ>
     # refspec を明示する。デフォルトの refspec に頼ると、single-branch clone では
     # remote-tracking ref が作られず、次の行が「そんな ref は無い」で失敗する
     git fetch origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
     git branch "${BRANCH}" FETCH_HEAD                      # ローカル ref を作る
     git rev-parse --verify --quiet "refs/heads/${BRANCH}"  # 存在を実測してから git-worktree へ渡す
     ```

     `git branch <名前> <始点>` は、共有ツリーの checkout を変えない。そのため、別のセッションが使っている
     現在のブランチに触らない（これが `--checkout` を外す理由である）。
     upstream が設定されていないので、最初の push は `git push -u origin "${BRANCH}"` で行う。

     worktree の仕組み（置き場所、セッションの移動、`.gitignore` 対象ファイルの運搬、チェックからの除外、
     clean を確かめてからの後片付け）は `git-worktree` スキルに任せ、ここには書き写さない。
     `git-worktree enter <branch>` と同じ取り決めで入り、作業の後は `git-worktree cleanup` と同じ取り決めで片付ける。
     `git worktree add` を実行しただけでは、隔離にならない。セッションを移さないと、subagent・
     フォークして動くスキル・バックグラウンドの Bash が、呼び出し元の作業ツリーで動く
8. **Issue に書かれた影響範囲をそのまま信じず、今の状態に対して確かめ直す**（計画と実装に進む前。すべてのモードで行う）
   - Issue に書かれた対象（ファイル・パス・モジュール）だけを出発点にしない。今のコードから影響範囲を独立に導き直して、突き合わせる。
     書かれたパスは、既に名前が変わったり、移動・削除されたりしていることがある
   - step 3 の `createdAt` より後にベースブランチに入った変更を確かめる。先に `git fetch` を実行し、`createdAt` の時点のベースの先端との範囲で比べる。
     ローカルの `origin/<ベースブランチ>` は古いことがある。また、`--since` は commit の日時で絞るので、
     createdAt より前に commit されて後からマージされた変更を見逃す。`-- <パス>` を付けると 0 件になりやすい

     ```bash
     git fetch --quiet origin '<ベースブランチ>'
     tip=$(git rev-list -1 --first-parent --before='<createdAt>' 'origin/<ベースブランチ>')
     [ -n "$tip" ] || { echo '判定不能: createdAt 時点の先端を特定できない（履歴が浅い可能性）'; exit 1; }
     git --no-pager log --oneline "$tip..origin/<ベースブランチ>"   # 対象が絞れるなら末尾に -- <パス>
     ```

   - 0 件を「ずれが無い」根拠にしない。`tip` が空のときや、`git fetch` が失敗したときは、合格として扱わず判定できないものとして扱う。
     深い fetch（`--unshallow` など）を試すか、利用者に確認する。
     書かれたパスが在るかは、`git ls-files -- '<パス>'` で直接確かめる
   - 突き合わせでずれが見つかったら、分類して扱う
     - 縮小（別の PR で解決済み、対象が削除済み）: 残っている作業だけを対象にする。すべて解決済みなら、実装せずに Issue を閉じるかを相談する
     - 拡大（書かれた範囲の外に影響する、書かれたパスが無い）: 影響範囲を決め直し、Issue の更新や分割を相談する
   - ずれが作業の範囲や実装の方針を変えるほど大きいなら、実装に進まずに利用者に確認する（「追加確認が必要な条件」）
9. 選んだモードに応じて、後の処理に進む（各モードの挙動は「使い方」にある）。
   **`--branch-only` はここで終わる。** ブランチの名前、checkout したかどうか、step 8 の現状の確認の結果（ずれがあればその分類）を報告して返る。
   調査・実装・commit・push・PR のどれも行わない。
   **`--acceptance` は、step 1〜3（リポジトリの一致の確認と Issue の取得）の後、step 4〜8 を飛ばして step 10 だけを行う。**
   検査の結果（終了コード・`closable`・`findings`）を報告して返る
10. **Issue の受け入れ条件を、1 項目ずつ根拠と突き合わせる**（`--pr` の push の前と、`--acceptance`）。
    手順・表の様式・状態の語・検査の終了コードは、[`references/acceptance.md`](references/acceptance.md) で定義する。
    ここには書き写さない。読めなければ、突き合わせを合格として扱わずに止まる。
    **検査が exit 0 になるまで push しない。** テストやリントが通っても、受け入れ条件を満たしたことにはならない。
    満たせない条件を自分で外さず、利用者に確認する（`waived` と `deferred` には利用者の承認が要る）。
    検査の出力の `closable` が `false` なら、PR の本文で Issue を閉じない（`Refs #<番号>` と書く）。
    **受け入れ条件を変えた（`waived` や `deferred` にした、コメントで改訂した）なら、似た Issue を見直すかを利用者に確かめる。**
    手順は同じ [`references/acceptance.md`](references/acceptance.md) の「受け入れ条件を変えたとき」で定義する。他の Issue は、承認を得てから変える
11. **push する直前に、リモートの PR のベースブランチが進んでいないかを確かめる**（`--pr` だけ）
    - step 7 で規約から決めたベースブランチを、これから作る PR のベースとして使い、`git fetch origin '<PR ベースブランチ>'` を実行する。
      リポジトリのデフォルトブランチと同じだと決めつけない。既存の PR を続ける場合は、`gh pr view --json baseRefName` で実際の PR のベースを取得し直して使う
    - `git rev-list --count 'HEAD..origin/<PR ベースブランチ>'` で、今の作業ブランチに取り込んでいない commit の数を確かめる。
      fetch の失敗、PR のベースを決められないこと、remote の ref が無いことを「進んでいない」として扱わない。push を止めて、原因を取り除く
    - 0 件なら、そのまま push に進む。1 件以上なら、差分を `git log --oneline 'HEAD..origin/<PR ベースブランチ>'` で示し、次のどちらかで扱う
      - 取り込み方（merge や rebase など）がリポジトリの規約か利用者の指示で 1 つに決まっている場合は、その方法で取り込む。
        競合を解消し、必要な確認を済ませてから、取り込んでいない件数をもう一度確かめる
      - 取り込み方が決まっていない場合、競合の解消に妥当な選択肢が複数ある場合、取り込みで作業の範囲が変わる場合は、push せずに利用者に確認する
    - 取り込んだ後、取り込んでいない件数が 0 になったことを確かめてから push する。確かめた後に長い作業や修正を挟んだ場合は、push の直前に fetch からやり直す
    - 取り込みで HEAD が進んだら、step 10 の検査をやり直す（表の `commit` が HEAD と合わず、`stale-commit` で失敗する）

## commit / PR の扱い

- commit message は、「ブランチ運用・commit 規約の参照」で決めた規約に従う。commit-msg のチェック（commitlint や lefthook など）がリポジトリにあれば、それにも従う
- 関係の無い変更を同じ commit に含めない。関連するファイルだけを stage する
- 既存の worktree に関係の無い差分がある場合は、巻き込まずに、対象のファイルだけを扱う
- commit のときに、pre-commit の hook（lefthook など）や kaizen の commit 前のチェックが設定されていれば、それが実行される。
  チェックで止められた場合は、指示に従って `kaizen --current` を実行してから、もう一度 commit する
- `--pr` のときは、基本フローの step 10 の受け入れ条件の突き合わせと、step 11 の PR のベースブランチの確認を通してから、ブランチを push する。
  関連する Issue・変更の概要・確認した内容・突き合わせの表を含む PR を作る。
  PR を作ったら、突き合わせの結果を Issue にコメントし、満たした項目にチェックを付ける（手順は [`references/acceptance.md`](references/acceptance.md) の手順 7）
- commit の `--amend` と force push はしない

## 追加確認が必要な条件

次のときだけ確認する。担当者の確認はブランチを作る前に、それ以外はブランチを作った後に行う。

- Issue に自分以外の担当者が付いている。または、割り当てた後に読み直したら自分以外も付いていた（[`references/assignee.md`](references/assignee.md)）
- 要件の範囲があいまいである
- 挙動の選択肢が複数あり、実装に大きく影響する
- 既存のブランチが複数あり、どれを使うべきか判断できない
- `--plan` で詳しい計画を立てる前提が足りない（`--branch-only` では計画を立てないので、この条件は当たらない）
- 本文とコメントが食い違い、どの決定に従うか判断できない（特に `--plan`）
- Issue に書かれた影響範囲と今の状態がずれていて、作業の範囲が変わる（書かれた対象が無い、別の PR で解決済み、書かれた範囲の外に影響する）
