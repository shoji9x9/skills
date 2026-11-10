# issue-create の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。

```bash
scripts/eval/run/run-skill-eval.sh \
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
  REST の `dependencies/blocked_by` に Issue の `id` を渡すこと、設定した後に一覧で確かめること、設定できなかったときに本文の依存の節を残して伝えることを、assertion が 1 つずつ検査する。
  ベースラインもこの API を知っていて全項目を通るので、どの assertion も Delta には寄与しない。手順を消したり変えたりしたときの後退の検出のために置く。
- eval 8 は、呼び出し元が承認を得た下書きを任されたときの取り決め（`references/caller-approval.md`）を検査する。
  同じ実行で承認された下書きの承認を求め直さないことと、重複の確認ができなければ止まることは、一般的な判断でも答えられるので、1 つ目と 2 つ目の assertion は後退の検出のために置く。
  差が出るのは 3 つ目の assertion で、引き継がないとき（下書きを変える・見せていない重複が見つかった）に利用者へ承認を求め直すかを区別する。
- eval 9 は、承認の後に呼び出し元が下書きを変えたときの境界（番号の印の置き換えは承認を変えない・ラベルの変更は承認を変える）を検査する。
  ベースラインも一般の判断で全項目を通るので、どの assertion も Delta には寄与しない。引き継ぎの条件を緩めたときの後退の検出のために置く。
- eval 10 は、`--parent` で作った Issue を既存の Issue の sub-issue にする手順（`references/parent.md`）を検査する。
  ベースラインも sub-issue の API と、別の親を置き換えない判断を知っていて、全項目を通る。どの assertion も Delta には寄与しない。
  紐付けた後の確認は、子の親を取得する方法と、親の sub-issue の一覧を取得する方法のどちらでも通る。
  手順を消したり変えたりしたときの後退の検出のために置く。
