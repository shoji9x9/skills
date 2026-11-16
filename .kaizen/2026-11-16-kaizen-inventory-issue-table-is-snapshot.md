---
date: 2026-11-16
type: skill
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# kaizen の棚卸しの Issue を起点に適用すると、Issue の表を対象の一覧として読みかける

## 事象

Issue #992（kaizen の週次の棚卸し）を `issue-start` に渡し、high の学びだけを適用するよう依頼された。
エージェントは、Issue の本文の表から high の行を拾い、対象のノートを決めた。ローカルの `.kaizen/` で数え直したのは、その後である。
利用者は作業の途中で、「改善のレコードは Issue の内容ではなく、ローカルの内容を正にして下さい。Issue 作成後から状況が変わっている恐れがあります」と指示した。

## 根本原因

- なぜ Issue の表から対象を決めかけたか → `issue-start` は Issue の本文を要件として読む。棚卸しの Issue では、本文の表がそのまま作業の対象の一覧に見える
- なぜ表を原本と読めたか → `kaizen-schedule-report.sh` が書く本文は、件数の上限で一部を切ったことは書くが、表が棚卸しの時点のコピーで、原本がローカルの `.kaizen/` であることは書いていない
- なぜ問題になるか → 棚卸しの後に、学びの適用・忘却・優先度の見直しで `status` と `priority` が変わる。表のまま進めると、適用済みの学びを適用し直すか、上がった学びを落とす

## 根拠

利用者の指示で観測した。今回は、ローカルで `status: pending` かつ `priority: high` を数え直した結果が表と同じ 1 件だったので、誤った適用は起きていない。
KEDB 照合（「棚卸し」「Issue の本文」「kaizen-schedule」）は 0 件だった。
確信度を medium にした理由: 誤りは利用者の指示で防がれ、実際の誤った適用は観測していない。

## 既存の規約

- 扱い: なし
- 場所: なし。`references/apply.md` の手順 1 はローカルの `.kaizen/*.md` から一覧を作るが、Issue を起点にしたときに表を使わないことは書いていない
- 照合した範囲: `skills/kaizen/references/apply.md`・`skills/kaizen/scripts/kaizen-schedule-report.sh` の Issue の本文

## 食い違い

- 相手: なし
- 判断: なし

## 提案

棚卸しの Issue の本文に、表は棚卸しの時点のコピーで、適用する対象は適用する時点のローカルの `.kaizen/` の `status` と `priority` で決めると書く。

- 書く場所は、`kaizen-schedule-report.sh` が本文に出す `/kaizen apply` の案内の直後にする
- `references/apply.md` の手順 1 にも、Issue から依頼されたときは Issue の表ではなくローカルのノートで対象を決めると書く
