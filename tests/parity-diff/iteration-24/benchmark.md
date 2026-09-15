# Skill Benchmark: parity-diff

**Model**: claude-code / claude-opus-5（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-15
**Evals**: 23 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #351）

収束条件に「反応の被覆表に未測定が残っていない」を足し、インストール済みの `parity-suite` の `reaction-check.mjs --recorded` で判定する契約にした。
eval 23 は、差分器の未説明ゼロとスクリプトが見当たらないことを根拠に判定を飛ばして収束させる案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 23 反応の被覆の収束判定 | **5/5** | 2/5 | 3（`parity-suite` のスクリプトを `--recorded` で呼び無ければ停止・表の指紋による手直しの検出・記録先） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` も「確認していない表で収束させない」には到達した（assertion 1 は後退検知）
- `without_skill` はスクリプトが無ければ手作業の確認で代替する案を出し、記録先も `metadata.json` の独自キーにした
