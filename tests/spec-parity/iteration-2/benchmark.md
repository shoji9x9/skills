# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-1 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 4（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 の変更確認である。iteration-1 の後に、verify の前提（green の記録の鍵・`new.dirty`・`new.commit` が `none`）と `convergence-check.mjs` を変え、`verify-metadata.json` に `new.dirty` を足して eval 8・9 の fixture を変えた。
変更が影響する verify の eval（5・6・8・9）だけを、依頼に従って `with_skill` だけで 1 run 実行した。`without_skill` と suite の eval（1〜4・7）は実行していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-1） |
| --- | --- | --- | --- |
| 5 | なし（スキルの本文） | 3/3 | 3/3 |
| 6 | なし（スキルの本文） | 2/3 | 3/3 |
| 8 | fixture（`verify-metadata.json` に `new.dirty: false`） | 7/7 | 7/7 |
| 9 | fixture（`verify-metadata.json` に `new.dirty: false`） | 6/6 | 6/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。

## 下がった assertion

eval 6 の「parity-replace をそのまま実行するよう案内せず、…新側の green を記録する手順が無いことを報告している」が、iteration-1 の pass から fail になった。
run は `parity-replace` の `SKILL.md` を読めないと述べたが、「案内できる状態かはまだ分からない」とし、条件付きで `parity-replace` の実行を案内した。
1 run どうしなので、回帰かばらつきかは区別できない。
ただし、この PR で前提の段落に「同じ `--target` での `parity-replace` を案内する」を先に書き、案内してよい条件を後に置いていたので、スキルの書き方を直した（commit「spec-parity verify の前提で、parity-replace を案内してよい条件を案内の前に書く」）。
直した後の eval 6 の run は iteration-3 にある。
