# Skill Benchmark: agent-usage

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-20
**Evals**: 3（`with_skill` と `without_skill` を 3 run ずつ）

## 何を測ったか

Issue #690 で、eval 1・2・3 を benchmark の範囲（3 run × 2 config）で実行した。
Issue #633・#657・#675 の後の変更確認（1 run）では `benchmark.json` を残しておらず、eval 1・2 の with_skill で落ちた項目が、変更で下がったのかを比べられなかった。
eval の入力（prompt・fixture・assertion）は変えていない。

## Summary

| eval | with_skill（run-1 / run-2 / run-3） | without_skill（run-1 / run-2 / run-3） | 前回の with_skill |
| --- | --- | --- | --- |
| 1 | 6/6・6/6・6/6 | 2/6・2/6・2/6 | 4/5（変更確認、記録なし。assertion は 5 本の版） |
| 2 | 4/5・5/5・4/5 | 0/5・0/5・0/5 | 4/5、実行し直して 5/5（変更確認、記録なし） |
| 3 | 4/4・4/4・4/4 | 0/4・0/4・0/4 | 4/4（iteration-3） |

with_skill の平均 pass_rate は 0.96（標準偏差 0.09）、without_skill は 0.11（標準偏差 0.17）。

「前回の with_skill」の eval 1・2 は、commit していない手元の変更確認の run（harness `run-skill-eval/4`）を採点した値である。
eval 1 は、その後に `defaultDecision` の assertion が足されたので、assertion の数が違う。

## with_skill で満たさなかった assertion

- eval 2「gh が無い・認証できない・取得に失敗した期間も判定不能になり、collect の出力に失敗した段が出ると説明している」: 3 run のうち 2 run（run-1・run-3）で落ちた。
  前回の変更確認でも、2 run のうち 1 run が同じ理由で落ちている。Issue #690 で決めた基準では、3 run のうち 2 回以上落ちた項目は、後退か常に落ちるものとして扱い、原因を書く。この項目は 2 回落ちたので、基準に従って後退かどうかを判断し、原因を書く。後退ではない（理由は下に書く）。5 run のうち 2 run は通っているので、毎回落ちるわけではなく、落ちやすい項目である。
  前回の変更確認も #633・#657・#675 の変更の後の版を測ったので、変更の前の版の記録は無い。
  ただし、落ちた理由に当たる SKILL.md の文（下の引用）は、#633・#657・#675 で変えていない。そのため、この 3 つの変更による後退ではないと判断する。
  落ちた run は、判定不能になることと、collect の出力に「GitHub の取得に失敗」と出ることは書いたが、出力に失敗した段の名前が出ることは書かず、段は記録の `coverage` 行で見ると答えた。
  SKILL.md は「失敗した段は collect の出力に『GitHub の取得に失敗』として出る」と書き、段の名前が出力に出ることをはっきり書いていない。
  assertion も、判定不能になることと出力に段が出ることの 2 つを 1 本で主張している。

前回の変更確認で eval 1 の with_skill が落とした「利用者に確かめられない無人の実行では、記録しない側を選ばずに止まって報告すると答えている」は、3 run すべてで通った。前回の失敗はばらつきとして扱う。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
