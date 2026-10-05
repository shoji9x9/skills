# PR の持ち主の確認

自分が PR の作成者（`author`）でも担当者（`assignees`）でもないときは、commit・push・レビュースレッドの resolve の前に利用者へ確認する。
同じリポジトリを複数の開発者が使い、それぞれがエージェントを動かしていると、他の人の PR に push したり、他の人が対応中のスレッドを resolve したりすることがあるためである。
レビュアーとして返信するだけなら、確認は要らない。返信は PR の作業を奪わないからである。

`pr-review-handle` と `pr-finalize-loop` は同じ判定を使う。このファイルは、両スキルに同じ内容で同梱している。
いつ判定するかは各スキルの `SKILL.md` が定める。どちらも、修正・resolve・push の前に 1 回判定する。

## 判定

```bash
me=$(gh api user --jq .login </dev/null)
[ -n "$me" ] || { echo '判定不能: 自分の login を取得できない（ユーザーでないトークンの可能性）' >&2; exit 1; }
owners=$(gh pr view <番号> --repo <owner>/<repo> --json author,assignees --jq '.author.login, .assignees[].login' </dev/null) \
  || { echo '判定不能: PR の作成者・担当者を取得できない' >&2; exit 1; }
if printf '%s\n' "$owners" | grep -qxF -- "$me"; then
  echo "owner: ${me}"
else
  echo "not-owner: me=${me} owners=$(printf '%s' "$owners" | tr '\n' ',')"
fi
```

- `owner`: 自分が作成者か担当者に含まれる。確認せずに進めてよい。
- `not-owner`: 作成者と担当者を示して、利用者に確認する。選べる扱いは各スキルの `SKILL.md` が定める。
- 取得に失敗したときは、`not-owner` とも `owner` とも判定しない。`me` が空のときと、`gh pr view` が 0 以外で終了したときは、判定できないとして止まる。
- `me` を取得できないのは、ユーザーでないトークン（GitHub App のインストールトークンや Actions の `GITHUB_TOKEN`）で認証していることが多い。
  [Endpoints available for GitHub App installation access tokens](https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-installation-access-tokens) に `GET /user` は載っていない。
  持ち主を判定できないので、判定を飛ばして続けるか中止するかを利用者に確認する。
- 利用者が続けると決めたら、その実行の間は確認を繰り返さない。同じ PR への 2 回目以降の push や resolve のたびに聞き直さない。
- PR に自分を担当者として割り当てない。持ち主を変える操作は利用者が決める。
