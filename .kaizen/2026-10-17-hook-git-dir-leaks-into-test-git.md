---
date: 2026-10-17
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# git の hook から起動したテストの git が、hook の GIT_DIR を受け継いで起動したリポジトリを書き換えた

## 事象

issue-batch の run で、#632 の branch を worktree（`.claude/worktrees/632`）から push した。
pre-push の `pnpm run test:coverage` で 59 件のテストが失敗し、共有のリポジトリ（`~/projects/skills/.git`）に次の変更が残った。

- ローカルの設定に `core.bare=true`・`user.name=t`・`user.email=t@example.com`
- #632 の branch にテストの commit（`base`・`seed`）が 2 件
- テストの branch 4 本と、`/tmp` の worktree の登録
- worktree 632 の HEAD と index が `feature/日本語` に切り替わった

push は失敗したので remote は変わらなかった。共有のリポジトリの復旧は auto mode の権限のチェックに止められ、利用者に復旧のスクリプトを 2 回実行してもらった。
1 回目のスクリプトは、worktree の登録を外す前に branch を消そうとして `set -e` で止まった。

## 根本原因

- なぜ共有のリポジトリが書き換わったか → テストが一時ディレクトリで起動した git が、親の環境の `GIT_DIR` を使った
  - なぜ `GIT_DIR` があったか → git は worktree からの push で、pre-push の hook に `GIT_DIR` を絶対パスで渡す。
    使い捨てのリポジトリで測ると、main の作業ツリーからの push では渡さず、worktree からの push では渡した。pre-commit には `GIT_INDEX_FILE` なども渡す
    - なぜテストがそれを受け継いだか → テストの子プロセスは `process.env` を受け継ぐ。
      `docs/testing.md` は `HOME`・`PATH` などを固定するよう求めていたが、hook から実行したときに git が足す変数は挙げていなかった ← 根本原因
      - main の作業ツリーから push してきた間は、`GIT_DIR` が渡らないので表に出なかった。worktree から push する issue-batch で初めて起きた

## 提案

git の hook から起動するテストとツールは、子プロセスの git を起動する前に、hook が渡すリポジトリに固有の変数（`git rev-parse --local-env-vars` の一覧と `GIT_CONFIG_KEY_<n>`・`GIT_CONFIG_VALUE_<n>`）を外す。

- 適用済みの部分: #632 の PR で、vitest の `setupFiles` の先頭に `scripts/lib/testing/vitest-git-env-setup.ts` を足した。
  使い捨てのリポジトリを `GIT_DIR` に指定して全テストを実行し、修正の前は commit と branch が作られ、修正の後は変わらないことを確かめた
- 横断の範囲で残っているもの: vitest の外で git を起動するもの（lefthook の各ジョブのスクリプト、`scripts/coverage/run-coverage.ts` 自身、`scripts/eval/` のランナー、配布スキルの Hook のスクリプト）。
  hook から起動されるかを挙げ、起動されるなら同じ変数を外すか、外さなくてよい理由（作業ツリーそのものを対象にする）を書く
- 共有のリポジトリを戻すスクリプトは、依存する順（worktree の登録を外す → branch を消す）に並べ、1 つの失敗で残りが止まらないようにする
