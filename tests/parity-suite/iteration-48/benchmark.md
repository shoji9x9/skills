# Skill Benchmark: parity-suite

**Model**: claude-code / opus（CLI 2.1.289 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 3（`with_skill` / `without_skill` 各 1 run）

## 何を変えたか

Issue #372 段階 ④-b で、36・43・44 の assertion の語を新しい語（網羅表・強度チェック・差分ツール）に直した。入力が変わったので両方の configuration を実行した。

## Summary

| eval | with_skill | without_skill |
|---|---|---|
| 36 | 7/7 | 3/7 |
| 43 | 4/5 | 4/5 |
| 44 | 6/6 | 3/6 |

`without_skill` の `contamination.txt` はすべて `clean`。

## 読み取れたこと

- 36・44 はスキルの有無の差が残っている。
- 43 は差が消えた（前回は 1.0 と 0.6）。`without_skill` もオリジンの判断と測り直しまで答えた。
  `with_skill` は差分ツールが「無い」どうしを一致とみなす点（A5）を落とし、origin/main のスキルでも同じ A5 で落ちた。
