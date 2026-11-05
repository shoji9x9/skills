# Skill Benchmark: issue-batch

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #901 の変更確認である。
PR #896 で「仮に決めたこと」の節と、仮の決定を人に回すかの判断を足した。
人に回すかの基準を読める場面で振り分けを確かめる eval 36 と、仮の決定が 0 件の場面を確かめる eval 37 を足して実行した。

## 入力の変更

- eval 36 を足した。`requires_skills` に `issue-start` と `pr-finalize-loop` を置き、基準を読める状態にする
- eval 37 を足した。`requires_skills` に `issue-start` を置く

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 36 | 6/6 | 4/6 |
| 37 | 3/3 | 1/3 |

## 前回より下がったものと、その原因

- 無し（eval 36 と eval 37 は新規なので、比べる記録は無い）

## 気付いたこと

- eval 36 の without_skill は、戻せない決定を判断待ちとして記録するところまで答えたが、#150 の残りの実装を進めると答えた。`continue_on_blocked` の設定も参照しなかった。この 2 本で差が出た。
- eval 36 の with_skill は、`issue-batch` の文書だけを読み、`issue-start` の `references/provisional-decisions.md` と `pr-finalize-loop` の `references/review-response.md` を読まなかった。
  人に回すかを、`issue-batch` の安全制約（データの削除をしない）と戻せるかで決めた。結論は基準と同じだが、基準の原本を読む手順を踏んでいない。
  `references/orchestration.md` は `provisional-decisions.md` を「仮に決めたこと」の節の書き方としてだけ挙げ、人に回すかを決めるときに読むとは書いていない。
- eval 37 の without_skill は、反復の上限で直さなかった指摘を節に載せ、「無い」と書かなかった。`requires_skills` の `issue-start` は読まなかった。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
