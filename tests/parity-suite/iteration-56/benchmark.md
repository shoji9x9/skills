# Skill Benchmark: parity-suite

**Model**: claude-code / opus / high（直近の iteration-55 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 3（`with_skill` を 1 run ずつ）

## 目的

新側のバージョンの照合を、`new.commit` から `.replace/` を除いたソースのツリーのハッシュ（`new.tree`）に変えた（Issue #998）。
`artifact-health-check.mjs`・`component-comparison-check.mjs` の照合と、`references/coverage.md`・突き合わせ表の雛形を変えたので、それらを扱う eval 39・40・42 を変更確認として `with_skill` で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 39 | 無し（スキルの文書とスクリプト） | 7/7 | 前回（iteration-50）と同じ |
| 40 | 無し（スキルの文書とスクリプト） | 7/7 | 前回（iteration-51）と同じ |
| 42 | 無し（スキルの文書とスクリプト） | 5/7 | 前回（iteration-50）pass の assertion 1 件が fail。もう 1 件は前回も fail |

すべての run で `isolation.txt` は `sandboxed` だった。

## 観察

- eval 42 の新しい fail は、突き合わせの証拠の 3 点が揃うまで突き合わせ済みにしない、と述べなかったことである。`coverage.md` のその文は今回変えていない。応答は `new_implementation.tree` と `new.tree` の一致には正しく触れた。
- 1 run どうしの比較で、回帰かばらつきかは区別できない。eval 42 の 3 run の実行を残りの作業に挙げる。
