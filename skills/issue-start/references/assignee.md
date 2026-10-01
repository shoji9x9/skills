# 担当者の確認と割り当て

着手する Issue の担当者（assignee）を確かめ、空なら自分を割り当て、読み直す。基本フロー step 5 の先頭で、ブランチを作る・既存ブランチへ入る前に行う。

`--plan` / `--branch-only` を含む全モードで行う（`--acceptance` を除く）。step 8 の現状検証より前なので、実装済みと後で分かる Issue にも自分が付く——そのときは Issue のクローズを相談する際に担当者の扱いも添える。

同じリポジトリを複数の開発者（それぞれがエージェントを動かす）で使うと、相手が着手したことを知る手段は担当者だけになる。
**割り当てるだけでは排他にならない**——GitHub は担当者を複数付けられるので、「空なら自分を割り当てる」を 2 人が同時に行うと両方が成功する。
だから割り当ての後に読み直し、自分以外も付いていたら止まる（3 段目）。

## 手順

```bash
me=$(gh api user --jq .login </dev/null)
[ -n "$me" ] || { echo '判定不能: 自分の login を取得できない' >&2; exit 1; }

# 1. 担当者を確かめる
assignees=$(gh issue view <番号> --repo <owner>/<repo> --json assignees --jq '.assignees[].login' </dev/null) \
  || { echo '判定不能: 担当者を取得できない' >&2; exit 1; }
others=$(printf '%s\n' "$assignees" | grep -vxF -- "$me" | sed '/^$/d')
if [ -n "$others" ]; then
  # 割り当てずにここで止まり、利用者に確認する（続行が選ばれたら 2 から再開する）
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
others=$(printf '%s\n' "$assignees" | grep -vxF -- "$me" | sed '/^$/d')
# others が空でなければ（1 で続行が選ばれていたなら、1 で示した login 以外が増えていれば）、止まって自分を外すかを利用者に確認する
```

| 観測 | 扱い |
| --- | --- |
| 1 で `others` が空でない | 他の開発者が着手している可能性がある。**割り当てず・ブランチも作らずに止まり**、担当者の login を示して利用者に確認する（続行・中止） |
| 1 で自分だけが付いている | 2 を飛ばして（`--add-assignee` は冪等だが送らない）3 へ進む |
| 3 で自分が付いていない | 割り当てが成立していない（権限不足等）。`gh issue edit` の終了コードが 0 でも合格に倒さず、止まって利用者に確認する |
| 3 で `others` が空でない | 2 人が同時に 2 を通った。**止まって**担当者の login を示し、自分を外すか（`gh issue edit <番号> --repo <owner>/<repo> --remove-assignee @me`）を利用者に確認する。外すかどうかを自分で決めない |
| 3 で自分だけが付いている | 着手してよい。step 5 の残り（同番号ブランチの確認）へ進む |

- **取得の失敗を「担当者なし」に倒さない。** `me` が空、`gh issue view` が非 0 のときは判定不能として止まる（空の担当者一覧と区別できないため）。
- 利用者が 1 の確認で続行を選んだ場合も、自分を割り当てて 3 で読み直す（以降の確認相手に自分の着手を知らせるため）。
  このとき 3 で止まるのは、1 で示した login 以外の担当者が増えていたときだけにする（1 で承知済みの担当者で同じ確認を繰り返さない）。
- 利用者に確認できない呼び出し元（無人実行）は、確認の代わりにその Issue を止めて理由と担当者の login を残す。自分を外す操作は無人で行わない。
