# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

eval 6 の入力（prompt・fixture・assertion 2）を変えたので、変更確認として両方の configuration で 1 run ずつ実行した。
fixture の `setup.sh` が新側を git のリポジトリにし、記録の commit で HEAD が進んだ状態を作る。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | prompt・fixture・assertion 2 | 4/4 | 3/4 | 文が同じ assertion 3 件は前回（iteration-40）と同じ。assertion 2 は文を変えたので比べない |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- 差が出たのは assertion 2 である。`with_skill` は `source-version.mjs` で今の HEAD の完全な SHA を取り、それがデプロイ済みかを確かめるよう求めた。baseline は、デプロイの証拠が無いと述べるだけだった。
- 最初の prompt は「develop にデプロイしたのは今の HEAD」と答えを書いていて、確かめる必要の有無を測れなかった。その run は採点せず、`iteration-41-discarded-prompt-answered` に残した。
