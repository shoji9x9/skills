# Skill Benchmark: parity-suite

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 1（`without_skill` を 1 run）

## 目的

Issue #1014 で eval 42 の assertion を書き直したので、`without_skill` を 1 run 実行し、書き直した assertion でスキルの有無の差が残るかを確かめた。
変更の内容と `with_skill` の 3 run は iteration-58 にある。集計は configuration ごとの run の数が揃っている必要があるので、iteration を分けた。

## Summary

| assertion | without_skill（1 run） | with_skill（iteration-58、3 run） |
| --- | --- | --- |
| 網羅表の 3 値は移行元側の測定である | 1/1 | 3/3 |
| `unmeasured` 0 を新側の根拠にしない | 1/1 | 3/3 |
| `component-comparison.json` に `present` のセル 1 つにつき 1 行 | 0/1 | 3/3 |
| 起点・当たり判定・完了の 3 点が揃うまで突き合わせ済みにしない | 0/1 | 3/3 |
| 操作を完了できない欠落は試験仕様書のケースを網羅しても見つからない | 0/1 | 3/3 |
| `present` を `unmeasured` へ落とさない | 1/1 | 3/3 |
| `parity-replace` が書き、`component-comparison-check.mjs` で数え直す | 0/1 | 3/3 |

without_skill は 3/7 だった。満たした 3 本は、iteration-50 の without_skill が満たした 3 本と同じである。
書き直した assertion は満たさなかった。仕様書に載っていない振る舞いと、green は書いたテストが通っただけであることは述べたが、操作を最後まで完了できない種類の欠落には触れなかった。
1 run なので、Delta の値は扱わない。

`contamination.txt` は `clean` だった。

## 実行し直した run

なし。
