# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #680 で、最終報告の「自分で判断して進めたもの」に 4 つの欄（守っていない規約・速度や反復を理由に直さなかった指摘・Issue にしていない見送り・対象から外した形）と、欄の中の並べ方を足した。
manifest にも同じ欄（`self_decisions` の下の 4 つの名前）を足した。これを測る eval 26 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 26 | 新規 | 6/6 | 4/6 |

## 備考

- without_skill も、prompt が挙げた事実（eval の未実行・直さなかった指摘・Issue にしていない見送り）は報告に載せた。対象から外した形の欄を設けて 0 件と書くことと、欄の中の並べ方は満たさなかった。
- PR のレビューの指摘で `references/orchestration.md` と SKILL.md を直すたびに、with_skill だけをやり直した（6/6 のまま）。without_skill はスキルを読まないので、前の run を使った。
