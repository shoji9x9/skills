---
date: 2026-10-19
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 再発した学びを記録するとき、前の学びの適用先にある規則と Hook を確かめずに提案を書いた

## 事象

待つループの `pgrep -f` の学びを記録した。提案は、「AGENTS.md に規則を足す」「フォアグラウンドのループで待たない」「`bash-command-guard.sh` に `pgrep -f` / `pkill -f` の検出を足す」だった。
PR のレビューが、`docs/agent-workflow.md` に 2 つの規則（フォアグラウンドのループで待たない、`pkill -f` は自分のシェルにも一致する）が既にあり、Hook も `pkill -f` を既に止めていると指摘した。
足りないのは Hook の `pgrep -f` の検査だけだった。

## 根本原因

- なぜ重なったか: KEDB 照合で、同じ種類の applied の学び（archive の 2026-09-11-pkill-f-matches-own-command-line）を見つけたが、その適用先にある規則と Hook を読まずに提案を書いた
- なぜ読まなかったか: `extract.md` は applied のとき「恒久的な置き場所を更新する（適用先は、元のファイルの「提案」を参照）」と書くが、
  更新を提案する前にその置き場所の今の中身を読み、何が既にあって何が足りないかを書く手順が無い
- なぜ適用先を記録だけから決められないか: 元の学びの `applied-to` は `scripts/bash-command-guard.sh` を指すが、Hook は後で `scripts/hooks/` に移った。
  `extract.md` は、`.kaizen/` のノートの参照先が今は無いことを正常として扱うので、記録のパスを開いて見つからなくても「Hook は無い」と判断しうる
- なぜ気づけなかったか: KEDB 照合は `.kaizen/` と `INDEX.md` だけを見るので、適用先の文書や Hook にある規則は照合に出ない

## 提案

`skills/kaizen/references/extract.md` の「KEDB 照合」の `status: applied` の項で、恒久的な置き場所の更新を提案する前に、今の置き場所の中身を読む手順を足す。

- 適用先の決め方は 1 通りにする。既存の「元のファイルの「提案」を参照」の文に続けて、`applied-to` のパスも候補に挙げ、見つからなければ規則の語やファイル名で検索して今の置き場所を探す、と書き足す
- 見つけた置き場所を読み、提案の節に「既にあるもの」と「足りないもの」を分けて書くよう、抽出するエージェントに求める
