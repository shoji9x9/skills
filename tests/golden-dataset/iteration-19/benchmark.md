# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 22（`with_skill` 1 run）

## 何を変えたか

Issue #372 段階 ④-c で、golden-dataset の文章を書き方の規約に合わせて書き直した（1af3c8fd）。規則・条件・手順は変えていない。
description の語（写像）も直した。`predicate-coverage-check.mjs` が、新しい見出し「述語ごとの分岐網羅」と旧い見出しの両方を読むようにした。assertion は変えていない。

## Summary

`with_skill` の平均 pass_rate は 0.913。前回から下がったのは 8（4/9）・10（3/4）・13（3/5）・16（2/3）。

## 読み取れたこと

- 8 は同梱の `predicate-coverage-check.mjs` が、fixture の features.md に対して exit 2 になって止まった。origin/main のスクリプトでも同じく exit 2 になるので、④-c の変更によるものではない。
- 10・13・16 は origin/main のスキルでも同じ assertion で落ちた（ばらつき）。
  13 の「bootstrap/seed.sh を流用しない」は origin/main の run だけが合格したので、禁止事項 13 の見出しの太字を戻した。両方の版で、前提スキルが無いことで早く止まっている。
- 19 は、書き換えで phase-b.md の「帰属不明」が「どこから来たかが分からなく」に変わり、意味が出所の側にずれていた。
  run はその文面をなぞって落ちた。「帰属不明」に戻し、直した版で取り直した run（6/6）に差し替えた。
