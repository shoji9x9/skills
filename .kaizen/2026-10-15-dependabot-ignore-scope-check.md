---
date: 2026-10-15
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# TypeScript 7.0 の Dependabot の PR を見送る案に major の ignore を書き、待ちたい TypeScript 7.1 の PR も作られない形にしていた

## 事象

TypeScript 7.0 の PR #648 を「7.1 まで見送る」案として、`@dependabot ignore this major version` を提案した。
major を ignore すると 7.x のすべてが対象になり、待ちたい 7.1 の PR も作られない。
実行の前に公式の文書で意味を確かめ、`ignore this minor version` に直した。

## 根本原因

1. なぜ major を提案したか → PR の種別（major の更新）と ignore の単位を同じものとして選んだ
2. なぜ取り違えたか → 見送りを解く条件（次に待つ版）と、ignore が止める範囲を突き合わせていなかった
3. なぜ突き合わせなかったか → dependabot-merge に、見送りの ignore の単位の選び方が書かれていない

## 提案

dependabot-merge の判断ガイドに、見送るときは待つ版を先に決め、その版を含まない最大の単位（7.1 を待つなら 7.0 の minor）で ignore する、と書く。

- 単位は待つ版で決まる（7.1 を待つなら minor、8.0 を待つなら major、7.0.3 を待つなら patch）。
  7.1 を待つ例では、patch では同じ minor の次の patch の PR がまた作られ、major では 7.1 の PR も作られない
- major の ignore は、その major を使わないと決めたときだけにする
- グループの PR では `ignore this ...` の形が使えず、`@dependabot ignore <依存の名前> minor version` の形になる。
  この形が止める範囲（その minor だけか、minor の更新の種別全体か）は公式の文書から読み切れないので、
  付けた後に `@dependabot show <依存の名前> ignore conditions` で記録された条件を確かめてから、手順に書く。
  対の組のグループは、組のすべての依存に書く（1 つだけでは残りの依存で PR が作り直される）
- 待つ条件が版で表せない（他のツールの対応を待つなど）ときは、単位を決めずにユーザーに確認する
- 見送りの理由と解く条件は、ignore のコメントだけに残さず PR のコメントに書く（ignore の条件はファイルとしてリポジトリに残らない）。
  付いている条件は `@dependabot show <依存の名前> ignore conditions` で確かめる（どの Dependabot の PR でも使える）。
  `@dependabot unignore <依存の名前>` は、公式の文書ではグループの PR の節にだけ載っている
- ignore で閉じた PR を再び開くと、その依存の PR を止めなくなる（PR #648 への Dependabot の返信と公式の文書）。
  見送りの理由を確かめるときは、閉じた PR のコメントを読み、PR は再び開かない
- 根拠: <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands>
