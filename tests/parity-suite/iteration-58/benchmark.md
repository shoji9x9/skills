# Skill Benchmark: parity-suite

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 1（`with_skill` を 3 run）

## 何を変えたか

Issue #1014 で、eval 42 の assertion「ケースの文面（エクスポート・列のソート）には出てこない欠落であることに触れ、ケース一覧の網羅では拾えないと説明している」を直した。
iteration-50・56・57 の記録を並べると、fail の原因は 2 つあった。

- 括弧の例（エクスポート・列のソート）は prompt に出てこない語で、採点がその語に触れることを求めた。iteration-50 と 56 の with_skill は趣旨を述べていたが、括弧の語に触れないことで fail した。
- iteration-57 の run-2・run-3 は、起点・当たり判定・完了の 3 点を述べたが、ケースの網羅と green では見つからないという理由を述べなかった。
  `references/coverage.md` の節は「ケースの一覧からは見つからない欠落がある」と書くだけで、`unmeasured` 0 や新側のスイートの green と結び付けていなかった。

assertion は「機能は在るが操作を最後まで完了できない欠落は、試験仕様書のケースを網羅しても見つからないと説明している」の 1 つの主張にした。
`references/coverage.md` には、ケースを網羅して `unmeasured` が 0 になり新側のスイートが green になっても欠落は残ることと、新側の評価を答えるときにその理由を添えることを書いた。
eval 42 に `reachability` を書き、`eval-reachability-backlog.json` から消した。prompt は変えていない。

## Summary

| assertion | with_skill（3 run） |
| --- | --- |
| 網羅表の 3 値は移行元側の測定である | 3/3 |
| `unmeasured` 0 を新側の根拠にしない | 3/3 |
| `component-comparison.json` に `present` のセル 1 つにつき 1 行 | 3/3 |
| 起点・当たり判定・完了の 3 点が揃うまで突き合わせ済みにしない | 3/3 |
| 操作を完了できない欠落は試験仕様書のケースを網羅しても見つからない（文を変えた） | 3/3 |
| `present` を `unmeasured` へ落とさない | 3/3 |
| `parity-replace` が書き、`component-comparison-check.mjs` で数え直す | 3/3 |

with_skill は 7/7・7/7・7/7 だった。すべての run で `skill_usage.read` は true、`invalid_run` は false だった。

文を変えた assertion は、前の iteration と比べない。文が同じ 6 本は、iteration-57 でも 3 run のどれかが満たしており、今回は 3 run とも満たした。下がったものは無い。
iteration-57 で 2/3 だった「3 点が揃うまで突き合わせ済みにしない」も、今回は 3/3 だった。

without_skill は、run の数を揃えるために iteration-59 に分けて 1 run 実行した。結果は 3/7 で、書き直した assertion は満たさなかった。

## 実行し直した run

なし。
