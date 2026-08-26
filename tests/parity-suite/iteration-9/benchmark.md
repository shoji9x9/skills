# Skill Benchmark: parity-suite

**Model**: claude-opus-5 (`--model opus`)
**Date**: 2026-08-26T02:27:08Z
**Evals**: 18, 19 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 80% ± 0% | +0.20 |
| Time | 79.9s ± 39.2s | 79.6s ± 23.3s | +0.3s |
| Tokens | 226693 ± 92318 | 225088 ± 40846 | +1606 |

## 実施範囲

ヘッダの「3 runs each per configuration」は集計スクリプトの定型文。各 configuration **1 run**。
`current.origin: received-assets` 導入に伴う開始ゲートの確認が目的で、eval 18（意味論が確認待ちの機能）と
eval 19（同 fixture・意味論が確定済みの機能＝**陽性コントロール**）の対で測る。
両 run とも `sandboxed`、`without_skill` の汚染判定は `verdict: clean`。

## アナリストパス（所見）

- **eval 19 が意図どおり機能した。** with は「`semantics.md` / `verification.md` に載っているのはすべて `order-list`（Q-2）で、
  `customer-list` の必須意味論は確定している」と切り分けたうえで、停止理由を**現行環境の到達不能**（`current-test` が落ちており
  `pre_commands` / `start` が無い）に置いた。「`received-assets` なら一律停止」「確認待ちが 1 件でもあれば全機能停止」の
  実装ならここで意味論を理由に止まるため、陽性コントロールとして弁別が立っている。
- **baseline との差は 1 本ずつしかない（4/5）。** 落ちたのはどちらも停止判断の質:
  eval 18 では「status 非依存分のみ先行生成しましょうか」と**部分着手の余地を残した**（合否判定基準が確定しない機能で着手しない、という規律になっていない）。
  eval 19 では停止理由を「`parity-suite` スキルの実体が見つからない」に置き、**現行環境への到達不能に触れていない**。
- **残り 3 本（スペックを書いていない・成果物を生成していない・fixture を書き換えていない）は否定形のため baseline も満たす。**
  Delta には寄与しないが、ゲートを外す変更が入れば落ちる**後退検知**として残す。
