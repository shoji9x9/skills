# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #984 で見送っていた 3 点を同じ PR で直した後の変更確認である。入力が変わった eval 9 だけを実行した。
比べる記録は `iteration-19` の eval 9 である。eval 8 は fixture・prompt・assertion を変えておらず、`handed-off` のまま終える行の扱いも変えていないので、実行していない。

## 入力の変更

- `SKILL.md`「引き渡した後に届いたとき」の `blocked` に戻す手順を 3 段にした。
  - 手順 2（新規）: 引き渡しの後に済んだ下流の作業を `metadata.json` の `stale_downstream` に挙げる。
    対象は `.replace/survey.md`・`.replace/dataset/metadata.json`・`.replace/parity/<slug>/metadata.json`・`.replace/components/<slug>/metadata.json` である。
  - 手順 3: 利用者が設定の取り消しを断ったら、設定を書かずに `blocked` のまま進め、次の引き渡しで残った値を `--replace` で書き直す。
- `references/verification-handoff.md` の工程 9 で、`stale_downstream` を報告してから空にする。`assets/metadata-template.json` にキーを足した。
- `parity-suite` と `parity-component` の `capture` が、`received-assets` のとき `status` が `handed-off` でなければ止まる（`parity-suite` は `iteration-53`）。
- eval 9: fixture に、引き渡しより後の日時の `.replace/dataset/metadata.json`（フェーズ A の記録）を置き、assertion 6 を足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 9 | fixture と assertion | 6/6 | 1/6 | 5/5（assertion 5 本） |

汚染の判定は 2 run ともファイルの読み取りが無く、with_skill の `invalid_run` は false だった。

## 変更の効果

- with_skill は、前回と同じく `blocked` に戻して `from_step: 3` を書き、設定の取り消しを利用者に確かめた。
  加えて、`stale_downstream` に `.replace/dataset/metadata.json` を golden-dataset のフェーズ A として挙げ、`.replace/survey.md` などが無いことも報告した。
  取り消しの選択肢に「承認しない（設定を書かず `blocked` のまま進め、次の引き渡しで `--replace` で書き直す）」を含めた。
- without_skill は、スキルが入っていないことを理由に止まり、ファイルを変えなかった。データセットのやり直しの可能性には最後のメッセージで触れたが、記録には残していない。
  assertion 5 は、何もしなくても満たすので区別には使えない（前回と同じ）。
