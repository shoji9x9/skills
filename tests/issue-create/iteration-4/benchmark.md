# Skill Benchmark: issue-create

**Model**: opus（claude-code、reasoning effort high）
**Evals**: 7, 8, 9（Issue #904 で足した eval の変更確認。configuration ごとに 1 run）

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 89% ± 19% | +0.11 |
| Time | 69.7s ± 62.2s | 45.1s ± 12.1s | +24.6s |
| Tokens | 116823 ± 3872 | 112531 ± 46243 | +4292 |

| eval | with_skill | without_skill |
|------|------------|---------------|
| 7（分けた Issue に GitHub の依存関係を設定する） | 4/4 | 4/4 |
| 8（呼び出し元の承認を引き継ぐ） | 3/3 | 2/3 |
| 9（承認の後の変更の境界） | 3/3 | 3/3 |

## 差が出なかった項目

eval 7 は without_skill も 4/4 だった。REST の `dependencies/blocked_by` と、`issue_id` に Issue の `id` を渡すことは、一般の知識で答えられる。
eval 7 は、手順を消したり変えたりしたときの後退の検出のために置く。

eval 8 で差が出たのは 3 つ目の assertion だけである。
without_skill も、同じ実行で承認された下書きの承認を求め直さないと判断した。
引き継がないとき（下書きを変える・見せていない重複が見つかった）に、利用者へ承認を求め直すと書いたのは with_skill だけで、without_skill は呼び出し元へ理由を返すだけだった。

eval 9 は without_skill も 3/3 だった。番号の印の置き換えは承認を変えず、ラベルの変更は承認を変えるという区別は、一般の判断でも答えられる。
eval 9 は、PR #909 のレビューの指摘で足した。引き継ぎの条件を緩めたときの後退の検出のために置く。

## 実行し直した run

eval 8 の最初の run は、prompt のリポジトリが「現在の repo」だった。使い捨ての作業ディレクトリは git リポジトリではないので、with_skill はリポジトリを決められずに止まった。
prompt に `example-org/shop` を書き、ローカルレビューの指摘で直した取り決め（呼び出し元の申告で条件を判断する・重複の確認ができなければ止まる）で、両方の configuration を実行し直した。
eval 7 の with_skill は、ローカルレビューと PR #909 のレビューで依存関係の設定の手順を変えた後に、そのつど実行し直した。eval 7 の without_skill は、prompt が変わらないので最初の run を使った。
