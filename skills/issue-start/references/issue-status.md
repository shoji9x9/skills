# Issue の status を In progress にする

基本フローの step 7 の最後の項で、Issue の status を In progress にする手順と、結果の扱いを定義する。

GitHub は、PR を紐付けると Issue の status を変える（draft の PR なら In progress、open の PR なら In review）。
`gh issue develop` でブランチを紐付けても status は変わらないので、PR を作るまでの間、着手した Issue と着手していない Issue を一覧とボードで区別できない。
そのため、ブランチを用意した時点でこのスキルが In progress にする。In review への変更は GitHub に任せる。

`gh` には status を設定するコマンドが無いので、GraphQL の `setIssueStatus` を `gh api graphql` で呼ぶ。
status の ID はリポジトリごとに違うので、`repository.planningStatuses` から名前（`In progress`）で取得する。
分類（`category.key`）では In progress と In review がどちらも `started` になり区別できないので、名前で選ぶ。
API の形は、GraphQL のスキーマ（`__type` の問い合わせ）と、Issue の status を実際に設定した結果で確かめた。
`setIssueStatus` の説明に public preview と書かれているので、API の形が変わることがある。

## 手順

```bash
# 1. Issue の ID・設定できるか・In progress の ID・今の status・status の一覧に続きがあるかを取得する
#    空の値は "-" にする（タブの区切りが続くと read が欄を詰めるため）
#    owner と repo は -f で渡す。-F は数字だけの名前を整数に変えるので、String! の変数で失敗する
row=$(gh api graphql \
  -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){planningStatuses(first:50){nodes{id name} pageInfo{hasNextPage}} issue(number:$number){id viewerCanSetStatus status{name}}}}' \
  -f owner='<owner>' -f repo='<repo>' -F number='<番号>' \
  --jq '.data.repository as $r | [($r.issue.id // "-"), ($r.issue.viewerCanSetStatus | tostring), (first(($r.planningStatuses.nodes // [])[] | select(.name == "In progress") | .id) // "-"), ($r.issue.status.name // "-"), ($r.planningStatuses.pageInfo.hasNextPage // false)] | @tsv' \
  </dev/null) || { echo "status を設定しなかった: status の API を使えない（planningStatuses が無い GHES・通信の失敗など）" >&2; exit 1; }
IFS=$'\t' read -r issue_id can_set target_id current has_next <<<"$row"

# 2. 設定できないリポジトリと、In progress の status が無いリポジトリでは設定しない
#    status の一覧は 50 件で打ち切る。続きがあって In progress が見つからないときは、次のページを取得せずに設定しない
if [ "$can_set" != true ] || [ "$target_id" = - ]; then
  echo "status を設定しなかった: viewerCanSetStatus=$can_set・In progress の ID=$target_id・一覧の続き=$has_next" >&2
  exit 1
fi

# 3. 今の status で分ける。In progress なら何もしない。In review・Done などから戻さない
case "$current" in
  'In progress') echo "status は既に In progress"; exit 0 ;;
  - | Backlog | Todo) ;;
  *) echo "status を設定しなかった: 今の status が $current なので In progress に戻さない" >&2; exit 1 ;;
esac

# 4. 設定し、応答の status で確かめる
after=$(gh api graphql \
  -f query='mutation($issue:ID!,$status:ID!){setIssueStatus(input:{issueId:$issue,statusId:$status}){issue{status{name}}}}' \
  -f issue="$issue_id" -f status="$target_id" --jq '.data.setIssueStatus.issue.status.name // "-"' </dev/null) \
  || { echo "status を設定できなかった: setIssueStatus が失敗した" >&2; exit 1; }
if [ "$after" = 'In progress' ]; then
  echo "status を $current から In progress にした"
else
  echo "status を設定できなかった: 設定した後の status が $after" >&2
  exit 1
fi
```

worktree に入った後は、この手順をファイルを書くツールでスクリプトにし、`bash <絶対パス>` で実行する。
手順はコマンド置換・`||`・`case` を含むので、`git-worktree` の `references/isolation.md`「隔離中の Bash は 1 コマンドずつ素の形で書く」に当たる。

GitHub Enterprise Server では、`gh api` に `--hostname <ホスト名>` を付ける。付けないと github.com に問い合わせるので、1 の取得が失敗する。

| 終了コード | 観測 | 扱い |
| --- | --- | --- |
| 0 | In progress にした。または既に In progress だった | そのまま続ける |
| 1 | 設定しなかった（status を使えない・今の status が In review や Done など・API の呼び出しが失敗した）。理由は stderr の 1 行 | 設定せずに続け、設定しなかったことと stderr の理由を利用者に伝える |

- **どちらの終了コードでも、ブランチの作成と後の手順を止めない。** status は一覧とボードに着手を示す補助であり、作業の結果を左右しないからである。
- 1 のときは、設定しなかったことを `--branch-only` の報告や最終報告に書く。利用者に伝えられない呼び出し元（無人の実行）は、記録に残す。
