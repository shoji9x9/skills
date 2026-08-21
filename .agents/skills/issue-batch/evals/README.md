# issue-batch の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じ fixture・同じモデル条件で実行する。

```bash
scripts/run-skill-eval.sh \
  --skill issue-batch \
  --prompt '<evals.json の該当 eval の prompt>' \
  --config with_skill \
  --fixture skills/issue-batch/evals/fixtures/<fixture名> \
  --out tests/issue-batch/iteration-N/eval-<id>/with_skill/run-1
```

`--fixture` は `evals.json` の当該 eval に `fixture` がある場合だけ付ける。`--config without_skill` でベースラインを同様に実行する。

`evals.json` の `id` が `tests/issue-batch/iteration-N/eval-<id>/` に対応する。集計とビューアの手順は `docs/skill-development.md` を正本とする。

## 前提

- fixture は入力状態だけを持つ。判定・分類・あるべき置き場所を書かない（ベースラインが読んで assertion を満たすと Delta が消える）。
- 外部 GitHub 状態より先の工程は、実操作ではなく dry-run の最終報告として 1 つのメッセージに収めさせる（`result.json` には最終アシスタントメッセージしか残らない）。
