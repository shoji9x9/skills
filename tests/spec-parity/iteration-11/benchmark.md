# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-10 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #993 で `parity-replace` が `style_policy: free` の画面のある機能を扱うようにしたので、`spec-parity` の verify から「`parity-replace` が `free` で止まると定めているか」を確かめる分岐を消し、同じ `--target` の `parity-replace` を案内・差し戻す形にした。
この分岐を見ていた eval 6・9 の assertion を書き換えたので、変更確認として両方の configuration で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | assertion 2 | 3/3 | 1/3 | 文が同じ assertion 1・3 は前回（iteration-4）も pass |
| 9 | assertion 3 | 6/6 | 4/6 | 文が同じ assertion 1・2・4・5・6 は前回（iteration-10）も pass |

書き換えた assertion は文が変わったので、前回と比べない。すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- eval 6: `with_skill` は `suite.new_green: false` で止まり、同じ target の `parity-replace` を案内した。baseline はスキルが無いことを止まる理由にし、`parity-replace` を案内しなかった。
- eval 9: baseline も `parity-replace` へ差し戻すとした（assertion 3 は差が出ない）。差が出たのは、`convergence-check.mjs` で判定すること（assertion 1）と、`verify.md` に差し戻す内容を書くこと（assertion 4）である。
