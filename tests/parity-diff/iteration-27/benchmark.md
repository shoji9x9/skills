# Skill Benchmark: parity-diff

**Model**: claude-code / claude-opus-5（CLI 2.1.274 (Claude Code)）
**Date**: 2026-09-17
**Evals**: 25 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #384）

`pixel-crops.mjs` が**しきい値つき**（記録済み `pixel_tool`）と**しきい値なし**（厳密比較）の画素数を両方 `summary` に出すようにした（`VERSION` 1 → 2）。
eval 25 は、しきい値つきの数だけを見て「ほぼ一致」と要約し収束扱いにする案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 25 画素の量は 2 本で報告する | **5/5** | 0/5 | 5（全部） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` は「% は分母が大きく情報量が無い」「crop 1 件は集中の証拠」と別方向の指摘に寄り、
  **しきい値の内側に差が隠れる**という性質には一度も触れなかった。`includeAA` の既定から「756px は実差分寄り」と読み、逆向きの結論に近づいた
- `with_skill` は `detect.md` の実測例を引いて隠れた差の可能性を挙げ、`strict_pixels` / `strict_only_pixels` を併記する形と、
  ノイズ基準値との対比まで述べた

## 同じ iteration で走らせた eval 26（初版）

eval 26（本経路の外で撮った 2 枚の扱い）の初版も同時に走らせたが、assertion 2 件が場面と噛み合わなかった——
「両側の矩形を並べて出す」と「`child_inline_styles` を読む」で、**本経路で撮り直すという正しい答えが不合格になる**形だった。
結果は with 4/6・without 4/6 で弁別 0。assertion を直して iteration-28 で取り直している。
