# Skill Benchmark: parity-suite

**Model**: claude-code / claude-opus-5（CLI 2.1.274 (Claude Code)）
**Date**: 2026-09-17
**Evals**: 37 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #386）

`trait-capture.mjs` が採取した要素の矩形を文書座標へ直し、**文書の外に丸ごと出ている要素で採取を失敗させる**ようにした（`VERSION` 2 → 3）。
併せて 1 段下の子の inline style を `child_inline_styles` に記録する（照合には使わない診断材料）。
eval 37 は、市販データグリッドの列見出しで「固定プロパティ集合が全一致で緑なのに画素だけ差が出る」状況から、
書体の版・ヒンティングの切り分けへ進もうとする案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 37 採取対象が描かれているか | **7/7** | 2/7 | 5（写しの矩形・論理名の付け直し・採取ツールの失敗と欠落へ変換しない規約・`child_inline_styles`・マッピング修正後の採り直し） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` も「緑は固定集合の中だけの話」「`head` を読むのはまだ早い」には自力で到達した（assertion 1・7 は後退検知）。
  一方で**画面の外へ置かれた写し**という形は出てこず、集合外プロパティ・書体解決・撮影タイミングを原因候補に挙げた
- `with_skill` は `baseline.md` の実測（列見出し 9 件を写しから採っていた）を引いて原因をロケータマッピングに特定し、
  `child_inline_styles` を「フォントへ行く前の必須手順」として挙げた
- `with_skill` が**この変更の穴も指摘した**——面積 0 の矩形は判定から除外しているため、**0 サイズの写しは素通りする**。
  除外は `display: none` を正当に採るためのもので意図どおりだが、限界として記録しておく

## iteration-36（初版）で分かったこと

初版の prompt は固定プロパティ集合の件数を「34」と書いていた。34 は**この変更より前**の集合の件数で、現行は 36 なので、
`with_skill` は「採取が古いスキーマで行われている」という筋へ寄った（答えとしては妥当だが、測りたい分岐ではない）。
件数を prompt から外し、`child_inline_styles` の assertion を足して取り直したのが iteration-37。
