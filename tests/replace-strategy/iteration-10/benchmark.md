# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-07-30T03:16:06Z
**Evals**: 13, 14 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 10% ± 14% | +0.90 |
| Time | 109.3s ± 55.8s | 105.2s ± 51.9s | +4.1s |
| Tokens | 201102 ± 22594 | 62418 ± 14500 | +138684 |

## 対象と結果（Issue #159 ファイル入出力・ストレージ）

| eval | 主題 | with_skill | without_skill |
|---|---|---|---|
| 13 | ストレージ軸（`dataset_mode` と直交・fail-closed・v1 スコープ外・`upload_route`） | 5/5 | 0/5 |
| 14 | ファイル出力（xlsx のバイト一致回避・batch の FS 到達性・解析ツールの記録） | 5/5 | 1/5 |

- eval 13 のベースラインは `dataset_mode: storage` を「採用可能な完成形」として提示し、`upload.enabled: true` で投入を有効化した（直交軸・投入ゲート・v1 スコープ外がいずれも出ない）
- eval 14 のベースラインは xlsx のバイト一致不成立だけは一般知識で導けた（アサーション 1 が pass）。残り 4 件は skill 固有の契約（`differ.file_extract` への記録・`json-normalize-diff.mjs` の流用・到達性の記録内容・batch がブラウザを経由しない点）で落ちた

## eval 14 のアサーション強化

採点前に 2 件を skill 固有の述語へ強化した（弁別の確保。`.kaizen/2026-07-23-eval-assertion-discrimination.md`）。

- アサーション 3: 到達性を「読めた手段（コンテナへの入り方・リモートからの転送方法）とパスまで記録する実測項目」として扱うことを要求（一般的な「実測が必要」ではベースラインも満たす）
- アサーション 5: 「バイト列に到達できない出力を gaps に残す」に加え、抽出結果の比較へ `parity-diff` 同梱の `json-normalize-diff.mjs` を流用し `--ignore` で揮発項目を除外する形を要求（ベースラインは比較器を自前実装した）

## ベースラインの read 汚染について

**遮断は既定運用としてリポジトリに入れた**（`scripts/eval-sandbox.sh`。`.kaizen/2026-07-28-eval-baseline-read-contamination.md` の 5 度目の再発を受け、毎回手で組み立てるのをやめた）。

- 遮断は 4 群（作業ツリー／`/tmp` の兄弟 run／WSL ミラー／エージェントの記録）。`without_skill` の 6 run すべてを本ラッパー経由・逐次で取得した
- 事前検証（2 段）: (1) サンドボックス内で本リポジトリのパスが空、(2) 新設語（`uses_storage` / `data-discipline` / `upload_route`）を `$HOME` / `/tmp` / `/mnt/wsl` に内容 grep して 0 件
- 事後検知: 全 baseline の応答・生成物に skill 固有マーカー 15 語を grep して 0 件（`contamination.txt` は未生成）
