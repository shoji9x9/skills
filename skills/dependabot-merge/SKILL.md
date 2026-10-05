---
name: dependabot-merge
description: Dependabot が作成した PR のレビューとマージを `gh` で標準化するスキル。PR URL / PR 番号で 1 件、`--all` または無指定で open な全 Dependabot PR を対象にする。CI 成功の確認 → 更新内容（changelog/release notes）からマージ影響の確認 → 判断を PR コメントに記録 → 問題なければマージ、までを進める。特に 0.x（<1.0）依存はマイナー更新でも破壊的変更があり得るため影響を確認してから扱う。「Dependabot の PR をマージして」「依存更新 PR を確認してマージ」「dependabot-merge」「dependabot の PR を全部見て」や、`--all` を伴う依頼で必ず発動する。依存更新 PR を 1 件ずつ影響判断してからマージする。
argument-hint: "[PR URL | 番号 | --all]"
license: MIT
---

# Dependabot Merge

Dependabot が作った PR のレビューとマージを、`gh` で決まった手順にする。

依存の更新は、CI が通っているだけでは安全と言い切れない。semver では、`>=1.0` のマイナー・パッチの更新は後方互換が期待できる。一方、0.x（<1.0）はマイナーの更新でも破壊的な変更がありうる。
そこでこのスキルは、CI の成功を確かめたうえで changelog・release notes から影響を読み、判断の根拠を PR コメントに残してからマージする。
判断を記録するのは、なぜマージしたか（しなかったか）を後から追えるようにするためである。

## 使い方

```text
dependabot-merge <PR URL | 番号>   指定した 1 件の Dependabot PR を確認してマージ
dependabot-merge --all             現在の repo の open な Dependabot PR をすべて順に処理
dependabot-merge                   （対象の指定なし）--all と同じ。open な Dependabot PR をすべて順に処理
```

- 対象は、PR URL、PR 番号（現在の repo）、`--all`（一括）のどれかで指定する。`--all` は、GitHub の自動マージを設定していないリポジトリで一括処理する場合を想定している。
- PR URL・番号・`--all` のどれも指定しない場合は、`--all` として扱う（現在の repo の open な Dependabot PR をすべて順に処理する）。
- `--all`（対象の指定なしを含む）は、「open な Dependabot PR を順に確認してマージしてよい」という委任の合図である。それでも 1 件ずつ影響を確かめ、安全と判断したものだけをマージする。

例: `dependabot-merge 12` / `dependabot-merge https://github.com/<owner>/<repo>/pull/12` / `dependabot-merge --all`

- 自然文でも起動する（「Dependabot の PR をマージして」「依存更新 PR を確認してマージ」「dependabot の PR を全部見て」）。

## 前提

- ツール: `gh`（GitHub CLI。`gh api` を含む）
- 前提スキル: なし
- MCP: なし
- シェル: bash（POSIX 互換のシェル）。コマンド例は bash を前提にしているので、Windows では WSL や Git Bash などの bash の環境で実行する
- node・pnpm・python などのランタイムは要らない。

## セットアップ（マージ方式の選択）

マージ方式（`squash` / `merge` / `rebase`）は、利用者やリポジトリで好みが違う。一度決めたら使い続けることが多いので、スキルを導入したときに一度選び、`.config/skills/shoji9x9/skills.yml` の `skills.dependabot-merge.merge_method` に保存する。
スキルは、マージするたびにこの設定を読む。

```yaml
version: 1
skills:
  dependabot-merge:
    merge_method: squash   # squash | merge | rebase
```

- 作成と追記では、既にある内容を変えない。ファイルが無ければ `.config/skills/shoji9x9/` ごと作り、`skills.dependabot-merge.merge_method` だけを書く。
  ファイルがあれば、欠けているキーだけを該当するセクション（無ければ親も）に足す。既にあるキー・値・コメントは変えず、既にある設定は上書きしない。
- インストール先に設定が無ければ、ユーザーに方式を確認してから書く。設定が無いまま起動した場合は、デフォルトの `squash` を使い、そのことをユーザーに伝える（次回のために設定を作るよう促してよい）。
- リポジトリで許されたマージ方式（`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`）と合わない場合は、許された方式を案内して確認する。

## 基本フロー（単一 PR）

対象の指定が無いときと `--all` のときは、「`--all` フロー」に進む。次は、単一の PR（PR URL か番号）を指定されたときの手順である。

1. 入力から owner・repo・PR 番号を取り出す
2. 現在の repo と、PR の owner・repo が一致するかを確かめる
   - 一致しなければ、確認もマージもせずに中断し、ユーザーに確認する
