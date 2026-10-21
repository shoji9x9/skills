# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #733 で、Claude Code のローカルレビューを、commit してから merge-base からの範囲を `/code-review` に渡す形にした。
最後のローカルレビューの後に生じた変更は、最後にレビューした範囲の終わりから HEAD までをレビューし、Kaizen の学びと Hook が足す記録は PR のレビューに任せる。
eval 29 の prompt と assertion をこの手順に合わせた。入力が変わったのはこの eval だけである。
run の前に、assertion と prompt の対応をサブエージェントにレビューさせ、指摘 2 件（学びのレビューの工程を prompt で問う、束ねた assertion を分ける）を反映してから実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | prompt と assertion | 10/10 | 8/10 | iteration-26 で 7/7（assertion が違う） |

without_skill は、レビューの範囲をレビューの出力に出たファイルと commit の数で確かめると答え、レビューした側の記録の `git diff` では確かめなかった。
Kaizen の学びの commit も push の前にローカルレビューにかけると答えた。

書き換え前の取り決めが残っていると eval 29 が落ちることを確かめるため、main の版の `skills/issue-batch` で with_skill を 1 run 実行した。結果は 4/10 だった。
commit していない差分と branch を別々にレビューすると答え、範囲を渡す 2 本・push 済みの commit を同じ範囲でレビューする・記録の `git diff` で確かめる・学びを PR に任せる・README の範囲の 6 本で落ちた。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し。run の後のレビューで、学びの assertion を「学びの commit だけを対象にするローカルレビューは行わない」に言い換えた。prompt は変えていないので、同じ回答を言い換えた assertion で採点し直し、判定は変わらなかった
