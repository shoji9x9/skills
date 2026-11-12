# Skill Benchmark: replace-strategy

**Model**: claude-code / opus / high（直近の iteration-55 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` を 1 run ずつ）

## 目的

新側のバージョンの照合を、`new.commit` から `.replace/` を除いたソースのツリーのハッシュ（`new.tree`）に変えた（Issue #998）。
`references/project-config.md`「新側のバージョンの記録」を書き換え、eval 6・43 の fixture（`status-multi-target`・`status-style-free`）の記録に `new.tree` を足したので、変更確認として `with_skill` で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 6 | fixture | 5/5 | 前回（iteration-52、3 run）と比べて下がった assertion は無い |
| 43 | fixture | 6/6 | 前回（iteration-55）と同じ |

すべての run で `isolation.txt` は `sandboxed` だった。
run の後に、`project-config.md` の括弧書き 1 か所から時期に依る言い方を消した。規則は変えていない。
