# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（直近の iteration-34 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 1（`with_skill` だけを 1 run）

## 目的

Issue #565 で、`parity-replace` に、`style_policy: free` の画面のある機能では成果物を作らずに止まる処理を足した。
その分岐を見る eval 26 を新しく足したので、変更確認として `with_skill` だけを 1 run 実行した。`without_skill` と既存の eval は実行していない。
新しく足した eval なので、比べる記録は無い。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 26 | 新規 | 5/5 | - |

run の `skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。

## 観察

- run は、設定の `style_policy` と `metadata.json` の `mode` を読んだ段で止まり、`issue-start`・target の起動・データセットの確認に進まなかった。
- `differ.validated_by_strength_gate` が無いことは、止まった理由ではなく、次の段で止まりうる点として挙げただけだった。`parity-suite` の実行は、`style_policy` を `reproduce` に変える方針の変更（利用者が決める）と組にして示した。
- 応答は、`free` のまま進める選択肢として「`spec-parity` 系で新側を実装・検証する」と書いた。`spec-parity` は新側を実装しないので、この案内は正確でない。新側の実装の分岐は #993 で扱う。
