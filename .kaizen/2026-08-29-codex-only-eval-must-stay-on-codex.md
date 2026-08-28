---
date: 2026-08-29
type: rule
priority: medium
status: pending
applied-to: []
session: codex
---

# Codex-only 評価の障害を別 executor への切替で回避しない

## 事象

Codex-only 対応済みの評価ハーネスで Git fixture の通常 fetch が `.git` の読み取り専用制約に失敗した際、
原因を最後まで切り分けず Claude Code executor へ切り替え、ユーザーから Codex 単体で評価可能なはずだと修正された。
後から raw trace を確認すると run の直接の停止原因には Codex 利用上限到達も含まれており、途中の fetch エラーだけで executor 非対応と判断していた。

## 根本原因

1. なぜ別 executor へ切り替えたか → `.git/FETCH_HEAD` の書き込み失敗を Codex executor 全体の非対応と解釈した。
2. なぜ非対応と解釈したか → `result.json` の途中報告だけを見て、raw trace の `turn.failed` と既存の Codex-only 契約を突き合わせなかった。
3. なぜ契約との突き合わせを省いたか → 評価前提を満たす代替コマンドと executor 変更を同じ回避策として扱い、比較可能性を変える判断の境界を設けていなかった。

KEDB 照合: `Codex-only` / `run-skill-eval` / `executor` で既存記録なし。
横断確認では、同じ誤りは Git 操作を行う他の eval fixture でも起こり得る。

## 提案

Codex-only 評価で失敗したら executor を変える前に raw trace の最終失敗、Codex-only 契約、sandbox 内で使える非書き込み代替を順に確認し、比較 executor を変更しない。
Git の読み取り評価では、fixture setup で remote-tracking ref を準備し、Codex の `.git` 保護下では `git fetch --no-write-fetch-head` で到達性を実測する。
