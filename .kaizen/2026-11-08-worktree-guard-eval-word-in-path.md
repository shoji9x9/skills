---
date: 2026-11-08
type: doc
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# worktree の隔離中は、eval などのシェルの組み込みの名前を含むパスも、スクリプトのファイルから実行する

## 事象

Issue #933 の作業で worktree に入った後、`scripts/eval` の下を `ls` する呼び出しと、`git ls-files` で `evals/kaizen/...` を挙げる呼び出しが、隔離のガードに拒否された。
拒否の理由は、コマンドが文字列を `eval` に渡しているので worktree の中に留まると確かめられない、というものだった。
どちらの呼び出しも `eval` を実行しておらず、パスの一部に `eval` という語があっただけである。
もう 1 回、`bash <スクリプト> <引数>; echo rc=$?` の複合コマンドが拒否された。
どれも、Write ツールでスクリプトを書いて `bash <絶対パス>` で実行する形に直して通した。

2026-11-09、Issue #930 の作業で worktree に入った後、同じ形で 2 回拒否された。
eval の採点の手順を調べるために `ls scripts/eval/` を実行した呼び出しと、`ls scripts/eval` を単独で実行した呼び出しである。
拒否の理由は、前回と同じく、文字列を `eval` に渡しているというものだった。
単独のコマンドにしても通らず、`docs/skill-development.md` を Read ツールで読む方法に切り替えて先へ進んだ。
この学びはセッション開始時の注入の一覧から外れていた（priority が low で、注入する件数の上限を超えた）。

## 根本原因

- なぜ拒否されたか: ガードはコマンドの文字列を見て判定するので、パスの中の `eval` を組み込みの `eval` の呼び出しと同じに扱った。
- なぜその形を書いたか: `git-worktree` の `references/isolation.md`「判定は文字列で決まる」は、本文にバージョン管理のコマンドの名前が現れる場合だけを挙げている。シェルの組み込みの名前（`eval` など）がパスに現れる場合は書かれていない。
- なぜ前の学びで防げなかったか: 前の学びと規約は、`git` の語と複合コマンドを対象にしている。このリポジトリには eval のランナーと fixture の置き場所（`scripts/eval/`・`evals/`）があり、パスに `eval` を含む呼び出しは頻繁に書く。
- なぜ今回も防げなかったか: この学びは pending のままで、priority が low なので注入の一覧から省かれていた。適用先の `isolation.md` も書き換わっていない。

## 根拠

同じ原因（パスの中の `eval` を組み込みの `eval` として扱う拒否）での再発を、拒否のメッセージで確かめた（high）。

- 観測: 2026-11-08 に 2 回、2026-11-09 に 2 回、パスに `eval` を含む呼び出しが同じ理由で拒否された。スクリプトに書くか Read ツールに切り替えると通った。
- KEDB 照合: `worktree`・`Bash`・`複合` で照合し、`.kaizen/2026-10-14-worktree-bash-literal-guard-recurs.md`（applied）とこの学び（pending）が一致した。
  applied の学びは `git` の語と複合コマンドの拒否で、`eval` の語は扱っていない。この学びの根本原因と今回の原因は同じである。

## 既存の規約

- 扱い: なし
- 場所: なし（近い規約は `skills/git-worktree/references/isolation.md`「隔離中の Bash は 1 コマンドずつ素の形で書く」。対象は `git` の語・組み立てた引数・複合コマンド・ヒアドキュメントで、シェルの組み込みの名前を含むパスは挙げていない）
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/`・`skills/git-worktree/`・`skills/issue-start/` を、`1 コマンドずつ素の形`・`判定は文字列で決まる`・`eval` で検索した。
  2026-11-09 に `skills/git-worktree/references/isolation.md` を `eval` で検索し直し、当たりが無いことを確かめた

## 食い違い

- 相手: なし
- 判断: なし

## 提案

worktree の隔離中は、`eval` などのシェルの組み込みの名前をパスや引数に含む呼び出しも、Write ツールでスクリプトに書いて `bash <絶対パス>` で実行するか、Read ツールで読む。

- 適用先: `skills/git-worktree/references/isolation.md`「判定は文字列で決まる」の段落に、拒否される語の例として、バージョン管理のコマンドの名前に加えてシェルの組み込みの名前（`eval` など）を足す。
- 機構の効果と費用: 誤りの記録は 2 回になったが、ガード自身が拒否して知らせるので、ほかに気付く手段がある。拒否の後の手戻りは 1 回の呼び出しで済む。機構は作らない。
