# Skill Benchmark: parity-diff

**Model**: claude-code / opus（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 22（新設。`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #363 の Copilot レビュー指摘）

撮影前に現側 `capture_conditions.popup_inventory` の整合を検査する契約（Issue #360 / #361）に回帰 eval が無かった。不整合な棚卸しを注記で済ませて撮影を進める案を押し戻す eval を追加した。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 22 棚卸しの撮影前検査 | **6/6** | 2/6 | 4（開く関数と `opened_by` の突き合わせ・キー無し旧成果物を停止しない・ノイズ基準値の未検証・`capture_conditions_verified` への記録） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` も不整合な行では撮影を保留するが、キーごと無い旧成果物まで「止めるべき」と答え、後方互換で停止せず未検証として残す契約と逆になった
- 網羅性の確認は旧 UI の実ポップアップとの目視突き合わせで、操作アダプタの開く関数との突き合わせではない。記録先も独自のレポート節だった
