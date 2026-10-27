---
date: 2026-10-21
type: skill
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# gh issue develop で紐付けた branch の PR は、本文が Refs でも merge で Issue を completed として閉じる

## 事象

issue-batch で、チェックを作らずに規約を足して閉じると決めた Issue の PR を、本文を `Refs #<番号>` にして作った。
merge の後に not planned で閉じる予定だったが、merge の時点で Issue は completed として閉じられていた。
理由をコメントし、開き直してから not planned で閉じ直した。

2026-10-27 に、issue-start で #659 の PR #792 を作った。受け入れ条件の検査が `closable: false` を返したので、本文は `Refs #659` にした。
merge の 1 秒後に #659 は閉じられ、次の PR #795 も、閉じた Issue を参照したまま作って merge した。
利用者に問われて調べるまで、閉じたことに気付かなかった。

## 根本原因

branch を `gh issue develop` で作ると、GitHub はその branch を Issue の開発の欄に紐付ける。
紐付けた branch の PR が既定の branch に merge されると、本文の書き方（`Closes` か `Refs` か）に関わらず Issue を閉じる。
手順は「閉じるかどうかは PR の本文の語で決まる」と前提にしていて、紐付けによる close を数えていなかった。

## 根拠

1 回の観測だが、PR の本文は `Refs` だけで、閉じたのは merge の時刻だったので、紐付けが原因だと 1 つに絞れる。
merge の待ちのスクリプトが Issue の状態を CLOSED と報告し、`stateReason` は COMPLETED だった。
KEDB 照合（「not planned」と「close」、「gh issue develop」と「close」）で一致した学びは無かった。

2026-10-27 の観測は、同じ原因による 2 回目である。timeline の closed は `commit_id` も `source` も空だった。
PR の本文に `Closes` は無く、このセッションで `gh issue close` を実行した記録も無い。issue-batch だけでなく、issue-start でも起きる。

## 提案

issue-start と issue-batch で、`closable` が false の Issue や completed 以外で閉じると決めた Issue は、merge の後に状態と `stateReason` を取得し直し、決めた状態と違えば理由をコメントして開き直す。

- issue-start の `--pr` の手順か PR の本文に、紐付けた branch の merge が Issue を閉じることを書く。
- `closable` が false なら、`gh issue develop` で紐付けない branch を使う案も検討する。
- issue-batch の「merge、close、deployment」の手順にも、同じ確認を置く。

決めた状態と違えば、理由をコメントしてから開き直し、決めた理由で閉じ直す（開いたまま残すなら開き直すだけにする）。
