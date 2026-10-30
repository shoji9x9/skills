# git-worktree の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。

```bash
scripts/eval/run-skill-eval.sh \
  --skill git-worktree \
  --prompt '<evals.json の該当 eval の prompt>' \
  --config with_skill \
  --out tests/git-worktree/iteration-N/eval-<id>/with_skill/run-1
```

`--config without_skill` でベースラインを同様に実行する。
`evals.json` の `id` が `tests/git-worktree/iteration-N/eval-<id>/` に対応する。
集計とビューアの手順は `docs/skill-development.md` にある。

## 前提

- 全 eval が dry-run（説明のみ）で完結する。worktree を実際に作成・削除させない。
- assertion は「実測でしか分からない挙動」を検査対象にしている（運搬が新規作成時だけ実行されること、リンク越しに書けること、末尾スラッシュ付き `rm -rf` の挙動）。
  一般論で当たる表現へ緩めるとベースラインが通り Delta が消える。
- prompt は誘導的な yes/no 質問（安全だと念押しする、足せば解決するかを聞く）を含む。
  誤った前提を肯定するベースラインと区別するためなので、prompt 側に答えを書かない。
- eval 12（リモートが無いリポジトリ）は、branch を `git worktree add -b` で作らせないことと、squash で取り込んだ branch を `-D` で消さずに残すことで区別する。
  ほかの 5 本（`--not main` で確かめる・`--merged` で確かめる・`-d` で消す・`push --delete` をしない・実行しない）は git の一般の知識で答えられるので、without_skill も pass する。
  それぞれの読み替えが手順から消えた後退を検出するために置く。
