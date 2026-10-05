# 担当者の確認と割り当て

着手する Issue の担当者（assignee）を確かめ、空なら自分を割り当てて、読み直す。基本フローの step 5 の最初に、ブランチを作る前、または既存のブランチに入る前に行う。

`--plan` と `--branch-only` を含むすべてのモードで行う（`--acceptance` は除く）。
step 8 の現状の確認より前に行うので、後で実装済みと分かる Issue にも自分が付く。そのときは、Issue を閉じるかを相談するときに、担当者の扱いも添える。

同じリポジトリを複数の開発者（それぞれがエージェントを動かす）で使うと、相手が着手したことを知る手段は担当者だけになる。
**割り当てるだけでは排他にならない。** GitHub は担当者を複数付けられるので、「空なら自分を割り当てる」を 2 人が同時に行うと、両方が成功する。
そのため、割り当てた後に読み直し、自分以外も付いていたら止まる（3 段目）。

## 手順

```bash
# 1 の確認で利用者が続行を選んだら、1 で示した login を改行区切りで入れて最初から実行し直す（既定は空）
acked=''
me=$(gh api user --jq .login </dev/null)
[ -n "$me" ] || { echo '判定不能: 自分の login を取得できない（ユーザーでないトークンの可能性）' >&2; exit 1; }
# me と acked を除いた担当者を返す（全行が除かれた grep の終了コード 1 は該当なしなので吸収する。pipefail 下でも落ちない）
others_of() {
  printf '%s\n' "$1" | { grep -vxF -- "$me" || true; } \
    | if [ -n "$acked" ]; then { grep -vxF -f <(printf '%s\n' "$acked") || true; }; else cat; fi | sed '/^$/d'
}

# 1. 担当者を確かめる
assignees=$(gh issue view <番号> --repo <owner>/<repo> --json assignees --jq '.assignees[].login' </dev/null) \
  || { echo '判定不能: 担当者を取得できない' >&2; exit 1; }
others=$(others_of "$assignees")
if [ -n "$others" ]; then
  # 割り当てずにここで止まり、利用者に確認する（続行が選ばれたら、示した login を acked に入れて実行し直す）
  echo "自分以外の担当者が付いている: $(printf '%s' "$others" | tr '\n' ',')" >&2
  exit 2
fi

# 2. 自分が付いていなければ割り当てる
if ! printf '%s\n' "$assignees" | grep -qxF -- "$me"; then
  gh issue edit <番号> --repo <owner>/<repo> --add-assignee @me </dev/null
fi

# 3. 読み直す
assignees=$(gh issue view <番号> --repo <owner>/<repo> --json assignees --jq '.assignees[].login' </dev/null) \
  || { echo '判定不能: 担当者を読み直せない' >&2; exit 1; }
printf '%s\n' "$assignees" | grep -qxF -- "$me" \
  || { echo '割り当てが成立していない（権限不足等）' >&2; exit 1; }
others=$(others_of "$assignees")
# others が空でなければ（acked で承知済みの login は除いてある）、止まって自分を外すかを利用者に確認する
```

| 観測 | 扱い |
| --- | --- |
| 1 で `others` が空でない | 他の開発者が着手している可能性がある。割り当てず、ブランチも作らずに止まる。担当者の login を示して、続けるか中止するかを利用者に確認する |
| 1 で自分だけが付いている | 2 を飛ばして、3 に進む（`--add-assignee` は何度送っても同じ結果になるが、送らない） |
| 3 で自分が付いていない | 割り当てができていない（権限が足りないなど）。`gh issue edit` の終了コードが 0 でも合格として扱わず、止まって利用者に確認する |
| 3 で `others` が空でない | 2 人が同時に 2 を通った。止まって担当者の login を示し、自分を外すか（`gh issue edit <番号> --repo <owner>/<repo> --remove-assignee @me`）を利用者に確認する。外すかどうかを自分で決めない |
| 3 で自分だけが付いている | 着手してよい。step 5 の残り（同じ番号のブランチの確認）に進む |

- **取得の失敗を「担当者なし」として扱わない。** `me` が空のときや、`gh issue view` が 0 以外で終わったときは、判定できないとして止まる。空の担当者の一覧と区別できないからである。
- `me` を取得できないのは、ユーザーでないトークン（GitHub App のインストールトークンや、Actions の `GITHUB_TOKEN`）で認証している場合が多い。
  [Endpoints available for GitHub App installation access tokens](https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-installation-access-tokens) に `GET /user` は無い。
  この環境では担当者による排他が成り立たない。担当者の確認を飛ばして続けるか、中止するかを利用者に確認する（無人の実行では、その Issue を止めて理由を残す）。
- 利用者が 1 の確認で続けると選んだ場合も、自分を割り当てて 3 で読み直す（この後に確認する相手に、自分が着手したことを知らせるため）。
  1 で示した login を `acked` に入れて最初から実行し直すと、1 と 3 はその login を除いて判定する。
  3 で止まるのは、承知済みの担当者以外が増えていたときだけになり、同じ確認を繰り返さない。
- 利用者に確認できない呼び出し元（無人の実行）は、確認の代わりにその Issue を止め、理由と担当者の login を残す。自分を外す操作は、無人では行わない。
