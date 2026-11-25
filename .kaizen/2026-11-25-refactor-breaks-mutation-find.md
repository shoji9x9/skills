---
date: 2026-11-25
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 既存の関数の行を書き換えるとき、その行を find に持つ変異の定義を先に探さなかった

## 事象

Issue #1107 の実装で、`skills/parity-diff/scripts/region-names.mjs` の `collectSideOverlaps` の行を書き換えた。
その後、oxfmt が `locateOnSide` の行を折り返した。
どちらの行も、`scripts/skills/parity-diff/region-names.mutations.json` の `find`（`ignore-scale`・`mask-rects-ignore-scale`）だった。
pre-commit の `scripts/mutation/mutations-declaration.test.ts` が、`find` の出現数が 0 だとして 2 回止め、そのたびに pre-commit（約 140 秒）を実行し直した。

## 根本原因

- なぜ止まったか: 変異の定義の `find` は 1 行の文字列の一致なので、書き換えた行と折り返した行には当たらなくなった。
- なぜ書き換える前に気付かなかったか: 書き換える行を `find` に持つ定義を、書き換える前に grep で探さなかった。
- なぜ探さなかったか: `AGENTS.md`「編集」は、`find` の出現数を grep する手順を「一括で書き換える前に」と書いている。
  1 つの関数の書き換えや、フォーマッタの折り返しは一括の書き換えに見えず、当てなかった。
  規約が対象として書いた場面が、`find` が外れる仕組み（行の字面が変わること）より狭い。

## 根拠

1 回の観測で、2 件とも同じ原因に絞れたので medium にする。

- `region-names.mjs` の書き換えの後、pre-commit が `ignore-scale` の出現数 0 で止まった。
- oxfmt が `locateOnSide` を折り返した後、pre-commit が `mask-rects-ignore-scale` の出現数 0 で止まった。
- KEDB 照合（`find`・`mutations.json`）では、`2026-10-07-bulk-rewrite-keyed-checks.md`（applied）と `2026-10-29-bulk-rewrite-missed-test-name-refs.md`（pending）が同じ種類に当たった。
  どちらも一括の書き換えの場面で、今回は一括でない書き換えで起きたので、新しい学びにした（`recurrence-of` は付けない）。

## 既存の規約

- 扱い: 埋もれている
- 場所: `AGENTS.md`「編集」の「文字列の一致で編集するときは、…ミューテーションテストの定義の `find` も、整形した後のファイルから取る」と「一括で書き換える前に、…`find` の出現数…を grep で挙げ」。後者は対象を一括の書き換えに限って読める
- 照合した範囲: `AGENTS.md`・`docs/agent-workflow.md`・`.agents/rules/state-space-and-mutation-proof.md` を `find` で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

`AGENTS.md`「編集」の `find` の箇条を、一括でない書き換え（1 か所の書き換え・フォーマッタの折り返し）にも当てる形に書き直す。

- 文面の案: 既存のコードの行を書き換えたら、そのファイルのパスを `scripts/**/*.mutations.json` で grep する。当たる `find` は、整形の後の行に合わせてから stage する。

- 機構は足さない。pre-commit の `mutations-declaration.test.ts` が既に検出し、失うのは pre-commit の 1 往復だけだからである。
