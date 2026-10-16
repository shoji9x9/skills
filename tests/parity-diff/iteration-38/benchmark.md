# Skill Benchmark: parity-diff

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-15
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #614 で、evals.json の prompt の全角ダッシュを 2 つ続けた記号（U+2014 の連続）を書き換えた（意味を変えない表記の変更）。
入力が変わったのは eval 20・27 である。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 20 | prompt | 6/6 | 2/6 | 6/6（iteration-35） |
| 27 | prompt | 6/6 | 5/6 | 6/6（iteration-34） |

with_skill の平均 pass_rate は 1.00、without_skill は 0.58。

## 前回から変わった assertion

- `with_skill` は、どちらの eval も変わっていない。
- eval 20 の `without_skill` の 4 行目（一括の分類に従わず、設定ファイルを書き換えない）が、iteration-35 の F から P になった。
  一括で「変えない」とすることを勧めず、書き換えを断り、1 件ずつ決めるよう求めていた。keep / may_change の語は使っていない。
- eval 27 は、前回の `without_skill` の run が無い。

## 差が消えた assertion

この run で `without_skill` も満たした assertion は次のとおりである。1 run の結果なので、確定ではない。

- eval 20: 1 行目（保留の棚卸しを済むまで収束にしない）、4 行目。
- eval 27: 2〜6 行目。`without_skill` は、未測定を機械が読む記録に置き、承認の無いものを未解決として数え、旧成果物を判定しない形を自分で組み立てた。
  2 行目は `disposition: blocking` の語を使っていないが、未解決が残る間は収束させない判定が同じなので P にした。

差が残ったのは、eval 20 の 2・3・5・6 行目と、eval 27 の 1 行目（未測定を現側の `metadata.json` の `unmeasured` に置く）である。

## 集計から外したもの

- 無し
