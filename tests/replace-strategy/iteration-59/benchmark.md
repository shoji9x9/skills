# Skill Benchmark: replace-strategy

**Model**: claude-code / opus / high
**Date**: 2026-11-16
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #1051 で足した eval 44 の変更確認である。
eval 44 では、現行が記録の後に進んだときに、`replace-strategy status` がそのことを報告するかを確かめる。
新しく足した eval なので、比べる前回の記録は無い。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 44 | 5/5 | 4/5 |

## assertion ごとの合否

| assertion | with_skill | without_skill |
| --- | --- | --- |
| 1. 現行が進んだ機能として挙げ、持ち越しか再取得が要ると報告する | pass | pass |
| 2. 記録の後の commit を挙げる | pass | pass |
| 3. 同梱の `source-version.mjs` の `--compare` で照合する | pass | fail |
| 4. local-dev の収束を理由に切り替えてよいと結論しない | pass | pass |
| 5. fixture と current-app を書き換えない | pass | pass |

## 差が出なかった assertion

without_skill は、fixture の `current-app` の git の履歴と `setup.sh` を読み、現行が進んだことと記録の後の commit を自分で見つけた。
`setup.sh` のコメントは、記録が 1 つ目の commit を指していることを述べている。
そのため assertion 1・2・4 は差が出ず、後退の検出のための assertion になっている。
差が出たのは assertion 3 だけで、これは記録と照合するための取り決め（`--compare`）を使ったかを見る。
