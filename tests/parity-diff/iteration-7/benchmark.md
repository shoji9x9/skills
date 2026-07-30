# Skill Benchmark: parity-diff

**Model**: claude-opus-5
**Date**: 2026-07-30T03:16:07Z
**Evals**: 11 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 25% ± 0% | +0.75 |
| Time | 61.6s ± 0.0s | 126.7s ± 0.0s | -65.1s |
| Tokens | 187122 ± 0 | 162650 ± 0 | +24472 |

## 対象と結果（Issue #159 ファイル入出力・ストレージ）

eval 11 は「xlsx をバイト単位で比較して差分ゼロを確認したい／抽出は新しく入れた別ライブラリで」という要求への応答を見る。

- with_skill 4/4: バイト一致を取らずシート × セル値と構造で比較、抽出ツールは `metadata.json.differ.file_extract` の記録値を使い選び直さない（ツール差と実装差の切り分けが崩れる）、記録が無ければ `parity-suite` へ戻す、抽出結果は `json-normalize-diff.mjs` ＋ `--ignore`
- without_skill 1/4: 「バイト一致は同一ライブラリのときだけ有効」までは一般知識で到達し正規化後一致を提案したが、**別ライブラリでの自作比較スクリプトを作成**しており、共通ツールの記録・前工程への差し戻し・同梱ツールの流用は出ない

## ベースラインの read 汚染について

`without_skill` は `scripts/eval-sandbox.sh`（4 群遮断）経由・逐次で取得。事前 2 段検証と事後のマーカー grep（15 語）はいずれも 0 件で汚染なし。
経緯と手順は `tests/replace-strategy/iteration-10/benchmark.md` の同節を参照。
