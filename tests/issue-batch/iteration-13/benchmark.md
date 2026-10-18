# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

iteration-12（3b432da1 の版）の後、PR #694 のレビューを受けて、依存の扱いを書き換えた。
依存元に着手する条件を「依存先の変更が base に入っているか」の 1 つにし、表の行の選び方・外す候補の確認・`continue_on_blocked` の適用範囲をそれにそろえた。
eval 26 はこの扱いを測るので、7854a2dc の版で実行し直した。eval の入力は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 26 | なし | 7/7 | 4/7 |

## 備考

- with_skill は iteration-12 と同じく 7/7 で、書き換えの後も下がっていない。
- without_skill は、#107 を外すと #108 も外れることを同じ問いで示し、#108 を blocked にしたので、iteration-12 の 3/7 より 1 つ多かった。
- without_skill は `--stop-on-blocked` で preflight の時点で run を止め、#109 に着手しなかった。preflight の `BLOCKED` で run を止めない取り決めは、スキル固有のまま区別できている。
