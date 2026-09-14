# Skill Benchmark: parity-suite

**Model**: claude-code / claude-opus-5（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 33 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #363 の Codex レビュー P1 への追随）

`popup_inventory[].opened_by` を関数名だけでなく `<関数名>(<開く対象の論理名>)` で書き、器を開く呼び出しを「関数名 × 開く対象」の単位で突き合わせる契約に変えた。
eval 33 の assertion 5 をその単位に書き直し、到達させるためプロンプトに「3 つの器を同じ `openPopup(page, name)` 1 つで開いている」事実を足した。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 33 器の棚卸し | **6/6** | 2/6 | 4（3 経路に出ない説明・`popup_inventory` と排他・`gaps.md` の種別・`opened_by` での呼び出し単位の突き合わせ） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `with_skill` は `opened_by` を `openPopup(列フィルタの吹き出し)` のように書き、`openPopup()` 1 行では突き合わせが永久に緑になると説明した
- `without_skill` もプロンプトの事実から「関数名に引数を含めたキーで呼び出しを記録して突き合わせる」考え方には自力で到達した。assertion 5 が落ちたのは記録先が棚卸しの `opened_by` でなかったためで、**呼び出し単位という軸そのものは弁別していない**
