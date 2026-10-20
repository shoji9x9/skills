# Skill Benchmark: kaizen

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-20
**Evals**: 2（`with_skill` と `without_skill` を 3 run ずつ）

## 何を測ったか

Issue #690 で、eval 4・20 を benchmark の範囲（3 run × 2 config）で実行した。
Issue #633・#657・#675 の後の変更確認（1 run）では `benchmark.json` を残していなかった。
eval の入力（prompt・fixture・assertion）は変えていない。

## Summary

| eval | with_skill（run-1 / run-2 / run-3） | without_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 4 | 5/5・5/5・5/5 | 0/5・0/5・0/5（run-1 / run-2 / run-3） | 5/5（iteration-22） |
| 20 | 4/6・4/6・4/6 | 0/6・0/6・1/6（run-2 / run-3 / run-4） | 4/6（iteration-22） |

with_skill の平均 pass_rate は 0.83（標準偏差 0.18）、without_skill は 0.03（標準偏差 0.07）。

iteration-22 は 1 run なので、前回の値は分散を持たない。

## with_skill で満たさなかった assertion

eval 20 の次の 2 項目が、3 run すべてで落ちた。iteration-22 の 1 run でも同じ 2 項目が落ちているので、後退ではなく、常に落ちる項目である。

- 「transcript_path と自セッションの `.kaizen/.extract-checkpoint.<session key>` の間だけを走査し…」:
  どの run も、checkpoint を走査した位置まで進めること・自セッションのセンチネルだけを消すこと・`.extract-done` を作らないことは書いた。走査の範囲（transcript_path と checkpoint の間）は書かなかった。
- 「候補あり、既知 container の未知・欠損 subtype、不正な JSON、読めない transcript、jq 不在、内部 timeout は失敗として扱って kaizen --current を促す」: どの run も、候補あり・形式が分からない・jq が無い・締め切りは挙げた。既知 container の未知・欠損 subtype と読めない transcript は、個別に挙げなかった。

## 実行し直した run

- eval 20 の without_skill の run-1 は `contamination.txt` が `CONTAMINATED`（exit 4）になったので、同じ条件の run-4 を足した。
  run-1 はスキルの下のファイルを読んでいない（`skill_usage.unexpected_read` は false）。
  応答に「`~/.claude.json` にあるファイル名 `kaizen-precommit-gate.sh`」と書いたことで、目印に当たった。サンドボックスの中から `~/.claude.json` を読めるので、スクリプトの名前がそこから baseline に伝わる。

## 集計から外したもの

- `tests/kaizen/iteration-25/eval-20/without_skill/run-1`（上の汚染。`grading.json` を置かず、`--ungraded skip` で外した）
