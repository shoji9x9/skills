---
date: 2026-06-03
type: doc
priority: high
status: applied
session: claude-code
---

## 事象

`git add <files>` と `git commit` を 1 つの bash 呼び出しにまとめて実行したところ、
kaizen の PreToolUse ゲートが「`git commit` を含む呼び出し全体」を実行前にブロックした。
その結果 `git add` も走らず staging されないまま進み、修正が未コミットのまま push され
かけた（HEAD を確認して検知し、別コマンドで commit し直した）。

（2026-06-05 再発・別形）`git commit -F /tmp/msg.txt` 用のメッセージを heredoc で作る処理を、
`git commit` を含む（ゲートにブロックされうる）コマンドに同梱していた。ブロック時に heredoc も
実行されずファイルが作られず、後続ターンで `git commit -F` がファイル不在で失敗。stage 済みだった
変更が残り、次の `git commit` に巻き込まれて「無関係な 2 変更を 1 コミットに混在・誤ラベル」させた。

## 根本原因

ゲートの注意書きは「センチネル削除と `git commit` を 1 コマンドにまとめるな」だが、これは
`rm` に限らず `git add` などコミット前準備全般に当てはまる。`git commit` を含む bash 呼び出しは
丸ごとブロックされる、という一般則を見落としていた。

## 提案

- コミット前の `git add` 等は `git commit` と必ず別コマンドで実行する（同一コマンドだと
  ゲートが全体をブロックし staging も実行されない）。コミット後は `git log` / `git show` で
  対象が実際に入ったか確認する。
- `git commit -F <msg>` のメッセージファイルは、`git commit` と同じ（ゲートでブロックされうる）
  コマンド内の heredoc で作らない。別コマンドで先に作る（短ければ `-m` を使う）。使う直前に
  ファイルの存在を確認する。
- 論理コミットを連続で分けるときは、各 `git commit` の**成功を確認してから**次を stage する。
  失敗したコミットは stage を残し、次のコミットに巻き込まれて混在・誤ラベルの原因になる。
