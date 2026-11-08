# gh を使うときのメモ

調べたことを書き足していく。

- `gh pr view --json` のフィールド名は `gh pr view --json` を引数なしで実行すると一覧が出る。
- ラベルを付けるときは `gh issue edit <番号> --add-label <名前>` を使う。存在しないラベルはエラーになる。
- `gh api` でコメントを投稿するときは、本文を `-F body=@<path>` で渡すとよい。`gh issue comment` の `--body-file` は `gh api` には無いので注意。
- 一覧を取るときは `--paginate` を付ける。
