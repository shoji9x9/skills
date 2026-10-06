# Skill Benchmark: replace-strategy

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 37（`with_skill` 1 run）

## 何を変えたか

Issue #372 段階 ④-c で、replace-strategy の文章を書き方の規約に合わせて書き直した（1af3c8fd）。規則・条件・手順は変えていない。
description の語（入口）と、静的資産の台帳の方針の値（「実体を写す」→「実体をコピーする」、「写さない」→「コピーしない」）を直した。
`asset-delivery-check.mjs` は旧い値も読み替えて受け付ける。assertion は変えていない。

## Summary

`with_skill` の平均 pass_rate は 0.979。前回から下がったのは 14（4/5）・21（4/5）・24（5/6）。

## 読み取れたこと

- 14・21・24 は origin/main のスキルでも同じ assertion で落ちた（ばらつき）。
- 16 は 2 回ともスキルを読まなかった（`invalid_run`）。origin/main のスキルでも 2 回とも読まなかったので、description の変更によるものではない。iteration から外した。
- 19 は 1 回目にスキルを読まなかった。書き換え後のスキルで 2 回実行し直すと、2 回とも読んだ（origin/main でも 2 回とも読んだ）。読んだ run に差し替えた。
- 30・31 の assertion は旧い語（未被覆・配線未達）のままで、応答の新しい語（未対応・呼び出し未達）と意味で照合して採点した。evals の語の置き換えは段階 ⑤ で行う。