3. PR の作成者が Dependabot かを確かめる（`gh pr view <番号> --repo <owner>/<repo> --json author --jq '.author.login'`）
   - bot の login の表記は一定しない（`dependabot[bot]` など）ので、`dependabot` を含むかで判定する。
     `app/dependabot` は `gh pr list --author` で絞るときの app slug で、`author.login` の値とは別のものである
   - Dependabot でなければ、このスキルの対象にするかを中断して確認する（対象の取り違えを防ぐ）
4. CI の成功を確かめる（後述「gh メカニクス」）。必須チェックの結果で次のように分ける
   - 成功 → 次に進む
   - 実行中 → 完了を待つ（`--watch`）。待たないなら、そのことを伝えて止まる
   - 失敗 → マージしない。失敗の内容と、どうすれば直せそうかを PR コメントに書き、ユーザーに報告する
5. マージの影響を確かめる。Dependabot が PR 本文に入れる Release notes・Changelog・Commits を読む（`gh pr view <番号> --repo <owner>/<repo> --json title,body,files`）。
   更新した依存とバージョンの差分（lockfile・manifest の差分）も読む
   - 0.x の依存は、マイナーの更新でも破壊的な変更がありうるので、changelog を必ず確かめる
   - devDependency か runtime か、リポジトリの中でどこで使っているかも踏まえて、影響の範囲を見積もる
6. 判断の根拠を PR コメントに書く（`gh pr comment`）。マージする場合も、しない場合も残す
   - マージできないと判断した場合は、何が課題か（例: 破壊的な変更で X の対応が要る、CI が失敗した原因、behind なので rebase が要る）と、どうすればマージできるかを必ず書く。次に見た人が、その内容を見て動けるようにするためである
7. マージするか決める
   - 安全なら、設定の `merge_method` でマージする（`gh pr merge --<method> <番号> --repo <owner>/<repo>`）
   - リスクがある、または影響を判断できないなら、マージしない。6 のコメントを残したうえで、ユーザーに報告する
8. 結果（マージしたか、その理由）を報告する

コメントより先にマージしない。必ず、判断をコメントに書いてからマージする。記録の無いマージは、経緯を追えなくなる。

## `--all` フロー（作り直しと force-push を見込んだ順の処理）

Dependabot は、1 件をマージすると、残りの open な PR を rebase や force-push で作り直すことがある。
さらに、"Dependabot Updates" のバックグラウンドのジョブが、後から新しい PR を作ることもある。
一覧を取った時点の状態のまま順に処理すると、古い head を見たり、新しく出た PR を見落としたりする。
そのため、次のように状態を再取得しながら、新しい PR が出なくなるまで処理する。

1. open な Dependabot PR を一覧にする（後述。ページネーションを処理する）
2. 1 件ずつ、処理する直前に最新の状態を再取得してから、単一 PR のフローを当てる
   - 処理する直前に `gh pr view <番号> --repo <owner>/<repo> --json headRefOid,mergeable,mergeStateStatus,state` と CI の状態を再取得する（一覧を取ったときの値を使い回さない）
   - `mergeStateStatus` が `BEHIND`（base に遅れている）なら、`@dependabot rebase` で更新を促す。
     rebase を頼んだ後の待ち方、断られたときに `recreate` で作り直させること、supersede・close されたときに後継の PR へ切り替えることは、「behind（base に遅れている）PR の更新」に従う。
     更新した後の CI の成功は、`--watch` がすぐ終わったことを根拠にせずに確かめてから判断する
   - 処理中に `state` が `CLOSED`（`Superseded by #<N>` など）に変わったら、その PR は追わない。後継の PR は、手順 5 で open の一覧を再取得するときに拾う
3. 1 件マージしたら、残りの PR が rebase・force-push され、CI がもう一度実行されることを見込む。次の PR は、head が変わらなくなり CI が最後まで終わるのを待ってから判断する。
   このとき、`gh pr checks --watch` がすぐ終わった（exit 0）ことを CI の完了として扱わない。
   「CI 成功の確認」の方法（`mergeStateStatus` が `CLEAN` か `UNSTABLE` になる、または必須チェックの行が pending でなくなる）でポーリングしてから判定する
4. 失敗した PR やリスクがある PR は飛ばし、理由を PR コメントに書く
5. 一通り処理したら、もう一度確かめる。open な Dependabot PR の一覧を再取得し、処理していない PR や新しい PR が残っていないかを見る。
   残っていれば（実行中の update のジョブが終わるのを待ってから）もう一度フローを回し、新しい PR が出なくなるまで繰り返す
