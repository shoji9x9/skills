# Skill Benchmark: parity-diff

**Model**: claude-code / opus / high
**Date**: 2026-11-14
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #1018 で足した eval 31（画素の差分の領域に論理名を対応づける手順と、承認する人が見る HTML のレポート）の変更確認である。
新しく足した eval なので、比べる前の記録は無い。続けて iteration-47 で 3 run を実行する。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 31 | 6/6 | 5/6 |

両方の run で `invalid_run` は false だった。`with_skill` は `skill_usage.read` が true で、`references/detect.md` と `references/triage.md` を読んだ。
`without_skill` の `contamination.txt` は `clean` だった。

## assertion ごとの結果

| assertion（要約） | with_skill | without_skill |
| --- | --- | --- |
| 1. desktop の領域ごとに save-button と名前なしを区別する | pass | pass |
| 2. 新側の traits.json が無い組で、名前と重ならない領域を名前なしと断定しない | pass | fail |
| 3. 現側の traits.json の status-badge を対応づける | pass | pass |
| 4. ID 6 を領域に結べなかった行として挙げる | pass | pass |
| 5. ページを承認の記録にしない | pass | pass |
| 6. diff.md と diff-metadata.json を書き換えない | pass | pass |

差が出たのは assertion 2 だけである。`without_skill` は、mobile の組の帯の領域を「traits を採った対象の外にある線や帯」として、名前の無い要素の差と断定した。
新側の traits.json が無いことは、ID 3 の確からしさにだけ当てていた。`with_skill` は `region-names.mjs` の `unknown` を根拠に「判定できない」とした。

assertion 1・3・4・5・6 は、`without_skill` も自力で満たした。座標の重なりを自分で計算し、`crops.json` に無い ID 6 を見つけ、ページを承認の記録にしないと答えた。
1 run では分散を測れないので、これらが後退の検知のためのものかは iteration-47 の 3 run で決める。
