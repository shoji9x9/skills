# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` を 1 run）

## 何を変えたか

iteration-17（b66f1179 の版）の後、PR #695 のレビューを受けて、4 つの欄の項目の書き方を直した。
複数の Issue に当たる判断は番号をすべて書く。4 つ目の欄は、外すこと（`waived`）か別の作業に回すこと（`deferred`）に承認を得た形を載せ、preflight で Issue ごと外した `EXCLUDED` は載せない。
直さなかったローカルレビューの指摘を記録する取り決めは、「ローカルレビュー」の節の 1 か所にした。
eval 27 の assertion は変えず、1453ff99 の版で with_skill だけを実行し直した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 27 | なし | 6/6 | 実行していない（iteration-16 では 4/6） |

## 備考

- with_skill は iteration-16・17 と同じく 6/6 で、項目の書き方を直した後も下がっていない。
- この run の後の commit は、承認を得た形を利用者の決定として `approval.ref`・`tracked_in` 付きで欄の最後に並べることと、SKILL.md にその 1 文を足すことだけである。
  eval 27 の場面には承認を得た形が無く、結論は変わらないので、実行し直していない。
