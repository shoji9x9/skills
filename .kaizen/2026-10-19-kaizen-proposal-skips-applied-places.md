---
date: 2026-10-19
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 再発した学びの提案が、前の学びの適用先にある規則と Hook をもう一度足そうとした

## 事象

待つループの `pgrep -f` の学びを記録した。提案は、「AGENTS.md に規則を足す」「フォアグラウンドのループで待たない」「`bash-command-guard.sh` に `pgrep -f` / `pkill -f` の検出を足す」だった。
PR のレビューが、`docs/agent-workflow.md` に両方の規則が既にあり、Hook も `pkill -f` を既に止めていると指摘した。足りないのは Hook の `pgrep -f` だけだった。

## 根本原因

- なぜ重なったか: KEDB 照合で、同じ種類の applied の学び（archive の 2026-09-11-pkill-f-matches-own-command-line）を見つけたが、その適用先（`applied-to`）を開かずに提案を書いた
- なぜ開かなかったか: `extract.md` は applied のとき「恒久的な置き場所を更新する」と書くが、提案を書く前にその置き場所を読んで、何が既にあって何が足りないかを書く手順が無い
- なぜ気づけなかったか: KEDB 照合は `.kaizen/` と `INDEX.md` だけを見るので、適用先の文書や Hook にある規則は照合に出ない

## 提案

KEDB 照合で applied の学びに一致したら、提案を書く前にその `applied-to` を開き、既にある規則・チェックと、足りないものを分けて提案に書く。

- `skills/kaizen/references/extract.md` の「KEDB 照合」の `status: applied` の項に、この手順を足す
- 提案の節に「既にあるもの」と「足りないもの」を分けて書かせる
