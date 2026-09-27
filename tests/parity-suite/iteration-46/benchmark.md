# Skill Benchmark: parity-suite

**Model**: claude-code / opus（CLI 2.1.281 (Claude Code)）
**Date**: 2026-09-27
**Evals**: 38 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #459）

`trait-capture.mjs` が部分木の文字の持ち主（`text_owners`。文字を描いている要素ごとの書体・大きさ・行の高さと文字の寸法）を採るようにした（`VERSION` 4 → 5）。
`trait-compare.mjs` はそれを並び順で突き合わせ、差を `kind: "text"` で出す（`VERSION` 1 → 2）。
eval 38 の prompt は変えず、「要素自身の font 系の計算値は子孫が描く文字を表さないので `text_owners` と `kind: "text"` を確かめる」assertion を 1 本足した。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 38 採取対象が描かれているか | **8/8** | 2/8 | 6（写しの矩形・論理名の付け直し・採取ツールの失敗と欠落へ変換しない規約・`child_inline_styles`・**`text_owners` と `kind: "text"`**・マッピング修正後の採り直し） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- 足した assertion は弁別した。`without_skill` も「見出しの文字は内側の span にあることが多い」と子孫の文字には自力で触れたが、
  採取物の `text_owners` や差分の `kind: "text"` は出てこず、全プロパティを自前で採り直す手順を提案した
- `with_skill` は `child_inline_styles` に続けて `text_owners` を確かめる手順を挙げ、強度ゲートで「文字を持つ子孫だけに注入して `kind: "text"` が赤になるか」を見ると述べた
  （`strength-gate.md` に足した行が読まれている）
- 既存 7 本の判定は iteration-37 と同じ（with 7/7・without 2/7 に相当）
