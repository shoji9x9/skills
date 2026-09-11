---
date: 2026-09-11
type: skill
priority: medium
status: applied
applied-to:
  - skills/pr-finalize-loop/SKILL.md
session: claude-code
---

# 進行中レビューの不在は 1 経路の pending 0 件で結論しない

## 事象

進行中レビューの検出に `gh pr checks` を使い、pending が 0 件だったため「進行中シグナルなし」と判断した。
実測到着時間（約 6 分）の 2 倍が経過していたことと合わせ、進行中シグナルを無効とみなして不要な再依頼を投げた。
ユーザーから「レビューは実施されています」と指摘を受け、現 HEAD の commit check-runs を見ると `copilot-pull-request-reviewer` が `in_progress` で存在していた。

## 根本原因

1. なぜ検出できなかったか → `gh pr checks` がレビュー bot の check-run を一覧に出さなかった（`in_progress` でも pending に現れない）。
2. なぜそれだけで判断したか → `pr-finalize-loop` の「レビュー進行中の検出」が一次シグナルとして `gh pr checks` を指定しており、その手順をそのまま使った。
3. なぜ二次確認をしなかったか → 「pending 0 件」という**不在を根拠にする判定**を、検出能力の陽性コントロールなしに使った ← 根本原因

KEDB 照合（`レビュー` / `進行中` / `検出` と `不在` / `根拠` / `陽性コントロール` はいずれも rc=1 で検査済み・直接一致なし。
`gh pr checks` / `Copilot` では別軸の記録がヒット）: 基底ドキュメントに「『該当が無い』を根拠にする検査は陽性コントロールで検出能力を実証してから使う」という一般規律はある。
しかし `gh pr checks` がレビュー bot の check-run を拾わないという具体事実がスキルの手順側に無く、手順どおり実行すると不在判定へ倒れる。

横断スコープ: 同型は「1 つの API の空応答を不在の証拠にする」全箇所。本スキル内では自動依頼シグナル（timeline）・補助シグナル（bot コメント）も単独では不在を証明しない。`pr-review-handle` の再レビュー依頼判定も同じ検出手順を参照する。

## 提案

進行中レビューの一次シグナルを `gh pr checks` だけにしない。同コマンドはレビュー bot の check-run を表示しないことがあり、pending 0 件は「進行中でない」の証拠にならない。現 HEAD の commit check-runs endpoint を併せて見て、両方が空のときだけ「進行中なし」とする。待機上限の超過を根拠に再依頼へ進む前に、進行中シグナルが本当に無いかを別経路で確かめる。

`pr-finalize-loop` の「レビュー進行中の検出」へ適用した。