6. 最後に、マージした PR と、飛ばした PR（理由付き）をまとめて報告する

## gh メカニクス

### Dependabot PR の一覧（`--all`。全件を取得する）

作成者で絞って取得する。`gh pr list --author` には、Dependabot の app slug `app/dependabot` を渡す。
件数が `--limit` のデフォルト（30）を超えると、取得できない分が出る（`gh pr list` に `--paginate` は無い）。そのため `--limit` を十分大きくし、デフォルトの 30 で打ち切らない。

```bash
gh pr list --repo <owner>/<repo> --state open --author "app/dependabot" \
  --limit 200 --json number,title,headRefName,url
```

### 作成者の確認（単一 PR）

```bash
gh pr view <番号> --repo <owner>/<repo> --json author --jq '.author.login'
```

- `author.login` の bot の表記は環境によって変わる（`dependabot[bot]` など）ので、`dependabot` を含むかで緩く判定する。
  `app/dependabot` は `gh pr list --author` で使う app slug で、`author.login` の値ではない（混同しない）。

### CI 成功の確認

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- すべてのチェックが終わるまで待ち、すべて成功なら終了コード 0、どれかが失敗すれば 0 以外で終わる。待ちたくない場合は、`--watch` を外して今の状態だけを見る。
- push の直後は、チェックがまだ登録されておらず、`no checks` とすぐ返ることがある。その場合は数秒待ってから確かめ直す。
- マージできるかは、`mergeStateStatus` でも確かめられる。
  `CLEAN` はマージできる。`BLOCKED` は必須チェックが通っていないか、要件を満たしていない。`BEHIND` は base に遅れている（rebase が要る）。
  `UNSTABLE` は必須でないチェックが失敗しているが、マージはできる。`DIRTY` はコンフリクトがある。

```bash
gh pr view <番号> --repo <owner>/<repo> --json mergeable,mergeStateStatus
```

rebase や force-push の後に `--watch` がすぐ終わった（exit 0）ことを、CI の完了として扱わない。
`@dependabot rebase` や force-push の直後は、必須チェック（`check`・`signatures` など、ブランチ保護で必須に指定したもの）がまだ登録されていないことがある。
その間は、先に登録されるスキップ専用のチェック（CodeQL の skipping など）だけが見える。
`--watch` は、その時点で登録されているチェックだけの完了を待つので、必須チェックが pending のままでも exit 0 で終わる。
head を差し替える操作（rebase・force-push）の後の CI の完了は、次のどちらかを満たすまで、上限を決めてポーリングしてから判定する。

- (a) `mergeStateStatus` が `BLOCKED` や `BEHIND` から `CLEAN` か `UNSTABLE` に変わる。リポジトリに依存しない確かな方法で、必須チェックが通っていなければ `BLOCKED` のままである。
- (b) 必須チェックの行が登録され、pending でなくなる。`--json` のフィールド（`bucket, completedAt, description, event, link, name, startedAt, state, workflow`）には、必須かを示すものが無い。
  そのため、`--required` フラグで絞る（<https://cli.github.com/manual/gh_pr_checks>）。
  すべてのチェックを見ると、スキップ専用のチェックだけが登録された時点ですべての行が pending でなくなり、同じ誤った判定になる。

  ```bash
  gh pr checks <番号> --repo <owner>/<repo> --required --json name,state,bucket
  ```

  行が 0 件のときは、pending が無いとは判断しない（`--required` でも同じ。必須チェックがまだ登録されていないか、必須チェックを設定していないリポジトリかのどちらかである）。
  このとき `gh` は空の配列を返さず、`no required checks reported on the '<branch>' branch` を stderr に出して、0 以外で終わる。
  rebase の直後にまだ登録されていない状態がこれに当たるので、コマンドの誤りとは扱わず、「0 件」としてポーリングを続ける。
  `bucket` に `fail` か `cancel` があれば、CI の失敗は確定している。`mergeStateStatus` が変わる（失敗したときは `BLOCKED` のまま）のを待たずに、マージしないと判断する。

この方法は、`--all` フローで 1 件マージした後に、次の PR の CI の完了を待つときにも使う。

### behind（base に遅れている）PR の更新

```bash
gh pr comment <番号> --repo <owner>/<repo> --body "@dependabot rebase"
```

Dependabot がブランチを base に合わせ直し、更新した後に CI がもう一度実行される。
ただし、rebase を頼んだ後の待機の終わりを、期待する変化（head の更新、CI の完了）だけにすると、待っても何も起きないことがある。
Dependabot が依頼を断る場合や、グループ更新の組み直しで PR が作り直される（supersede・close）場合である。
待つ間は `headRefOid` の変化だけでなく、`state`（`CLOSED` / `MERGED`）と直近の Dependabot のコメントも見る。次のどれかになったら待つのをやめる（上限を決めてポーリングする）。

