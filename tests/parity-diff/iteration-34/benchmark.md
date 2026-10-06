# Skill Benchmark: parity-diff

**Model**: claude-code / opus（CLI 2.1.289 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 27（`with_skill` 1 run）

## 何を変えたか

Issue #372 段階 ④-b で、parity-diff の文章を書き方の規約に合わせて書き直した（4b506877）。規則・条件・手順は変えていない。
description の語（差分器・強度ゲート・3 経路）も直した。assertion は変えていない。

## Summary

`with_skill` の平均 pass_rate は 0.973。前回から下がったのは 6（4/5）・7（5/6）・16（4/5）・26（5/6）。

## 読み取れたこと

- 6・7 は origin/main のスキルでも同じ assertion で落ちた（ばらつき）。
- 16 は書き換え前の run だけが「回帰を抱えたまま収束する」危険を答えた。書き換えで「偽陰性」の語と太字の強調が消えていたので、normalize.md に戻した。
- 26 は書き換え後の run が triage.md を開かなかった。探し方の違いで、ばらつきの見込み。prompt が使う「本経路」は、使わない語なので本文から消えている。
- 3 並列の実行では 4 run がスキルを読まなかった。1 本ずつ順に実行し直すと 3 run が読んだので差し替え、読まなかった 9 は外した。
  書き換え前のスキルでは 1 本ずつ順の実行で 4 件中 2 件が読んだ。description の変更でスキルが選ばれにくくなった根拠は無い。
