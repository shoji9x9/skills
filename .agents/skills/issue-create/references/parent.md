# 親の Issue に紐付ける

`--parent <番号>` を指定されたときに、作った Issue を、指定された Issue の sub-issue にする手順。
依頼を分けたときは、分けた Issue をすべて同じ親の sub-issue にする。
`--parent` が無ければ、親の Issue を作らず、紐付けもしない。

## 起票の前に確かめる

- 手順 1 で、親の Issue を対象のリポジトリから取得する（`gh issue view <番号> --repo <owner>/<repo> --json number,title,state`）。
  取得できなければ（番号の誤り・別のリポジトリの Issue など）、下書きを作る前に止めて利用者に確かめる。
  以降の手順には、指定された文字列（`#120` や URL のこともある）ではなく、取得した `number` を親の番号として渡す。
- 下書きを確かめるときに、「#<親の番号>（<親のタイトル>）の sub-issue にする」ことも見せる。
  親が closed なら、そのことも添えて、紐付けてよいかを同じ確認で確かめる。

## 起票した後に紐付ける

API は REST の sub-issues である（<https://docs.github.com/en/rest/issues/sub-issues>）。
`sub_issue_id` には Issue の番号ではなく、Issue の `id`（整数）を渡す。

紐付けるのは、起票した後である。依頼を分けたときは、`split.md` の「GitHub の依存関係を設定する」を終えてから紐付ける。
作った Issue ごとに、次の 3 つを順に行う。

1. 子の Issue の親を取得する（`issues/<子の番号>/parent`）。
   - 親のリポジトリと番号が指定と同じなら、設定済みとしてこの Issue を終える。番号だけで比べると、別のリポジトリにある同じ番号の親を設定済みとして扱ってしまう。同じ組をもう一度足すと、API は 422 を返す（実測）。
   - 別の親が付いていれば、置き換えずに（`replace_parent` を使わずに）この Issue を終え、付いていた親の番号を報告に入れる。親を付け替えるかは利用者が決める。
   - 親が無いと、API は 404 と `No parent issue found` を返す。このときだけ 2 に進む。ほかの失敗は、親が無いこととして扱わない。
2. 子の Issue の `id` を取得し、空でない整数であることを確かめてから、親の Issue に足す。`-F` は値を整数として送る。
3. 子の Issue の親をもう一度取得し、指定したリポジトリと番号であることを確かめる。

次の関数は、Issue を 1 つ受け取り、紐付けられなかったら応答を標準エラーに出して 0 以外を返す。
`set -e` の下でも、`if` の条件の中で呼ぶので、失敗で止まらない。

```bash
add_sub_issue() {  # $1: 親の番号、$2: 子の番号
  local repo='<owner>/<repo>' current child_id resp err
  local parent_jq='(.repository_url | sub(".*/repos/"; "") | ascii_downcase) + "#" + (.number | tostring)'
  local want="${repo,,}#$1"  # GitHub のリポジトリ名は大文字と小文字を区別しないので、両辺を小文字で比べる
  err=$(mktemp)
  # 標準出力だけを比べる。gh が成功したときに標準エラーへ出す通知を、親の値に含めない
  if current=$(gh api "repos/$repo/issues/$2/parent" --jq "$parent_jq" 2>"$err"); then
    if [ "$current" != "$want" ]; then
      echo "#$2: 別の親 $current が付いているので置き換えない" >&2; rm -f "$err"; return 1
    fi
    rm -f "$err"; return 0
  elif ! grep -q 'No parent issue found' "$err"; then
    echo "#$2: 親を取得できない: $(cat "$err")" >&2; rm -f "$err"; return 1
  fi
  if ! child_id=$(gh api "repos/$repo/issues/$2" --jq .id 2>"$err") || ! [[ $child_id =~ ^[0-9]+$ ]]; then
    echo "#$2: id を取得できない: $child_id $(cat "$err")" >&2; rm -f "$err"; return 1
  fi
  if ! resp=$(gh api -X POST "repos/$repo/issues/$1/sub_issues" -F "sub_issue_id=$child_id" 2>&1); then
    echo "#$2: 紐付けに失敗: $resp" >&2; rm -f "$err"; return 1
  fi
  if ! current=$(gh api "repos/$repo/issues/$2/parent" --jq "$parent_jq" 2>"$err") || [ "$current" != "$want" ]; then
    echo "#$2: 紐付けた後の親が #$1 でない: $current $(cat "$err")" >&2; rm -f "$err"; return 1
  fi
  rm -f "$err"
}

failed=()
if ! add_sub_issue <親の番号> <作った Issue の番号>; then failed+=("#<作った Issue の番号>"); fi
# 作った Issue の数だけ繰り返す
```

1 件の失敗で、残りの Issue の紐付けを止めない。紐付けられなかった Issue があっても、起票した Issue は消さない。
最後に、紐付けられなかった Issue と、関数が標準エラーに出した応答を利用者に伝える。
親と子のリポジトリの持ち主が違う場合、sub-issues の機能が使えない場合、書き込みの権限が無い場合に起きる。
