# PR の持ち主の確認

PR の作成者（`author`）でも担当者（`assignees`）でもない場合、**commit・push・レビュースレッドの resolve の前に利用者へ確認する**。
同じリポジトリを複数の開発者（それぞれがエージェントを動かす）で使うと、他の人の PR に push する・他の人が対応中のスレッドを
resolve することが起こりうるため。**レビュアーとしての返信だけなら確認は要らない**（返信は PR の作業を奪わない）。

`pr-review-handle` と `pr-finalize-loop` が同じ判定を使う（このファイルは両スキルに同一内容で同梱している）。
判定する時点は各スキルの `SKILL.md` が定める（いずれも修正・resolve・push の前に 1 回）。

## 判定

```bash
me=$(gh api user --jq .login </dev/null)
[ -n "$me" ] || { echo '判定不能: 自分の login を取得できない' >&2; exit 1; }
owners=$(gh pr view <番号> --repo <owner>/<repo> --json author,assignees --jq '.author.login, .assignees[].login' </dev/null) \
  || { echo '判定不能: PR の作成者・担当者を取得できない' >&2; exit 1; }
if printf '%s\n' "$owners" | grep -qxF -- "$me"; then
  echo "owner: ${me}"
else
  echo "not-owner: me=${me} owners=$(printf '%s' "$owners" | tr '\n' ',')"
fi
```

- `owner`: 自分が作成者か担当者に含まれる。確認なしで進めてよい。
- `not-owner`: 作成者と担当者を示して利用者に確認する。選べる扱いは各スキルの `SKILL.md` が定める。
- **取得の失敗を `not-owner` にも `owner` にも倒さない。** `me` が空、`gh pr view` が非 0 のときは判定不能として止まる。
- 利用者が続行を選んだら、その実行の間は確認を繰り返さない（同じ PR への 2 回目以降の push・resolve ごとに聞き直さない）。
- PR に自分を担当者として割り当てない（持ち主を変える操作は利用者が決める）。
