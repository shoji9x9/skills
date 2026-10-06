# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.289 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 2（`with_skill` / `without_skill` 各 1 run）

## 何を変えたか

Issue #372 段階 ④-b で、8・9 の assertion の語を新しい語に直した。入力が変わったので両方の configuration を実行した。

## Summary

| eval | with_skill | without_skill |
|---|---|---|
| 8 | 10/11 | 5/11 |
| 9 | 11/11 | 3/11 |

`without_skill` の `contamination.txt` はすべて `clean`。

## 読み取れたこと

- どちらもスキルの有無の差が残っている。
- 8 の `with_skill` が落とした A4（2 回の時系列が食い違ったら採り直す）は、前回の iteration-12 でも落ちている。
