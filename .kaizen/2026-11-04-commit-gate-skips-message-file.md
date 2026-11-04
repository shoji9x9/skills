---
date: 2026-11-04
type: hook
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# commit の前のチェックが呼び出し全体を止め、同じ呼び出しで作るはずの message のファイルが無いまま、後の commit が失敗した

## 事象

PR #884（#864）の pr-finalize-loop の反復 5 で、commit message のファイルを heredoc で書く処理・commitlint・`git add`・`git commit` を、1 つの Bash の呼び出しにまとめた。
kaizen の PreToolUse のチェックが、呼び出し全体を止めた。
kaizen の記録を済ませてから `git commit` だけを実行し直すと、message のファイルが無く `could not read log file` で失敗した。

## 根本原因

- なぜファイルが無かったか: PreToolUse のチェックに止められた呼び出しは、どのコマンドも実行されていない
- なぜまとめたか: 呼び出しの回数を減らすために、`AGENTS.md`「commit message」の禁止（`git commit` を含む呼び出しに、`git add` や message ファイルの作成を入れない）を破った
- なぜ気付かなかったか: チェックの案内は「kaizen を済ませて `git commit` を再実行」とだけ書き、同じ呼び出しの他のコマンドも実行されていないことを示さない ← 根本原因（対策可能）

## 根拠

止められた後に message のファイルが無いことを `ls` で確かめ、失敗を再現したので high にした。
KEDB 照合は「could not read log file」「git commit」で一致が無かった。
近い学びは `.kaizen/2026-10-30-commit-after-refused-stage.md`（拒否された stage の後に commit が実行された）で、今回は止められた呼び出しの中の準備が実行されなかった側である。

## 提案

commit の前のチェックで止められたら、同じ呼び出しの他のコマンド（message のファイルの作成・`git add`）も実行されていないものとして、準備からやり直す。

- `kaizen-precommit-gate.sh` の止める案内に、「この呼び出しの他のコマンドも実行されていない。message のファイルの作成と `git add` からやり直す」を 1 行足す
- 効果: 同じ失敗は `AGENTS.md` に注意点として書かれるほど繰り返している。案内は止められた直後に必ず読まれる
- 費用: 案内の文字列 1 行と、それを確かめるテスト 1 件だけ
