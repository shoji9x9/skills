---
date: 2026-08-28
type: doc
priority: medium
status: applied
applied-to: [AGENTS.md]
session: claude-code
---

# Edit の old_string はタブ深いネストで目視再構成すると不一致になる

## 事象

kaizen-precommit-gate.sh の深くネストした tab インデントのコード片を編集する際、
Edit ツールの old_string がファイル実体と一致せず「String to replace not found in
file」で2回連続失敗した（同一ファイル・近接箇所への再編集）。いずれも Python で
行番号ベースの直接置換に切り替えて回避した。

## 根本原因

1. なぜ Edit が失敗したか → old_string のタブ数（インデント深さ）が実ファイルと
   1段ずれていた（自分が組み立てた old_string は else/comment が3〜4タブ、実ファイルは
   2〜3タブ）。
2. なぜインデントがずれたか → old_string を直前の Read 出力から機械的にコピーせず、
   目視で「同じに見える」テキストを記憶・再構成（手打ち）して作成した。
3. なぜ手打ちで再構成したか → for → if/elif → 入れ子if/else という深いネストを持つ
   tab インデントのシェルスクリプトを編集する際、「old_string は直前の Read 出力から
   一字一句コピーする」という手順が明文化されておらず、目視コピーで足りると誤って
   前提していた（根本原因・対策可能）。

KEDB照合: 既存の学びにヒットなし（新規）。
横断スコープ確認: 同種の tab インデント・深いネストのシェルスクリプト（kaizen 一式・
他のフックスクリプト等）は多数あり、同じ落とし穴は再発しうる。

## 提案

Edit ツールを使う際、old_string は直前の Read 出力（またはファイル実体）から一字一句
コピーする。タブ区切り・深いネスト・全角記号を含むコードでは、記憶や見た目の類似で
手打ちした old_string は不一致になりやすい。1回目の Edit が「String to replace not
found」で失敗したら、同じ内容を目視で微調整して再試行せず、対象範囲を Read で
再確認するか、行番号ベースのスクリプト置換（Python 等）に切り替える。
