---
date: 2026-09-17
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 整形直後の置換失敗が、文章規約を書いた後にも再発した

## 事象

PR #395 のレビュー対応中、`scripts/skills/parity-diff/pixel-crops.test.js` の import ブロックを python の文字列置換で書き換えようとして
`AssertionError` で 1 回落ちた。直前の編集で `pnpm exec oxfmt` を通しており、整形が import を
`const { ... } = await import(\n  script\n);` の形へ折り返していたため、記憶から組み立てた置換元と一致しなかった。
失敗後にファイルを読み直して現在の中身から置換元を取り、成功した（手戻りは 1 回）。

再発（2026-09-28・PR #504 のレビュー対応）: `reaction-check.mjs` の `checkStateDisplays` の分割代入を python の置換で書き換えようとして
`AssertionError`（destructure）で 1 回落ちた。直前の置換で自分が 2 行に折り返して書いた形を、`oxfmt` が 1 要素 1 行に整形していたのに、
記憶から置換元を組み立てた。書き込みは置換ごとなので成功分は残り、読み直して残りだけ再実行した（手戻り 1 回）。
同じ PR では、整形後の複数行の `find` を記憶から組んで `mutations.json` の置換が当たらない（`substring not found`）ことも 1 回あった。

再発（2026-10-01・PR #542 のレビュー対応）: 変異の宣言を python で足した。
その際、直前に `oxfmt` を通した `check-skill-checks.js` の置換元を記憶から組み、`AssertionError` で 3 回落ちた（`SC-UNKNOWN-KEY` のインデント、`AO-EXCL-ALL` の折り返し、`violations.push` の折り返し）。
うち 1 回は、新しく足した行が既存の変異の `find` を部分文字列として含み、既存の宣言（`SC-STALE-UNWIRED`）が 2 箇所に当たる形でも落ちた。
いずれも読み直して 1 回で直した（手戻り計 3 回・検知は即時）。変異の `find` を足すときは、全宣言の `find` の出現数を測り直す必要もある
（新しい行が既存の `find` を含むと、既存の宣言に累が届く）。

## 根本原因

- なぜ一致しなかったか → 置換元を、整形前に自分が書いた形から組み立てたため
  - なぜそうしたか → 直前に自分で書いたファイルなので中身を知っているつもりだった
    - なぜ規約で止まらなかったか → 規約は `AGENTS.md` の文章にしかなく、実行前に検査する仕組みが無い
      ← 根本原因（[[2026-09-12-format-then-patch-stale-string]] の反映先がまさにその文章）

KEDB 照合: [[2026-09-12-format-then-patch-stale-string]]（`status: applied`・反映先 `AGENTS.md`）と同一の根本原因で、
誘因（整形）も方法（スクリプト置換）も同じ。applied ノートには追記しない。
[[2026-09-16-prose-rule-recurrence-needs-deterministic-gate]]（`status: pending`）が、この形は規約を書き足さず
決定論的なチェックへ上げよと言っている。

- 再発（同じ PR で 2 回）: どちらも「自分で書いた直後のコードを `oxfmt` が整形 → 記憶から置換元を組む」。規約は読んでいたが、
  1 スクリプトに「編集 → 整形」と「次の置換」を跨がせると読み直しの契機が無い

## 提案

整形コマンドを実行したら、次の文字列置換の前に対象ファイルを読み直す（規約は既にあるので、書き足さず仕組み側へ寄せる）。

- **置換ヘルパを 1 本にまとめ、置換前にファイルを読み直す手順をツール側に持たせる**（置換元を「直前の読み取り結果」から取ることを構造的に強制する）
- 影響は小さい（手戻り 1 回・検知は即時の `AssertionError`）ので、チェック化のコストと釣り合うかは apply 時に判断する
- 再発 2 回（同一 PR）のため priority を medium に上げた。置換元を直前の Read / grep の出力からコピーすることをヘルパ側で強制する案を apply 時に優先して検討する
