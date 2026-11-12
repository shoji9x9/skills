# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #995 で、収束の判定（`convergence-check.mjs`）が承認の記録（`approvals`）と操作中のエラーの比較の `tree` を確かめるようにした。
eval 8・9 の fixture の `verify-metadata.json` に `approvals` と `runtime_errors.tree` を足したので、変更確認として 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill（iteration-12） |
| --- | --- | --- | --- | --- |
| 8 | fixture | 7/7 | 6/7 | 7/7（同じ） |
| 9 | fixture | 6/6 | 4/6 | 6/6（同じ） |

すべての run で `isolation.txt` は `sandboxed` で、`without_skill` の汚染の判定は `clean` だった。

## 観察

- eval 8 の with_skill は、承認をもらった後に `design_review`・`human_review` と `approvals` に同じ値を書くと案内した。収束の報告の前に `append-only-check.mjs` と `pending-triage-check.mjs` を通すことにも触れた。
- eval 9 の with_skill も、収束の報告の前の 2 つの確認に触れた。
- without_skill は、どちらの eval でも `convergence-check.mjs` を実行できず、eval 9 では `verify.md` を書かなかった。
- この 4 run の後に、レビューの指摘で `SKILL.md`・`references/` の文面（成果物の表・`strength.md` の `--metadata`・`e2e-runner.md` の実行の例）を直した。判定のスクリプトの変更（古い比較で差し戻しを重ねない、保留の雛形の値）は、この 2 つの eval の結果を変えない。
