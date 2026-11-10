# Skill Benchmark: box

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #952 で、eval 2・3 の assertion が Box API の公開の使い方だけを検査していて、スキルを使わない run も満たすという指摘を直した。
`box-token.sh` でのトークンの取得と、Authorization ヘッダーをファイルに書いて `-H @<ファイル>` で渡し、トークンを curl の引数に載せないことを足した。
eval 2 からは、どこでも満たす Bearer ヘッダーの assertion を消した。

入力が変わったのは eval 2・3（assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | assertion | 5/5 | 1/5 | 記録なし |
| 3 | assertion | 7/7 | 1/7 | 記録なし |

eval 2・3 は、これより前の iteration に結果が無いので、比べる記録は無い。

## without_skill が満たした assertion

- eval 2: 「`https://api.box.com/2.0/files/123456/content` を叩いている」。URL は公開の API なので、スキルが無くても書ける。
- eval 3: 「トークンを curl の引数に載せていない」。without_skill は curl を使わず Box CLI を案内したので、否定形の条件を満たした。
  スキルの有無は、同じ eval の「ヘッダーをファイルに書いて `-H @<ファイル>` で渡している」で区別する。

## 実行し直した run

なし。
