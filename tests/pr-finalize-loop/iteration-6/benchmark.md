# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-14
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #623 で、人の判断が要る指摘を利用者に確認せず判断待ちとして残す `--defer-decisions` を足した。
これを測る eval 20 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 20 | 新規 | 8/8 | 6/8 |

## 備考

- PR レビューの指摘で「HEAD が再レビューされてから止める」assertion を足し、eval 20 をやり直した。
- without_skill はフラグの名前（`--defer-decisions`）から判断待ちの扱いを推測できたが、A を返信してから解決すること、再レビューを確かめてから止めることは満たさなかった。
- without_skill は止まった理由の名前を「推測」と断っており、with_skill は「判断待ちで終了」とスキルの語で答えた。
