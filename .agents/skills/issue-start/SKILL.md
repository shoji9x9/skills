---
argument-hint: <Issue URL | 番号> [--plan | --commit | --pr]
description: GitHub Issue を起点に作業開始フローを標準化するスキル。Issue URL や Issue 番号を受け取り、リポジトリ一致確認・feature ブランチ作成と checkout（gh issue develop）・調査・実装・commit・push・PR 作成までを段階的に進めたいときに使う。「Issue から始める」「この issue に着手」「issue-start」や、`--plan` / `--commit` / `--pr` を伴う依頼で発動する。
license: MIT
name: issue-start
---
# Issue Start

GitHub Issue 起点の作業開始を `gh` で標準化する。ブランチ命名・ベースブランチ・PR 運用・commit 規約は後述「ブランチ運用・commit 規約の参照」で解決する。

## 使い方

```text
issue-start <Issue URL | 番号> [--plan | --commit | --pr]
```

- モード未指定（`--plan` / `--commit` / `--pr` なし）: ブランチ作成・checkout 後そのまま調査・実装へ進む。commit / push / PR はしない
- `--plan`: 関連ファイルと Issue を確認し、必要なことだけ追加確認して詳細計画を作る。実装はユーザーの開始指示後に進める
- `--commit`: 実装、必要な確認、関連ファイルだけの staging、論理単位の commit まで行う
- `--pr`: 実装、必要な確認、commit、push、PR 作成まで行う

`--commit` / `--pr` は、その段階までの実行をユーザーが明示的に委譲した合図。指定がない限り commit しない。

例: `issue-start 220` / `issue-start 220 --plan` / `issue-start https://github.com/<owner>/<repo>/issues/220 --pr`

- 自然文でも発動する:「Issue から始める」「この issue に着手」。

## 前提

- **ツール**: `gh`（GitHub CLI）, `git`
- **前提スキル**: なし（worktree で作業する場合のみ `git-worktree`）
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

## ブランチ運用・commit 規約の参照

ブランチ運用・commit 規約はリポジトリごとに異なる。解決手順（設定ファイル → 標準ドキュメント探索 → ユーザー確認）と設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは [`references/conventions.md`](references/conventions.md) を参照する。
`--amend` / force push をしない・関連ファイルだけを stage する・長い commit 本文は `git commit -F <file>` で渡す、といった汎用の操作メカニクスは規約解決の結果に依らず常に守る。

## 基本フロー

1. Issue URL から owner / repo / issue 番号を抽出する（番号のみ渡された場合は現在の repo を対象にする）
2. 現在の repo と Issue の owner / repo が一致するか確認する
   - 一致しない場合は、以降の `gh issue view` やブランチ作成を行わず中断し、ユーザーに確認する
3. 一致を確認できた場合のみ title / body とコメントの両方を確認する。**非 TTY（パイプ／エージェント経由）では** `gh issue view --comments` はコメントのみを出力し body を含めない（コメント 0 件だと出力が空になる。TTY では body も表示される）。エージェント実行では次のいずれかで確実に両方を得る:
   - `gh issue view <番号> --repo <owner>/<repo> --json title,body,comments,createdAt --jq ...` で 1 コマンド一括取得する（推奨）。`createdAt` は step 8 の現状検証で使う
   - または title / body は `gh issue view <番号> --repo <owner>/<repo>`、コメントは `gh issue view <番号> --repo <owner>/<repo> --comments`（0 件なら空でよい）に分ける。この場合も `createdAt` は `--json createdAt` で別途取得する（計 3 コール）
   - 設計の改訂・実測に基づく方針変更はコメントに追記されることが多い。本文が最新とは限らないため、本文とコメントで改訂・追記・両論併記があれば最新の決定を優先し、計画・実装に反映する
4. ブランチ名を `feature/<番号>-<英語の短い説明>` で決める（リポジトリの規約に別の命名があればそれに従う）
   - title が日本語中心なら、転写せず作業内容を表す短い英語の kebab-case に要約する
5. 同じ issue 番号のブランチが既にないか確認する
   - local: `git --no-pager branch --list 'feature/<番号>-*'`
   - remote: `git ls-remote --heads origin 'refs/heads/feature/<番号>-*'`
     - **`git branch -r --list` を使わない。** 手元の remote-tracking ref を読むだけなので、fetch していないと
       実在する branch を 0 件と誤判定する。step 6 の紐付け判定がこの結果に依存するため、リモートへ直接問い合わせる
