---
date: 2026-10-17
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# push の後に CI のチェックが登録されないときは、待ち続ける前に PR の mergeStateStatus が DIRTY（base との衝突）でないかを確かめる

## 事象

PR #682 に push した後、`gh pr checks --watch` が `no checks reported` で終わった。
PR の `mergeStateStatus` は `DIRTY` で、main が同じ kaizen の学びのファイルに追記していたので衝突していた。
衝突のある PR では `pull_request` の workflow が起動しないので、待っても CI は登録されない。
main を merge して衝突を解くまで、CI は 1 件も実行されなかった。

## 根本原因

- なぜ CI が登録されなかったか → base と衝突した PR では、GitHub が merge の commit を作れず、`pull_request` の workflow を起動しない
- なぜ気づくのが遅れたか → `no checks` を「push の直後でまだ登録されていない」とだけ読み、`mergeStateStatus` を確かめる手順が無かった
- なぜ衝突したか → main と同じ kaizen の学びのファイル（再発を追記していく記録）に、別のセッションと同じ時期に追記した

## 提案

push の後に CI のチェックが登録されないときは、待ち続ける前に PR の `mergeStateStatus` が `DIRTY`（base との衝突）でないかを確かめる。

- 適用先候補: `pr-finalize-loop` の SKILL.md の「`no checks` を確かめ直す」の箇条に、`gh pr view --json mergeStateStatus` で `DIRTY` なら base を merge して衝突を解くことを足す
- 再発を追記していく kaizen の学びは、複数のセッションが同時に追記して衝突しやすい。衝突は両方の追記を残して解く
