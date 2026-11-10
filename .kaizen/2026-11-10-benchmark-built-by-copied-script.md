---
date: 2026-11-10
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# eval の集計を、前の回の使い捨てのスクリプトをコピーして組み立てた

## 事象

PR #984 の追加分の eval（`current-environment-bootstrap` の eval 9・`parity-suite` の eval 45）を採点した。
その `benchmark.json` を、前の iteration で使った scratchpad の採点スクリプトを元にした使い捨てのスクリプトで書いた。
`docs/skill-development.md`「集計」は、`scripts/eval/benchmark/build-skill-eval-benchmark.ts` で集計するよう求めている。
commit の前に気づいて作り直した。点数は同じで、出力の形が少し違った。

## 根本原因

- なぜ自作したか: 前の回のスクリプト（判定と集計を 1 つにまとめたもの）を読み、同じ形で 2 つのスキルに広げた。
- なぜ文書を見なかったか: 決まった形の作業を繰り返すときに、前の回のものをコピーする形である。
  コンテキストの圧縮で、前の回に集計をどう作ったかが要約に残らず、scratchpad のファイルだけが手がかりになった。
- 規約は明確だが、判定（`grading.json`）を書く段と集計の段を分けていなかったので、集計も同じスクリプトで済ませた。

## 根拠

確信度 medium: 1 回の観測で、原因は前の回のスクリプトを元にしたことに絞れている。再発は観測していない。
作り直した `benchmark.json` は、リポジトリのスクリプトで同じ点数（6/6 と 1/6、5/5 と 5/5）になった。
KEDB 照合（「iteration」「並行」、「iteration」「衝突」）で、同じ原因の学びは無かった。

## 既存の規約

- 扱い: 明確
- 場所: `docs/skill-development.md`「集計」の最初の段落
- 照合した範囲: `docs/skill-development.md` を `iteration-N`・`build-skill-eval-benchmark` で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

eval の採点では、使い捨てのスクリプトに `grading.json` を書くことだけをさせ、`benchmark.json` は必ず `build-skill-eval-benchmark.ts` で作る（前の回のスクリプトを元にするときも同じ）。

- `docs/skill-development.md`「集計」に、判定と集計を 1 つのスクリプトにまとめない、を足す候補にする
- 機構は作らない（1 回の観測で、規約は明確に書かれている）
