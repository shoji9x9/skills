# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（直近の iteration-11 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 3（`with_skill` を 1 run ずつ）

## 目的

新側のバージョンの照合を、`new.commit` から `.replace/` を除いたソースのツリーのハッシュ（`new.tree`）に変えた（Issue #998）。
eval 6・8・9 の fixture（`verify-not-green`・`verify-unapproved`・`verify-overflow`）の記録に `new.tree` と各記録の `tree` を足し、`convergence-check.mjs` の照合を `new.tree` に変えたので、変更確認として `with_skill` で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 6 | fixture | 3/3 | 文が同じ assertion 3 件は前回（iteration-11）も pass |
| 8 | fixture | 7/7 | 文が同じ assertion 7 件は前回（iteration-10）も pass |
| 9 | fixture | 6/6 | 文が同じ assertion 6 件は前回（iteration-11）も pass |

すべての run で `isolation.txt` は `sandboxed` だった。下がった assertion は無い。
run の後に、`convergence-check.mjs` のメッセージ 2 か所と `SKILL.md`・`references/convergence.md` の括弧書きから、時期に依る言い方を消した。判定と手順は変えていない。
