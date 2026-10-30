# 書き方の形を指す指摘を、PR の差分全体で探す

レビューの指摘が特定の行の誤りではなく書き方の形（規則の違反・単位の書き方など）を指すなら、直す前に、同じ形を PR の差分で足した行全体で探す。
指摘された行だけを直すと、同じ形の箇所が次のレビューで指摘され、往復が増える。

このファイルは、pr-finalize-loop と pr-review-handle が同じ内容で持つ。片方だけを直さない。

## 差分を取る

次の 2 つのコマンドで差分を取り、`+` の行を探す。2 つは別々に実行し、1 つ目が成功してから 2 つ目を実行する。

```bash
git fetch --no-tags <remote> "+refs/heads/<PR のベースブランチ>:refs/worktree/pr-review/base"
fork_point=$(git merge-base refs/worktree/pr-review/base HEAD) && git diff "$fork_point" -U0
```

- `<remote>` は、PR のベースリポジトリを指す remote である（多くは `origin`。fork から出した PR では `upstream` などのこともある）。
- 取得したベースブランチは、専用の ref（`refs/worktree/pr-review/base`）に置いて比べる。
  手元のベースブランチは古いことがあり、古いベースと比べると PR に無い行まで差分に入る。
  `<remote>/<PR のベースブランチ>` は、remote に設定した refspec にそのブランチが含まれないと更新されない。`FETCH_HEAD` は、別の fetch で書き換わる。
- `refs/worktree/` の下の ref は worktree の間で共有されないので、別の worktree で同じ手順を実行しても取り合わない（<https://git-scm.com/docs/git-worktree> の REFS の節）。
- 1 つ目が 0 以外で終わったら、`git fetch` が失敗している（remote の名前の誤り・認証切れなど）。原因を直してやり直す。
- 2 つ目が何も出さずに 1 で終わったら、`git merge-base` が分岐点を見つけられていない。
  shallow clone（`git rev-parse --is-shallow-repository` が `true`）なら、`git fetch --unshallow <remote>` で履歴を取得してから、2 つのコマンドをやり直す。
  shallow clone でなければ、`<remote>` が PR のベースリポジトリを指すかを `git remote -v` で確かめ、直してからやり直す。
- 2 つ目のコマンドは分岐点と作業ツリーを比べるので、まだ commit していない修正の行と、まだ push していない commit の行も探す対象に入る。
  `git diff refs/worktree/pr-review/base...HEAD` のように HEAD までの commit だけを比べるコマンドでは、まだ commit していない修正の行が対象に入らない。
- まだ commit していない新しいファイル（前の指摘で作ったものなど）は、`git add -N <path>` で登録するまで、この差分に入らない。
  PR に入れないファイルを登録したら、探した後に `git reset -- <path>` で登録を戻す。
- 探し終えたとき、途中で止めたときのどちらも、`git update-ref -d refs/worktree/pr-review/base` で ref を消す（ref が無ければ何もしない）。

## 見つかった行を扱う

- 作業ツリーに PR に入れない変更があれば、その行も差分に入るので、見つかった行から外す。
- 整形（折り返し・空白）だけで変わった行も `+` の行に入る。その行に前からある問題は PR の範囲の外なので、まとめて直す対象から外す。
- 探す語は、レビューが示した語や箇所に限らず、形を表す語に広げる（時間の単位なら「秒」「分」「前後」「約」）。
  広げた語は別の意味の語（「部分」の「分」など）にも当たるので、見つかった行を 1 件ずつ読み、同じ形のものだけをまとめて直す。
- 返信には、探した語・見つかった件数・直した件数を書く。
