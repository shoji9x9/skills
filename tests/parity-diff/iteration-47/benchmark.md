# Skill Benchmark: parity-diff

**Model**: claude-code / opus / high
**Date**: 2026-11-14
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #1018 で足した eval 31 の 3 run である。iteration-46 の 1 run の変更確認に続けて、分散を測った。

## Summary

| eval | with_skill（run-1・run-2・run-3） | without_skill（run-1・run-2・run-3） |
| --- | --- | --- |
| 31 | 6/6・6/6・6/6 | 5/6・5/6・6/6 |

すべての run で `invalid_run` は false だった。`with_skill` は 3 run とも `skill_usage.read` が true で、`without_skill` の `contamination.txt` は 3 run とも `clean` だった。
6 run とも、`diff.md` と `diff-metadata.json` は fixture と同じ内容のままだった（`cmp` で確かめた）。

## assertion ごとの結果

| assertion（要約） | with_skill | without_skill |
| --- | --- | --- |
| 1. desktop の領域ごとに save-button と名前なしを区別する | 3/3 | 3/3 |
| 2. 新側の traits.json が無い組で、名前と重ならない領域を名前なしと断定しない | 3/3 | 1/3 |
| 3. 現側の traits.json の status-badge を対応づける | 3/3 | 3/3 |
| 4. ID 6 を領域に結べなかった行として挙げる | 3/3 | 3/3 |
| 5. ページを承認の記録にしない | 3/3 | 3/3 |
| 6. diff.md と diff-metadata.json を書き換えない | 3/3 | 3/3 |

差が出たのは assertion 2 だけである。`without_skill` の run-1 と run-2 は、mobile の組の帯の領域を「要素なし」と断定した。
run-3 は表では「該当する要素なし」としたが、注意の節で「新側に何か要素があるのかも確かめられない」と述べたので pass にした。

assertion 1・3・4・5・6 は、`without_skill` も 3 run とも満たした。これらは後退の検知のためのもので、Delta に寄与しない。
`without_skill` は、座標の重なりを自分で計算し、`crops.json` に無い ID 6 を自分で見つけ、ページを承認の記録にしないと自分で答えた。
