# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

iteration-13（7854a2dc の版）の後、PR #694 のレビューを受けて、依存の判定を「依存先を閉じたこのリポジトリの PR が base branch に `MERGED` か」に絞った。
SKILL.md では、preflight で止めた Issue の依存元を `continue_on_blocked` に関わらず 6 の表で扱うことと、run の途中で止まった Issue の依存元を続けるときだけ表で扱うことを分けて書いた。
eval 26 が測る場面（未着手の依存元の 2 行と、preflight の `BLOCKED` で run を止めないこと）に関わるので、18423c09 の版で実行し直した。eval の入力は変えていない。
依存の判定そのもの・`continue_on_blocked` が false のときの扱い・`PREFLIGHTED` にする時点は、eval 26 では測っていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 26 | なし | 7/7 | 3/7 |

## 備考

- with_skill は iteration-12・13 と同じく 7/7 で、書き換えの後も下がっていない。
- without_skill は、#108 を外すかを別の質問にし、答えが無いときの #108 を「保留」にして `BLOCKED` の状態を使わなかった。
- without_skill は今回、`--stop-on-blocked` でも #109 を進めた。iteration-13 では止めていたので、この assertion は without_skill でも 1 run ごとに結果が分かれる。
