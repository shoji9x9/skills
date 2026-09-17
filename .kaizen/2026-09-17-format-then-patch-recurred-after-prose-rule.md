---
date: 2026-09-17
type: doc
priority: low
status: pending
applied-to: []
session: claude-code
---

# 整形直後の置換失敗が、文章規約を書いた後にも再発した

## 事象

PR #395 のレビュー対応中、`scripts/pixel-crops.test.js` の import ブロックを python の文字列置換で書き換えようとして
`AssertionError` で 1 回落ちた。直前の編集で `pnpm exec oxfmt` を通しており、整形が import を
`const { ... } = await import(\n  script\n);` の形へ折り返していたため、記憶から組み立てた置換元と一致しなかった。
失敗後にファイルを読み直して現在の中身から置換元を取り、成功した（手戻りは 1 回）。

## 根本原因

- なぜ一致しなかったか? → 置換元を、整形前に自分が書いた形から組み立てたため
  - なぜそうしたか? → 直前に自分で書いたファイルなので中身を知っているつもりだった
    - なぜ規約で止まらなかったか? → 規約は `AGENTS.md` の文章にしかなく、実行前に検査する仕組みが無い
      ← 根本原因（[[2026-09-12-format-then-patch-stale-string]] の反映先がまさにその文章）

KEDB 照合: [[2026-09-12-format-then-patch-stale-string]]（`status: applied`・反映先 `AGENTS.md`）と同一の根本原因で、
誘因（整形）も経路（スクリプト置換）も同じ。applied ノートには追記しない。
[[2026-09-16-prose-rule-recurrence-needs-deterministic-gate]]（`status: pending`）が、この形は規約を書き足さず
決定論的なゲートへ上げよと言っている。

## 提案

整形コマンドを実行したら、次の文字列置換の前に対象ファイルを読み直す（規約は既にあるので、書き足さず仕組み側へ寄せる）。

- **置換ヘルパを 1 本にまとめ、置換前にファイルを読み直す手順をツール側に持たせる**（置換元を「直前の読み取り結果」から取ることを構造的に強制する）
- 影響は小さい（手戻り 1 回・検知は即時の `AssertionError`）ので、ゲート化のコストと釣り合うかは apply 時に判断する