6. 同番号ブランチが見つかった場合は重複作成せず分岐する
   - 1 本だけで意図が明確なら、その branch を使って継続する。
     ただし**入る前に Issue との紐付けを確かめる**——既存 branch は
     worktree の作成手段や `git switch -c` で作られていることがあり、その場合は紐付けが無い
     - **local にしか無い場合**（step 5 の remote 検索が 0 件）: 紐付けの対象はリポジトリ側に存在する ref なので、
       **紐付けは作られていない**。`git-worktree` の `references/isolation.md`「作らせてしまった後の回復」に従い、
       未 commit でベースと同一コミットなら `gh issue develop --name <同じ名前> --base <ベース>`（`--checkout` なし）で
       回復してから続ける。commit 済みなら回復できないのでユーザーに確認する
     - **remote にもある場合**: `gh issue develop --list <番号> --repo <owner>/<repo>` で紐付けを実測する。
       **PR が既にあると紐付けは PR へ移り、この一覧は空になる**（実測）ため、空だったときは
       `gh pr list --head <branch>` も見てから判断する（PR があれば紐付け済み、無ければ上と同じ回復を検討する）
     - 紐付けを確認できたら branch へ入る。共有ツリーなら checkout する
     - worktree で作業する場合は、**branch は既にあるので `gh issue develop` で作り直さない**。
       local ref が無ければ `git fetch origin '+refs/heads/<branch>:refs/remotes/origin/<branch>'` と
       `git branch <branch> FETCH_HEAD` で起こしてから、`git-worktree enter <branch>` 相当の契約で入る
       （step 7 の worktree の項は「branch が見つからない場合」の手順なので、その branch 作成部分は適用しない）
   - 複数候補がある、または意図が不明ならユーザーに確認する
7. 見つからない場合のみ、ベースブランチから作成する
   - ベースブランチは「ブランチ運用・commit 規約の参照」で解決する。規約に統合ブランチの指定（例: `main` / `master` / `develop`）があればそれに従い、`main` に固定しない
   - 規約から判断できなければ、既定のベースブランチを勝手に決めず、リポジトリのデフォルトブランチ（`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`）を候補として提示してユーザーに確認する
   - **ブランチは `gh issue develop` が作る。これは worktree の有無に依らない契約。**
     worktree の作成手段（`git worktree add -b` / Claude Code の `EnterWorktree` の `name`）に作らせると、
     ブランチ名がその機構の命名規則になり（`worktree-<名前>` 等）、既定の base も変わるため、
     **Issue とブランチの紐付け（linked branches）が作られない**。
     紐付けの欠落は成功した作業と見分けが付かず、Issue の画面を見るまで気付けない
   - 共有ツリーでそのまま作業する場合: `gh issue develop <番号> --name "feature/<番号>-<英語の短い説明>" --base <ベースブランチ> --checkout`
   - **worktree で作業する場合**（別セッションが現在のブランチを使っている等）: `--checkout` を**付けずに**ブランチだけ作り、その**既存ブランチ**に対して worktree を用意してセッションを移す

     `--checkout` を付けない `gh issue develop` は**リモート側にブランチを作るだけ**で、ローカルの
     `refs/heads/<branch>` も remote-tracking ref も作らない（`--checkout` が fetch と checkout を担っている）。
     `git-worktree` の `enter` は渡されたブランチがローカルに**存在すること**を前提に張るため、
     続けて fetch してローカルブランチを起こしてから渡す。

     ```bash
     BRANCH="feature/<番号>-<英語の短い説明>"
     gh issue develop <番号> --name "${BRANCH}" --base <ベースブランチ>
     # refspec を明示する。既定の refspec に頼ると single-branch clone では
     # remote-tracking ref が作られず、次の行が「そんな ref は無い」で落ちる
     git fetch origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
     git branch "${BRANCH}" FETCH_HEAD                      # ローカル ref を作る
     git rev-parse --verify --quiet "refs/heads/${BRANCH}"  # 存在を実測してから git-worktree へ渡す
     ```

     `git branch <名前> <始点>` は共有ツリーの checkout を変えないので、別セッションが使っている
     現在のブランチに触らない（これが `--checkout` を外す理由）。
     upstream は未設定なので、最初の push は `git push -u origin "${BRANCH}"` で行う。

     worktree の機構（置き場所、セッションの移動、`.gitignore` 対象ファイルの運搬、検査からの除外、
     clean 確認付きの後片付け）は `git-worktree` スキルへ委譲し、ここへ複製しない
     （`git-worktree enter <branch>` 相当の契約で入り、作業後は `git-worktree cleanup` 相当の契約で片付ける）。
     `git worktree add` しただけでは隔離にならない——セッションを移さないと subagent・
     フォークして走るスキル・バックグラウンドの Bash が呼び出し元の作業ツリーで動く
