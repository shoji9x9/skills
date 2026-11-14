# Skill Benchmark: parity-diff

**Model**: claude-code / opus / high
**Date**: 2026-11-14
**Evals**: 1（`with_skill` を 1 run）

## 目的

PR #1022 のレビューで `region-names.mjs` の引数を変えた後の確認である。
traits.json が無い側を、ファイルが無いことではなく `--current-traits-missing` / `--new-traits-missing` で宣言する形に変えた。
fixture の mobile の組（新側の traits.json が無い）で、エージェントがこの引数に届くかを見た。
`without_skill` は引数の変更の影響を受けないので実行していない。比べる記録は iteration-47 である。

## Summary

| eval | with_skill |
| --- | --- |
| 31 | 6/6 |

`skill_usage.read` は true、`invalid_run` は false だった。mobile の組で `--new-traits-missing` を渡し、`region-names.json` の `traits.new` は `missing`、帯の領域は `unknown` だった。
`diff.md` と `diff-metadata.json` は fixture と同じ内容のままだった（`cmp` で確かめた）。
iteration-47 の `with_skill`（3 run とも 6/6）から、下がった assertion は無い。