- rebase が反映された場合: head が更新され、CI がもう一度実行される。CI の完了は、上の「CI 成功の確認」の方法（`--watch` がすぐ終わったことを根拠にしない）で待ってから判断する。
- 依頼を断られた場合: Dependabot が `The base commit has not changed`（実際には BEHIND でも出る）などで rebase を断ったら、`@dependabot recreate` で PR を作り直させ、新しい head の CI の成功を待つ。

  ```bash
  gh pr comment <番号> --repo <owner>/<repo> --body "@dependabot recreate"
  ```

- supersede・close された場合: グループ更新の組み直しで、その PR が後継の PR に置き換えられ、close されることがある。
  このとき、Dependabot のコメントに `Superseded by #<N>` や `updatable in another way` が出て、`state` が `CLOSED` になる。
  その場合はその PR を追わず、open な Dependabot PR の一覧を再取得して後継の PR を特定する。既に確かめた更新の内容（changelog・影響の評価）は、後継の PR でも使う。

`state` と直近の Dependabot のコメントは、次のコマンドで確かめる。
bot の表記の揺れに対応するため、`dependabot` を含む作成者で緩く絞る。コメントは古い順に並ぶので、最後が最新である。

```bash
gh pr view <番号> --repo <owner>/<repo> --json state,headRefOid,mergeStateStatus
gh api --paginate repos/<owner>/<repo>/issues/<番号>/comments \
  --jq '.[] | select(.user.login | ascii_downcase | contains("dependabot")) | {created_at, body: (.body // "")[:300]}'
```

### 判断の記録（PR コメント）

本文はバッククォートや `$` を含みうる。そのため、quoted heredoc（かファイルを書くツール）でファイルに書き、`--body-file` で渡す。

```bash
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
<判断と根拠>
EOF
gh pr comment <番号> --repo <owner>/<repo> --body-file "$body_file"
rc=$?
rm -f "$body_file"
(exit "$rc")  # gh の失敗を、後片付けの終了コードで隠さない
```

- マージする場合は、何を確かめ、なぜ安全と判断したかを書く（例: `>=1.0` のパッチで、changelog はバグ修正だけ）。
- マージしない場合は、課題とその解決策を書く（例: `0.x のマイナーで API 変更あり。<該当箇所> の修正が必要`、`CI の <ジョブ> が <理由> で失敗。<対処> で直る`、`BEHIND のため @dependabot rebase 後に再評価が必要`）。

### マージ

設定 `.config/skills/shoji9x9/skills.yml` の `skills.dependabot-merge.merge_method` に従う（デフォルトは `squash`）。

```bash
gh pr merge --squash <番号> --repo <owner>/<repo>   # または --merge / --rebase
```

- `BEHIND` でマージを断られた場合は、「behind（base に遅れている）PR の更新」に従う。`@dependabot rebase`（断られたら `@dependabot recreate`）で更新し、CI の成功を確かめてからもう一度試す。
- commit の `--amend` や force push はしない。`@dependabot` への指示のコメント以外で、履歴を書き換えない。

## マージ可否の判断ガイド

すべてを機械的にマージするのでも、すべてを止めるのでもなく、更新の内容の事実を基に 1 件ずつ判断する。

- CI が必須チェックを通っているか。これは最低の条件で、通っていなければマージしない
- `>=1.0` のマイナー・パッチか。semver では後方互換が期待でき、changelog がバグ修正や小さな改善の中心なら、安全とみてよい
- 0.x（<1.0）のマイナー・パッチか。マイナーでも破壊的な変更がありうる。changelog・release notes で、API の変更・削除・挙動の変更があるかを確かめる。判断できなければ、マージせずにユーザーに確認する
- 影響の範囲。runtime の依存か devDependency か、リポジトリの中でどこで使っているか、ビルドやテストに影響するか
- 判断の材料が足りない場合、影響が大きい場合、設計の判断が絡む場合は、承認なしにマージしない。ユーザーに確認する

## 追加確認が必要な条件

次のときは処理を止めて、ユーザーに確認する。

- 現在の repo と、PR の owner・repo が一致しない
- PR の作成者が Dependabot でない
- マージ方式の設定が無く、デフォルト以外を使いたい
- 設定したマージ方式が、リポジトリで許されていない
- 0.x の依存に破壊的な変更があるかを、changelog から判断できない
- 影響が大きい、または判断の材料が足りない