8. **Issue 記載の影響範囲を鵜呑みにせず、現状に対して再検証する**（計画・実装に進む前。全モード共通）
   - Issue 記載の対象（ファイル・パス・モジュール）を唯一の出発点にせず、**現行コードから独立に影響範囲を再導出**して突き合わせる。記載パスは既にリネーム・移動・削除されている場合がある
   - step 3 の `createdAt` 以降にベースブランチへ入った変更を確認する。**先に `git fetch` して**、`createdAt` 時点のベース先端との**範囲比較**で見る
     （ローカルの `origin/<ベースブランチ>` は古いことがある。また `--since` は commit 日時で絞るため、createdAt より前に commit され後からマージされた変更を取りこぼす。`-- <パス>` を付けると 0 件になりやすい）

     ```bash
     git fetch --quiet origin '<ベースブランチ>'
     tip=$(git rev-list -1 --first-parent --before='<createdAt>' 'origin/<ベースブランチ>')
     [ -n "$tip" ] || { echo '判定不能: createdAt 時点の先端を特定できない（履歴が浅い可能性）'; exit 1; }
     git --no-pager log --oneline "$tip..origin/<ベースブランチ>"   # 対象が絞れるなら末尾に -- <パス>
     ```

   - **0 件を「乖離なし」の根拠にしない**。`tip` が空・`git fetch` が失敗したときは合格に倒さず判定不能として扱い、深い fetch（`--unshallow` 等）を試すかユーザーに確認する。
     記載パスの現存は `git ls-files -- '<パス>'` で直接確かめる
   - 突き合わせで乖離が出たら分類して扱う
     - **縮小**（別 PR で解決済み・対象が削除済み）: 残っている作業だけを対象にする。全て解決済みなら実装せず Issue のクローズを相談する
     - **拡大**（記載外へ波及する・記載パスが現存しない）: 影響範囲を再定義し、Issue の更新・分割を相談する
   - 乖離が作業範囲や実装方針を変える規模なら、実装に進まずユーザーに確認する（「追加確認が必要な条件」）
9. 選択されたモードに応じて後続へ進む（各モードの挙動は「使い方」を参照）
10. **push する直前にリモートの PR ベースブランチの進行を確認する**（`--pr` のみ）
    - step 7 で規約から解決したベースブランチを、作成予定の PR のベースとして保持し、`git fetch origin '<PR ベースブランチ>'` を実行する。リポジトリのデフォルトブランチと同じだと仮定しない。既存 PR を継続する場合は `gh pr view --json baseRefName` で実際の PR ベースを再取得して使う
    - `git rev-list --count 'HEAD..origin/<PR ベースブランチ>'` で、現在の作業ブランチへ未取り込みの commit 数を確認する。fetch の失敗、PR ベースの解決失敗、remote ref の不在を「進行なし」に倒さず、push を止めて原因を解消する
    - 0 件ならそのまま push へ進む。1 件以上なら、差分を `git log --oneline 'HEAD..origin/<PR ベースブランチ>'` で示し、次のいずれかで扱う
      - merge / rebase 等の取り込み方法がリポジトリ規約またはユーザー指示で一意に決まっている場合は、その方法で取り込み、競合解消と必要な検証を済ませてから未取り込み件数を再確認する
      - 取り込み方法が決まっていない、競合解消に複数の妥当な選択肢がある、または取り込みが作業範囲を変える場合は、push せずユーザーに確認する
    - 取り込み後も未取り込み件数が 0 になったことを実測してから push する。確認後に長時間の作業や修正を挟んだ場合は、push 直前に fetch から再実行する

## commit / PR の扱い

- commit message は「ブランチ運用・commit 規約の参照」で解決した規約に従う（commit-msg 検証＝commitlint/lefthook 等がリポジトリにあればそれにも従う）
- 無関係な変更を同じ commit に混ぜない。関連ファイルだけを stage する
- 既存 worktree に無関係な差分がある場合は巻き込まず、対象ファイルだけを扱う
- commit 時に pre-commit フック（lefthook 等）や kaizen のコミット前ゲートが設定されていれば走る。ゲートでブロックされた場合は指示に従って `kaizen --current` を実行してから再 commit する
- `--pr` 時は基本フロー step 10 の PR ベースブランチ進行確認を通過してからブランチを push し、関連 Issue・変更概要・確認内容を含む PR を作る
- commit の `--amend` と force push は行わない

## 追加確認が必要な条件

以下のときだけブランチ作成後に確認する。

- 要件のスコープが曖昧
- 挙動の選択肢が複数あり、実装に大きく影響する
- 既存ブランチが複数あり、どれを使うべきか判断できない
- `--plan` で詳細計画を立てる前提条件が不足している
- 本文とコメントに齟齬があり、どの決定に従うか判断できない（特に `--plan`）
- Issue 記載の影響範囲と現状が乖離し、作業範囲が変わる（記載対象が現存しない・別 PR で解決済み・記載外へ波及する）
