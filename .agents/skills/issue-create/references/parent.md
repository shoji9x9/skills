# 親の Issue に紐付ける

`--parent <番号>` を指定されたときに、作った Issue を、指定された Issue の sub-issue にする手順。
依頼を分けたときは、分けた Issue をすべて同じ親の sub-issue にする。
`--parent` が無ければ、親の Issue を作らず、紐付けもしない。

## 起票の前に確かめる

- `--parent` には、対象のリポジトリの Issue の番号を渡す（先頭の `#` は付けてよい）。URL は受け付けない。
  `gh issue view` は別のリポジトリの URL を渡すと `--repo` を無視してそのリポジトリから取得するので、URL を受け付けると別の Issue を親にしうる（実測）。
- 次の `parent_issue` で、親を対象のリポジトリから取得する。
  GraphQL の `issue(number:)` は、対象のリポジトリの Issue だけを返し、PR の番号と無い番号にはエラーを返す（実測）。
  先頭に 0 の付いた番号と、`<owner>/<repo>` の大文字と小文字の違いも受け付ける（実測）。
  番号でない値（全角の数字を含む）と、取得できない番号（PR の番号を含む）は、下書きを作る前に止めて利用者に確かめる。

  ```bash
  parent_issue() {  # $1: --parent の値。成功したら「親の id<TAB>親の番号<TAB>状態<TAB>URL」を出力する
    local repo='<owner>/<repo>' n got err pid pnum
    local LC_ALL=C  # [0-9] を ASCII の数字だけにする。UTF-8 のロケールでは全角の数字にも一致する
    n=${1#\#}
    case $n in '' | *[!0-9]*) echo "--parent は Issue の番号で渡す: $1" >&2; return 1 ;; esac
    err=$(mktemp) || { echo "一時ファイルを作れない" >&2; return 1; }
    if ! got=$(gh api graphql -F owner="${repo%%/*}" -F name="${repo#*/}" -F number="$((10#$n))" \
      -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { databaseId number state url } } }' \
      --jq '.data.repository.issue | [(.databaseId | tostring), (.number | tostring), .state, .url] | @tsv' 2>"$err"); then
      echo "#$n: 親を取得できない: $(cat "$err")" >&2; rm -f "$err"; return 1
    fi
    rm -f "$err"
    IFS=$'\t' read -r pid pnum _ <<<"$got"
    if ! [[ $pid =~ ^[0-9]+$ && $pnum =~ ^[0-9]+$ ]]; then echo "#$n: 親の id か番号を読めない: $got" >&2; return 1; fi
    printf '%s\n' "$got"
  }
  ```

  下書きの確認で見せるタイトルは、出力した番号で別に取得する（`gh issue view <親の番号> --repo <owner>/<repo> --json title`）。
  タブ区切りの出力にタイトルを入れると、タイトルの `\` やタブがエスケープされた形で見える。

- 下書きを確かめるときに、「#<親の番号>（<親のタイトル>）の sub-issue にする」ことも見せる。
  親が closed なら、そのことも添えて、紐付けてよいかを同じ確認で確かめる。

## 起票した後に紐付ける

API は REST の sub-issues である（<https://docs.github.com/en/rest/issues/sub-issues>）。
`sub_issue_id` には Issue の番号ではなく、Issue の `id`（整数）を渡す。

紐付けるのは、起票した後である。依頼を分けたときは、`split.md` の「GitHub の依存関係を設定する」を終えてから紐付ける。
作った Issue ごとに、次の 3 つを順に行う。

1. 子の Issue の親を取得する（`issues/<子の番号>/parent`）。
   - 親の `id` が、`parent_issue` で取得し直した親の `id` と同じなら、設定済みとしてこの Issue を終える。同じ組をもう一度足すと、API は 422 を返す（実測）。
   - 別の親が付いていれば、置き換えずに（`replace_parent` を使わずに）この Issue を終え、付いていた親の URL を報告に入れる。親は同じ持ち主の別のリポジトリにも置けるので、番号だけでは伝えない。親を付け替えるかは利用者が決める。
   - 親が無いと、API は 404 と `No parent issue found` を返す。このときだけ 2 に進む。ほかの失敗は、親が無いこととして扱わない。
2. 子の Issue の `id` を取得し、空でない整数であることを確かめてから、親の Issue に足す。`-F` は値を整数として送る。
3. 子の Issue の親をもう一度取得し、親の `id` が同じであることを確かめる。

次の関数は、`--parent` の値と作った Issue の番号を受け取り、紐付けられなかったら応答を標準エラーに出して 0 以外を返す。
親の `id` は、関数の中で `parent_issue` を呼んで取得する。前の呼び出しの出力から `id` を書き写さない。
`set -e` の下でも、`if` の条件の中で呼ぶので、失敗で止まらない。

```bash
add_sub_issue() {  # $1: --parent の値、$2: 子の番号。parent_issue を先に定義しておく
  local repo='<owner>/<repo>' parent pid pnum current child_id resp err
  parent=$(parent_issue "$1") || return 1
  IFS=$'\t' read -r pid pnum _ <<<"$parent"
  err=$(mktemp) || { echo "#$2: 一時ファイルを作れない" >&2; return 1; }
  # 標準出力だけを比べる。gh が成功したときに標準エラーへ出す通知を、親の値に含めない
  if current=$(gh api "repos/$repo/issues/$2/parent" --jq '[(.id | tostring), .html_url] | @tsv' 2>"$err"); then
    rm -f "$err"
    if [ "${current%%$'\t'*}" != "$pid" ]; then
      echo "#$2: 別の親 ${current#*$'\t'} が付いているので置き換えない" >&2; return 1
    fi
    return 0
  elif ! grep -q 'No parent issue found' "$err"; then
    echo "#$2: 親を取得できない: $(cat "$err")" >&2; rm -f "$err"; return 1
  fi
  if ! child_id=$(gh api "repos/$repo/issues/$2" --jq .id 2>"$err") || ! [[ $child_id =~ ^[0-9]+$ ]]; then
    echo "#$2: id を取得できない: $child_id $(cat "$err")" >&2; rm -f "$err"; return 1
  fi
  if ! resp=$(gh api -X POST "repos/$repo/issues/$pnum/sub_issues" -F "sub_issue_id=$child_id" 2>&1); then
    echo "#$2: 紐付けに失敗: $resp" >&2; rm -f "$err"; return 1
  fi
  if ! current=$(gh api "repos/$repo/issues/$2/parent" --jq '.id | tostring' 2>"$err") || [ "$current" != "$pid" ]; then
    echo "#$2: 紐付けた後の親が #$pnum でない（親の id: $current）$(cat "$err")" >&2; rm -f "$err"; return 1
  fi
  rm -f "$err"
}

failed=()
if ! add_sub_issue <--parent の値> <作った Issue の番号>; then failed+=("#<作った Issue の番号>"); fi
# 作った Issue の数だけ繰り返す
```

1 件の失敗で、残りの Issue の紐付けを止めない。紐付けられなかった Issue があっても、起票した Issue は消さない。
最後に、紐付けられなかった Issue と、関数が標準エラーに出した応答を利用者に伝える。
親と子のリポジトリの持ち主が違う場合、sub-issues の機能が使えない場合、書き込みの権限が無い場合に起きる。
