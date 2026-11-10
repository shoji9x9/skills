# Skill Benchmark: parity-suite

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #984 で、`current.origin: received-assets` のとき `.replace/bootstrap/metadata.json` の `status` が `handed-off` でなければ止まる確認を足した後の変更確認である。
新しく足した eval 45 だけを実行した。新しく足したので、比べる記録は無い。
既存の eval（18・19 など）は fixture・prompt・assertion を変えていないので、実行していない。

## 入力の変更

- `SKILL.md` の実行フロー 1 で、`received-assets` なら `--target` を確定する前に、手順 2 の確認（引き渡しと意味論）を済ませる。
- 手順 2 の停止条件に、`status` が `handed-off` でないことを足した。
- eval 45（新規、`bootstrap-reverted`）: eval 18 の fixture の bootstrap の記録を、引き渡しの後に `blocked` へ戻した状態にした。設定の `current-test` は `url` と `default: true` を持ったままである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 45 | 新規 | 5/5 | 5/5 | - |

汚染の判定は 2 run ともファイルの読み取りが無く、with_skill の `invalid_run` は false だった。

## 変更の効果

- with_skill は、`status: blocked` を停止条件として挙げ、`current-test` の稼働確認も起動もせずに止まった。
- without_skill も、fixture の `status: blocked` を読み、問題の 1 番目に挙げて止まった。
  fixture の記録が `blocked` を直接述べているので、5 本の assertion はどれも区別に使えない。この eval は、`status` を読まずに設定の target で進む後退を検知するためのものである。
- 観測した差は、without_skill が `http://localhost:8080` への接続を試みた（HTTP 000）のに対し、with_skill は接続を試みなかったことである。
  スキルの手順 1 は、`--target` を確定する前に止まることを求めているので、この差は取り決めどおりである。assertion にはしていない。
