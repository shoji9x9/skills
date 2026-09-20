---
date: 2026-09-08
type: hook
priority: medium
status: applied
applied-to: [".agents/rules/eval-assertion-discrimination.md", "docs/skill-development.md", ".agents/rules/eval-run-scope.md"]
session: codex
---

# Eval prompt は assertion 固有の判断を直接問う

## 事象

`app-ui` を代替資産として扱うかを検査する assertion に対し、prompt は「状態網羅に使う資料が足りるか」だけを問い、
モデルが縮退判断を自発的に述べることへ依存していた。1 回の eval は通ったが、レビューで到達不能が見つかり、prompt の修正と再実走が必要になった。

## 根本原因

1. なぜ到達不能な assertion を実走したか: 到達対応表に assertion 固有の判断を直接問わない上位質問を対応づけた。
2. なぜ上位質問を許したか: 引用欄が空でないことだけを目視し、引用文から assertion の結論軸を一意に要求できるかを検証しなかった。
3. なぜ検証できなかったか: 到達対応表は文書規約だけで、assertion の識別語と prompt 引用の対応を fail-closed に検査する決定論的なゲートが無かった。

KEDB を `eval assertion`・`evals.json`・`prompt` で照合したが一致は無かった。横断すると、同じ形式の到達対応表を持つ全スキルの eval が対象になる。

## 適用結果（2026-09-08・実測により提案を修正）

**当初の提案（下記）は実測で否定された。** 「assertion 固有の判断軸を直接問う prompt 引用を要求する」を
`current-environment-bootstrap` の eval 6 に実装して実走したところ、到達性は上がったが**弁別が消えた**
（同一 executor・`without_skill` が 2/4 → 4/4）。prompt が分類軸と語彙を渡すため、ベースラインがそのまま埋める。
元の上位概念の引用でも `with_skill` は到達しており（3/3）、強める必要は無かった。

そのため決定論的検査は追加せず、**到達と弁別のトレードオフ**として反映した。

- `.agents/rules/eval-assertion-discrimination.md`: 「問う形にする」の直後に、強めたら
  `without_skill` を 1 run 取って弁別が残ることを実測する義務と、上位概念の引用でも
  `with_skill` の実測が到達性の証拠になることを追加
- `docs/skill-development.md`: 「実走の既定スコープ」で変更確認の既定を
  `with_skill` / `without_skill` 各 1 run と定義（弁別崩れを 1 run で検出できる形にした）
- `.agents/rules/eval-run-scope.md`: 上記を `skills/*/evals/**` 編集時に自動適用

**当初の提案が誤っていた理由**: 「引用が上位概念である」ことをレビューの読みだけで到達不能と判定し、
run で確かめなかった。到達不能の判定にも実測が要る。

## 当初の提案（記録として残す。上記のとおり採用していない）

Eval の到達対応表は assertion 固有の判断軸を直接問う prompt 引用を要求し、上位概念だけの引用を通さない決定論的な検査を追加する。

`skills/*/evals/README.md` の対応表と `evals.json` を照合し、各 assertion の固有な判断語が対応する prompt 引用にも存在するか、明示的な対応 ID で結ばれていることを検査する。
自動判定できない対応は成功扱いにせず、人手レビューが必要な項目として fail-closed に報告する。
