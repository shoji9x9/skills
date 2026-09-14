# Skill Benchmark: parity-diff

**Model**: claude-code / claude-opus-5（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 22 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #363 の Codex レビュー P1 への追随）

撮影前検査の突き合わせを「開く関数名」から「関数名 × 開く対象の論理名」の呼び出し単位に変えた。
eval 22 の assertion 2 をその単位に書き直し、到達させるためプロンプトに「複数のコンボボックスの一覧を `openCombo(page, name)` 1 つで開いている」事実を足した。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 22 棚卸しの撮影前検査 | **6/6** | 3/6（iteration-22: 2/6） | 3（静止待ち前の採取として採り直し・承認時だけノイズ吸収なしで続行・`capture_conditions_verified` への記録） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `with_skill` は `openCombo(status)` / `openCombo(operator)` の単位で列挙し、関数名だけの照合では 1 行で全コンボが済んだように見えると説明した
- `without_skill` もプロンプトの `openCombo(page, name)` から「呼んでいるコンボボックス名の一覧と棚卸しの行を 1 対 1 で突き合わせる」に自力で到達し、assertion 2 を満たした。
  **assertion 2 は弁別を失い、後退検知になった**（到達性のために足した事実が、判断そのものを baseline に渡した）
