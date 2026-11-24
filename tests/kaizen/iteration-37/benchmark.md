# Skill Benchmark: kaizen

**Model**: claude-code / opus
**Date**: 2026-11-24
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 何を変えたか

Issue #1123 の commit の前のレビューで、`references/apply.md` の「ツールの失敗の時点で再発した学び」の表を直した。
一覧を使わない学び（`recurrence-of` が無い・エラーとして返っていない）を先に外し、設定はその後に読むようにした。
設定ファイルも Node.js も無いときを一覧の無いプロジェクトとして扱い、文書が「その種類の失敗で Hook が呼ばれる」と書いているときだけ一覧に足すようにした。
「文面の書き方を選ぶ」の追記は、種類が `規則を破る` のときに「〜しない」の 1 文を足す形だけに絞った。

eval の入力（prompt・fixture・assertion）は変えていない。スキルの文を変えたので、eval 32・33 の `with_skill` を実行し直した。

## Summary

| eval | with_skill | 前回の with_skill（iteration-36） | without_skill（iteration-36） |
| --- | --- | --- | --- |
| 32 | 7/7 | 7/7 | 6/7 |
| 33 | 4/4 | 4/4 | 3/4 |

下がったものは無い。eval 33 の with_skill は、既存の lockfile の規約を「〜しない」の 1 文に置き換えた。

## without_skill

入力が変わっていないので実行せず、iteration-36 の結果と比べた。
iteration-36 の run は推論の強さを指定せずに実行していたので、`--reuse-baseline` の条件を満たさず、この iteration にコピーしていない。

## 実行し直した run

無い。
