---
date: 2026-09-03
type: rule
priority: medium
status: pending
applied-to: []
session: codex
---

# Eval の採点は assertion 適合と矛盾の不在を両方確認する

## 事象

eval 23 の出力が 4 assertion の文言をすべて含む一方、末尾で「イベント到達を確認できなければ absent」と読める、
正本の fail-closed 契約に反する結論も述べた。形式採点を 4/4 とし、矛盾は notes にだけ残したため、100% が品質を過大表示した。

## 根本原因

1. assertion ごとの必要語句だけを確認し、出力全体が同じ判断を一貫して維持したかを合否条件にしなかった。
2. なぜなら、grader の各 expectation を独立した局所照合として扱い、後段の反対命題をその expectation の反証へ結び付けなかった。
3. なぜなら、eval 設計時に正答要件は列挙したが、同じ出力内の矛盾した最終判断を fail にする横断 assertion または採点規律を用意していなかった。

KEDB を `assertion`・`grading`・`contradiction` で照合したが既存記録は無かった。横断的には、否定・停止・fail-closed を
評価する全スキルの grader と assertion に同じ過大評価経路があり得る。

## 提案

eval の採点は assertion の必要事項が出力に存在するだけで pass にせず、出力内に正本と矛盾する結論や反対命題があれば関連 assertion を fail にする。

`eval-assertion-discrimination` または採点ガイドへこの規律を追加し、重要な fail-closed 契約には「回答内で矛盾する判断をしていない」ことを
観測可能な assertion として含める。
