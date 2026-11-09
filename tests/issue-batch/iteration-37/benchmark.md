# Skill Benchmark: issue-batch

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #917 の変更確認である。
`references/orchestration.md` の「判断の扱い」に、仮の決定とレビューの指摘を人に回すかは `pr-finalize-loop` の `references/review-response.md` の「人に回すかの基準」を読んで決めることと、読めないときはすべて判断待ちにすることを足した。
`SKILL.md` の安全制約にも、同じ参照を足した。
eval 36 を実行し直し、run が基準の文書を読むかを確かめた。

## 入力の変更

- eval の prompt・fixture・assertion は変えていない。変えたのはスキルの文書だけである

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 36 | 6/6 | 4/6 |

## 前回より下がったものと、その原因

- 無し。比べる記録は iteration-36 の eval 36（1 run）で、assertion ごとの合否は with_skill・without_skill とも同じである

## 基準の文書を読んだか

- with_skill の run は、`pr-finalize-loop` の `references/review-response.md` の「人に回すかの基準」と「PR がまだ無いとき」を読んだ。
  `raw/claude-code.jsonl` の Bash の出力（`is_error` は false）に、両方の節の本文が現れる。`issue-start` の `references/provisional-decisions.md` の「人に回すかの判断」も読んだ。
- 応答も、基準の 1〜3 を当てて振り分けている。fixture の `common.jsonc` に `decision_policy_doc` が無いことを確かめ、プロジェクトの基準は無いと述べた。
- iteration-36 の with_skill は、`issue-batch` の文書だけを読み、安全制約と戻せるかで振り分けていた。
- `result.json` の `skill_usage.files_read` は、対象のスキル（`issue-batch`）の下のパスだけを数える。姉妹スキルの文書を読んだかは、`raw/` で確かめる。

## 気付いたこと

- without_skill は、iteration-36 と同じく、#150 の残りの実装を進めると答え、`continue_on_blocked` の設定も参照しなかった。この 2 本で差が出た。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
