---
date: 2026-11-06
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# push の前に CI だけで実行する fallow audit を手元で実行せず、テストの表の文字列で Lint が失敗した

## 事象

2026-11-06、PR #922 の最初の push の後、CI の `Lint` が失敗した。
`fallow audit --base origin/main` が、`child-timeout.test.ts` の表に書いた文字列 `"test.skip.each([1])(x)"` を、テストを飛ばす書き方（weakened-tests、skip-only）として検出した。
同じ表の `"it.skip"` は検出されなかった。
手元では lefthook の pre-commit だけを実行しており、`fallow audit` は実行していなかった。

## 根本原因

- なぜ失敗したか → `fallow audit` は、テストのファイルの中の文字列も、テストを飛ばす書き方として読むことがある
- なぜ push の前に気付かなかったか → `AGENTS.md` は `fallow audit` を CI だけで実行すると書くが、push の前に手元で実行する手順が無い
- なぜ手順が無いか → CI だけのチェック（`fallow audit`・CRAP）は差分とカバレッジが要るので pre-commit に入れておらず、文書も実行する時点を書いていない

## 根拠

CI の `Lint` のログに `weakened-tests:scripts/lib/testing/child-timeout.test.ts:432:test.skip.each,severity=error,kind=skip-only` が出た。文字列を替えると、手元の `fallow audit` は exit 0 になった。
再発は確かめていないので medium にした。

## 提案

`docs/tooling.md` の fallow の節に、テストを変えた PR は push の前に手元で `fallow audit` を実行すると書く。

- コマンドは CI と同じ `pnpm exec fallow audit --base origin/main --dead-code-baseline .config/fallow/dead-code-baseline.json` にする
- テストの表に `.skip.each` のような文字列を書くと、`fallow audit` がテストを飛ばす書き方として検出することも添える
