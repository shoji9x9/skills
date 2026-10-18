---
date: 2026-10-17
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# 変異の定義の find がコードと合わないことを、全件の実行の後で知った

## 事象

PR #665 のレビューの指摘を直すときに、デフォルトブランチの判定を `gate.mjs` から `repo.mjs` の `isDecisionBranch` に移した。
`agent-usage.mjs` に足した行は、整形で折り返された。
その後に `cli.mutations.json` の全件（68 件。10 分以上かかる）を実行し、4 件が FAIL になった。

- 2 件は、find の出現数が 0 件だった。移した行と、整形で折り返した行である
- 2 件は、新しく足したテストでも落ちたのに、そのテストを `expect_failing` に書いていなかった

定義を直して、全件をもう一度実行した。

2026-10-18、PR #696（#679）で `blankComments` の呼び出しに引数を足した。
この行を find に持つ変異 3 件（3 つの定義ファイルに 1 件ずつ）が、出現数 0 件で FAIL になった。
足したテストが既存の変異も落とすようになり、`expect_failing` の外で落ちたものも 5 件あった。
どちらも、143 件の全件の実行（約 3 分）の後で分かり、定義を直してもう一度全件を実行した。
この記録はセッション開始時に注入されていたが、行を書き換える前に find を grep しなかった。

## 根本原因

- なぜ全件の実行の後で分かったか → find が当たらないことを、ランナーは変異を 1 件ずつ実行する段で初めて報告する。
  他の変異のテストを実行し終えるまで、結果を読めない
  - なぜ先に確かめなかったか → find の出現数は `scripts/mutation/mutations-declaration.test.ts` が数秒で確かめる。
    しかし、全件を実行する前にそれを実行する手順が無い。AGENTS.md の「一括で書き換える前に、その文字列を鍵にする他のチェックを挙げる」も、行を移すときには当てていなかった
    - なぜ規律が機能しなかったか → 規律は書き換える人が思い出す前提で、ランナー自身は安い検査を先に行わない ← 根本原因
- 学び `2026-09-27-new-test-reshapes-existing-mutations`（applied）と `2026-10-07-bulk-rewrite-keyed-checks`（applied）と同じ種類の事象が、適用した後に再び起きた

## 提案

ミューテーションテストのランナーは、テストを 1 件も実行する前に、対象の全定義の find の出現数を確かめ、合わないものがあればまとめて exit 2 で止める。

- 適用先: `scripts/mutation/check-mutation-proof.ts`。基準の run より前に、`mutations-declaration.test.ts` と同じ出現数の検査を当てる
- `expect_failing` の抜けは事前には分からない。ただし、宣言の外で落ちたテストの名前は、全件の実行の後にまとめて出せば、1 回の再実行で直せる
- 手で回すときは、全件の前に `pnpm exec vitest run scripts/mutation/mutations-declaration.test.ts` を実行する
