# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #839 の PR #841 で、`SKILL.md` の「ポーリングと待機」に、承認などを待つジョブ（`waiting`・`requested`・`pending`）の 30 分の上限を足した。
wait timer の終わる時刻までは上限の時間に数えず、上限を超えたら「行き詰まり」で止まって、run の ID・ジョブの名前・状態・待った時間を報告する。

PR のレビューで、この分岐を確かめる eval が無いと指摘されたので、eval 23 を足した。
eval 23 は、wait timer 20 分と reviewers を持つ environment を待つジョブについて、10:35 と 10:55 の判断を説明させる dry-run である。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 23 | 新規 | 7/7 | 3/7 |

eval 23 は新しい eval なので、比べる記録は無い。

## 差が出た assertion

without_skill は、上限の時間という考えを持たず、2 回続けて変化が無いことを止める根拠にした。
次の 4 本で差が出た。

- wait timer が終わる 10:20 までの待ちを、上限の時間に数えない
- 待つ上限を 30 分とし、10:55 の時点で上限を超えたと判断する
- 10:55 で止まる理由を「行き詰まり」とする
- 報告に待った時間を書く

## 区別できない assertion

10:35 で待ち続ける・environment と reviewers を報告する・実行しない、の 3 本は、場面の説明から推測できるので without_skill も pass する。
それぞれ、上限の前に止める扱いへ戻った後退、報告から待っている相手が消えた後退、説明に留める指示が消えた後退を検出するために置く。
