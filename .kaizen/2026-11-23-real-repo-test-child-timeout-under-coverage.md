---
date: 2026-11-23
type: code
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 実リポジトリを走査する子プロセスのテストが、手元のカバレッジ付きの実行で 25 秒の制限を超えて必ず落ちる

## 事象

Issue #1112 で `pnpm run test:coverage` を手元で 3 回実行し、3 回とも `check-skill-lint-directives.test.ts` の「実リポジトリ: 違反が無い」が `status: null` で落ちた。
テストが失敗すると `run-coverage.ts` は V8 の記録を消すので、CRAP の検査を手元で試せなかった。
測るためにテストを一時的に外す必要があり、`test.skip` で外した回は `oxlint-pending.test.ts` が違反として検出して、1 回分（約 5 分）がむだになった。

## 根本原因

- なぜ落ちたか: 子プロセスの `timeout` が `CHILD_TIMEOUT_MS`（25 秒）で、検査のスクリプトがそれより長くかかった。
- なぜ長いか: スクリプトの単独の実行が、カバレッジなしで 12 秒、`NODE_V8_COVERAGE` 付きで 36 秒かかった（手元・8 コア）。カバレッジで約 3 倍になる。
- なぜ気付かれなかったか: CI では通る。`child-timeout.test.ts` は書いた値の大小を比べるだけで、実際の所要時間は測らない。PR #1111 でも同じ失敗が出たが、変更前も同じとして扱った。
- 根本原因: 実リポジトリ全体を走査する子プロセスに、全体で一律の 25 秒を使っている。所要がリポジトリの大きさとカバレッジの有無で伸びることを、値に反映していない。

## 根拠

- `node scripts/gates/code/check-skill-lint-directives.ts` の所要: カバレッジなし 12 秒、`NODE_V8_COVERAGE` 付き 36 秒（同じ手元で 1 回ずつ測った）。
- `test:coverage` の全件の実行 3 回で、3 回とも同じテストが `status: null` で落ちた。
- 確信度は、事象と原因（所要と制限の比較）を測って確かめたので high とする。

## 既存の規約

- 照合した範囲: `AGENTS.md`、`docs/`、`.agents/rules/` を「実リポジトリ」と timeout・秒・カバレッジの語で検索した
- 扱い: `なし`
- `docs/testing.md`「実行環境を固定する」は、子プロセスに `CHILD_TIMEOUT_MS` を付けることと、`testTimeout` と長さが違うテストでは値を引数で渡すことを決めている。所要がカバレッジで伸びる子プロセスの値の決め方は無い。

## 食い違い

- 相手: 無し（pending の学び・規約・利用者の指示に、反対の振る舞いを求めるものは見つからなかった）

## 提案

`check-skill-lint-directives.test.ts` の「実リポジトリ: 違反が無い」を、カバレッジ付きの手元の所要を測った値で、テストの `timeout` と子プロセスの `timeout` を長くする。

- 先に、検査のスクリプトがカバレッジなしで 12 秒かかる理由を測る。走査を減らせるなら、値を伸ばす前に直す。
- 同じ形のテスト（実リポジトリ全体を子プロセスで走査するもの）を挙げ、カバレッジ付きの所要を 1 件ずつ測る。
- `docs/testing.md` に、実リポジトリを走査する子プロセスの値は、カバレッジ付きで測った所要から決めると書く。
