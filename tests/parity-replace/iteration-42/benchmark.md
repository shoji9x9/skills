# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1001 のレビューで、eval 6 と eval 29 の fixture の `setup.sh` を直した（コメントから結論を消し、`setup.sh` と設定も commit して作業ツリーを clean にし、`sed -i` をやめた）。
eval 6 は、2 つのことを主張していた assertion 2 を 2 本に分け、prompt に「develop で動いている commit は確かめていません」を足した。
入力が変わったので、変更確認として両方の configuration で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | prompt・fixture・assertion | 5/5 | 4/5 | 文が同じ assertion 3 件は前回（iteration-41）と同じ。分けた 2 本は新しい assertion |
| 29 | fixture | 5/5 | 4/5 | 前回（iteration-38）と同じ |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- eval 6 で差が出たのは、確かめる値の assertion である。`with_skill` は完全な SHA を答えてもらい、`source-version.mjs --rev` で tree を取って比べると述べた。baseline は tree を比べると述べただけだった。
- eval 6 の「どの commit かをユーザーに確認する」は、baseline も満たした。後退の検出のための assertion である。
- eval 29 の差は、前回と同じく `source-version.mjs` で tree を取る assertion だけである。
