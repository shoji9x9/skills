# Skill Benchmark: kaizen

**Model**: claude-code / opus（reasoning effort high）
**Date**: 2026-11-08
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #950 の 3 回目のローカルのレビューの指摘に対応した後の変更確認である。
apply は、`## 既存の規約` の節が無い学びのファイルに書き込まず、Step 2 で照合の結果を示して承認か却下かを決める作りに変えた。
eval 29 の assertion を、この作りに合わせて書き直した。

## 入力の変更

- eval 29: assertion を書き直した（節を足すことの 2 本を、既存の規約の場所を示すことと、rejected にして理由を書くことに替えた）。prompt と fixture は変えていない。
- 文が変わった assertion は前回（iteration-31）と比べない。文が同じ 2 本（AGENTS.md に足さない・lifecycle 検査）は、どちらの config でも前回と同じ結果だった。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | あり | 4/4 | 2/4 | 4/4（iteration-31。文が違う） |

## 差の出た所と出なかった所

- with_skill は学びを `status: rejected` にし、`applied-to` に既存の規約が扱う理由を書いた。without_skill は既存の規約に気付いたが、学びを pending のまま残した。
- without_skill のもう 1 件の失敗は lifecycle 検査で、検査のスクリプトが環境に無いので実行しなかった。
- 既存の規約の場所を示すことと、AGENTS.md に足さないことは、without_skill も満たした。後退の検出を目的として残す。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し
