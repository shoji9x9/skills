---
date: 2026-07-16
type: rule
priority: medium
status: applied
session: claude-code
---

# 配布スキルの curl API 例は変数値を --data-urlencode でエンコードする

## 事象

box スキルで curl の送信値を URL クエリ / フォームに直挿ししていた箇所が、Copilot レビューで 3 回続けて
指摘された（`refresh_token`・認可 `code`/`redirect_uri`・フォルダ一覧の `next_marker`）。
いずれも `+`・`=`・`/` 等 URL エンコードが必要な文字を含む値で壊れ、トークン更新失敗やページング取りこぼしになり得る。
初回の code-review でも見落とし、レビュー往復で 3 コミットに分けて後追い修正した。

## 根本原因

`curl -d "k=$v"` や URL クエリ文字列への `?k=$v` 直挿しは送信値をエンコードしない。
Box の refresh token / marker のような不透明トークンや、`+`/`=`/`/` を含む値でそのまま壊れる。
参照実装の写し（`-d` 直挿し）を検証せずそのまま踏襲したため、複数箇所に同じ欠陥が横展開されていた。
関連: [[external-tool-config-verify-official-docs]]（外部ツールの API フォーマットは一次情報で検証する）。

## 提案

配布スキルの curl による API 例・スクリプトでは、変数値を URL クエリ / フォームに直挿しせず、
`--data-urlencode "k=$v"`（GET は `-G` を併用してクエリに載せる）でエンコードする。
固定リテラル（`grant_type=refresh_token` 等）は対象外でよい。
`skills/**` 配下の作成・編集に閉じた規律なので、`.agents/rules/` に `paths: skills/**` 絞りのルールとして記録する。
横断確認: 既存の配布スキルにも curl の直挿し例が残っていないか、rule 追加時に一度 grep で洗う。
