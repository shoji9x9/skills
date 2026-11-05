# issue-create の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。

```bash
scripts/eval/run-skill-eval.sh \
  --skill issue-create \
  --prompt '<evals.json の該当 eval の prompt>' \
  --config with_skill \
  --out tests/issue-create/iteration-N/eval-<id>/with_skill/run-1
```

`--config without_skill` でベースラインを同様に実行する。
`evals.json` の `id` が `tests/issue-create/iteration-N/eval-<id>/` に対応する。
集計とビューアの手順は `docs/skill-development.md` にある。

## 前提

- 実行の環境は `gh` の認証を読めるので、eval から実際に Issue を作れてしまう。
  `GH_TOKEN` に無効な値を渡して実行し、prompt でも GitHub への書き込みを禁じる。
  `gh` の読み取り（重複の確認）も失敗するので、エージェントは確かめられなかったことを伝える形になる。
- eval 6 は、大きな依頼を分ける手順と、分けた Issue の依存の書き方を検査する。
  スキル固有の取り決めは、依存の節を番号で書き、前提にされる側から起票する順にすることで、2 つ目の assertion がこれを検査する。
  - 次の 3 つの assertion は、後退の検出のために置く。一般的な判断でも答えられるので、ベースラインも通り、Delta には寄与しない。
    - 機能ごとに分ける（層ごとに分けない）
    - 全件の下書きをまとめて 1 回で見せ、承認の前に起票しない
    - 既に実装されていないかを確かめたか、確かめられなかったことを伝える
- eval 7 は、分けて起票した Issue に GitHub の依存関係（blocked by）を設定する手順を検査する。
  スキル固有の取り決めは、REST の `dependencies/blocked_by` に Issue の番号ではなく `id` を渡すことと、設定した後に一覧を取得して確かめることで、2 つ目と 3 つ目の assertion がこれを検査する。
  依存関係を設定できなかったときに本文の依存の節を残して伝えることは、4 つ目の assertion が検査する。
- eval 8 は、呼び出し元が承認を得た下書きを任されたときに、同じ内容の承認を求め直さない取り決め（`references/caller-approval.md`）を検査する。
  利用者が不在の prompt なので、取り決めを知らない run は承認を求めて止まる。1 つ目の assertion がこれを区別する。
  重複の確認を省かないことは、一般的な判断でも答えられるので、2 つ目の assertion は後退の検出のために置く。
