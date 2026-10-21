---
date: 2026-10-21
type: skill
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# gh issue develop で紐付けた branch の PR は、本文が Refs でも merge で Issue を completed として閉じる

## 事象

issue-batch で、チェックを作らずに規約を足して閉じると決めた Issue の PR を、本文を `Refs #<番号>` にして作った。
merge の後に not planned で閉じる予定だったが、merge の時点で Issue は completed として閉じられていた。
理由をコメントし、開き直してから not planned で閉じ直した。

## 根本原因

branch を `gh issue develop` で作ると、GitHub はその branch を Issue の開発の欄に紐付ける。
紐付けた branch の PR が既定の branch に merge されると、本文の書き方（`Closes` か `Refs` か）に関わらず Issue を閉じる。
手順は「閉じるかどうかは PR の本文の語で決まる」と前提にしていて、紐付けによる close を数えていなかった。

## 根拠

1 回の観測だが、PR の本文は `Refs` だけで、閉じたのは merge の時刻だったので、紐付けが原因だと 1 つに絞れる。
merge の待ちのスクリプトが Issue の状態を CLOSED と報告し、`stateReason` は COMPLETED だった。
KEDB 照合（「not planned」と「close」、「gh issue develop」と「close」）で一致した学びは無かった。

## 提案

issue-batch の「merge、close、deployment」の手順で、completed 以外で閉じるか開いたまま残すと決めた Issue は、merge の後に状態と `stateReason` を取得し直す。

決めた状態と違えば、理由をコメントしてから開き直し、決めた理由で閉じ直す（開いたまま残すなら開き直すだけにする）。
