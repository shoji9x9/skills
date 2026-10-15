# Skill Benchmark: replace-strategy

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-15
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #614 で、evals.json の assertion の全角ダッシュを 2 つ続けた記号（U+2014 の連続）を書き換えた（意味を変えない表記の変更）。
入力が変わったのは eval 30・31・34 である。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 30 | assertion | 6/7 | 2/7 | 6/7（iteration-48） |
| 31 | assertion | 5/5 | 4/5 | 5/5（iteration-48） |
| 34 | assertion | 5/5 | 1/5 | 5/5（iteration-47） |

with_skill の平均 pass_rate は 0.95、without_skill は 0.43。

## 前回から変わった assertion

- `with_skill` は、どの eval も変わっていない。
  eval 30 の 6 行目（受け入れ条件の列の書き分け）は、iteration-48 と同じく F である。
  report の列が「#103（未対応: /report, GET /api/reports）」で、引き受けた Issue 番号だけになっていない。
  eval 31 で見ている部分の突き合わせを、ページと API を名前で書いていない eval 30 の受け入れ条件にも当てている。
- eval 34 の `without_skill` の 5 行目（確定は後の工程で、人が keep / may_change へ移す）が、iteration-41 の P から F になった。
  「実測完了時に判断」とだけあり、人が移すことと棚卸しに載ることに触れていない。この行は今回の変更で文が変わっている。

## 差が消えた assertion

この run で `without_skill` も満たした assertion は次のとおりである。1 run の結果なので、確定ではない。

- eval 30: 1 行目、3 行目。
- eval 31: 1〜4 行目。iteration-48 と同じである。
- eval 34: 1 行目（未実測の 2 件を pending に置く）。

差が残ったのは、eval 30 の 2・4〜7 行目、eval 31 の 5 行目、eval 34 の 2〜5 行目である。

## 集計から外したもの

- 無し
