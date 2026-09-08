---
date: 2026-09-08
type: hook
priority: medium
status: pending
applied-to: []
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

## 提案

Eval の到達対応表は assertion 固有の判断軸を直接問う prompt 引用を要求し、上位概念だけの引用を通さない決定論的な検査を追加する。

`skills/*/evals/README.md` の対応表と `evals.json` を照合し、各 assertion の固有な判断語が対応する prompt 引用にも存在するか、明示的な対応 ID で結ばれていることを検査する。
自動判定できない対応は成功扱いにせず、人手レビューが必要な項目として fail-closed に報告する。
