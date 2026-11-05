# Skill Benchmark: issue-create

**Model**: opus（claude-code、reasoning effort high）
**Evals**: 7, 8（Issue #904 で足した eval の変更確認。configuration ごとに 1 run）

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 83% ± 24% | +0.17 |
| Time | 59.5s ± 41.9s | 49.3s ± 13.5s | +10.1s |
| Tokens | 129477 ± 11630 | 130418 ± 48551 | -941 |

| eval | with_skill | without_skill |
|------|------------|---------------|
| 7（分けた Issue に GitHub の依存関係を設定する） | 4/4 | 4/4 |
| 8（呼び出し元の承認を引き継ぐ） | 3/3 | 2/3 |

## 差が出なかった項目

eval 7 は without_skill も 4/4 だった。REST の `dependencies/blocked_by` と、`issue_id` に Issue の `id` を渡すことは、一般の知識で答えられる。
eval 7 は、手順を消したり変えたりしたときの後退の検出のために置く。

eval 8 で差が出たのは 3 つ目の assertion だけである。
without_skill も、同じ実行で承認された下書きの承認を求め直さないと判断した。
引き継がないとき（下書きを変える・見せていない重複が見つかった）に、利用者へ承認を求め直すと書いたのは with_skill だけで、without_skill は呼び出し元へ理由を返すだけだった。

## eval 8 の実行し直し

最初の run は、prompt のリポジトリが「現在の repo」だった。使い捨ての作業ディレクトリは git リポジトリではないので、with_skill はリポジトリを決められずに止まった。
prompt に `example-org/shop` を書き、ローカルレビューの指摘で直した取り決め（呼び出し元の申告で条件を判断する・重複の確認ができなければ止まる）で、両方の configuration を実行し直した。
eval 7 の with_skill も、同じ取り決めの変更（設定済みの組を先に確かめる）の後に実行し直した。eval 7 の without_skill は、prompt が変わらないので最初の run を使った。
