---
date: 2026-11-08
type: doc
priority: medium
confidence: low
status: pending
applied-to: []
session: claude-code
---

# stage していない変更を lefthook run pre-commit --file で検査すると、直す前の内容の結果が出続けた

## 事象

worktree で、stage していない変更（新しいファイルを含む）を `pnpm exec lefthook run pre-commit --file <path>...` で検査した。
oxlint・fallow・textlint の指摘を直した後に 2 回実行し直したが、2 回とも直す前と同じ行番号・同じ内容の指摘が出た。
同じファイルに oxlint・fallow・lint-prose を直接実行すると、指摘は 0 件だった。
ファイルを stage してから `lefthook run pre-commit`（`--file` なし）を実行すると、今の内容が検査され、残っていた本当の指摘（型の検査）だけが出た。

## 根本原因

- なぜ直したのに同じ指摘が出たか: lefthook が、作業ツリーの今の内容ではない内容を検査していた（直接実行した結果と食い違った）
- なぜ今の内容でないのか: 推測であり、確かめていない。lefthook の pre-commit が stage していない変更を退避してから検査する仕組み、または `{staged_files}` を使う job が `--file` の指定と合わない扱いをしている可能性がある
- なぜ気付くのが遅れたか: 前のセッションで、同じ形のスクリプト（変更したファイルを `--file` で渡す）が使えていたので、結果を疑わずに 2 回やり直した

## 根拠

確信度が low なのは、lefthook がどの内容を検査したかを確かめておらず、原因を 1 つに絞れていないためである。
このセッションで、`lefthook run pre-commit --file` を 3 回実行した。直した後の 2 回も、直す前と同じ 5 件の oxlint の指摘と、fallow・lint-prose の指摘が出た。同じファイルにツールを直接実行すると、どの指摘も出なかった。stage した後の実行では、型の検査の 1 件だけが出て、直すと全件が通った。
KEDB 照合（`lefthook` と `stage`、`lefthook` と `--file`）では、同じ事象の学びは見つからなかった。

## 既存の規約

- 扱い: なし
- 場所: なし
- 照合した範囲: `AGENTS.md`・`CLAUDE.md`・`docs/`・`.agents/rules/`・`skills/kaizen/` を `lefthook run pre-commit` と `--file` で検索した。当たった `docs/agent-workflow.md`「検証は目的を果たす最小の範囲で実行する」は `--all-files` の副作用の話で、検査する内容が今の作業ツリーかは扱っていない

## 提案

pre-commit のチェックを手元で通すときは、対象のファイルを stage してから `lefthook run pre-commit` を実行し、stage していない変更を `--file` で検査した結果は、ツールを直接実行した結果と食い違えば信用しない。

- 適用の前に、lefthook が stage していない変更をどう扱うか（退避するか、`{staged_files}` の job が `--file` で何を受け取るか）を、使い捨ての worktree で確かめる
- 原因が確かめられたら、`docs/tooling.md` の pre-commit の節に、手元で検査するときの手順を 1 行足す
