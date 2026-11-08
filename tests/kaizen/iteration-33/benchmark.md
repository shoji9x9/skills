# Skill Benchmark: kaizen

**Model**: claude-code / opus（reasoning effort high）
**Date**: 2026-11-08
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #950 の 4 回目のローカルのレビューの指摘に対応した後の変更確認である。
apply は、`## 既存の規約` の節が無い学びに Step 1 で照合を当てて表の扱いまで決め（ファイルには書かない）、Step 3 の行に合流させる作りに変えた。
eval 29 の入力は変えていないが、この作りの変更が eval 29 の通る分岐を変えるので実行し直した。

## 入力の変更

- 無し（eval 29 の prompt・fixture・assertion は iteration-32 と同じ）。スキルの手順だけを変えた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | 無し | 4/4 | 2/4 | 4/4（iteration-32） |

## 前回の記録との比べ方

- 4 本とも文が同じで、with_skill・without_skill のどちらも前回と同じ結果だった。

## 差の出た所と出なかった所

- with_skill は Step 1 で扱いを `明確` と決め、対策の無い `明確` として学びを `status: rejected` にし、`applied-to` に既存の規約が扱う理由を書いた。
- without_skill は既存の規約に気付いたが、学びを pending のまま残し、lifecycle 検査も実行しなかった（スクリプトが環境に無い）。
- 既存の規約の場所を示すことと、AGENTS.md に足さないことは、without_skill も満たした。後退の検出を目的として残す。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し
