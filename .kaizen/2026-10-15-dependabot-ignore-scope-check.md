---
date: 2026-10-15
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# TypeScript 7.0 の Dependabot の PR を見送る案に major の ignore を書き、待ちたい TypeScript 7.1 まで止める形にしていた

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

- 単位が小さすぎると（patch）、同じ minor の次の patch の PR がまた作られる。大きすぎると（major）、待つ版の PR も作られない
- major の ignore は、その major を使わないと決めたときだけにする
- グループの PR では `ignore this ...` の形が使えないので、`@dependabot ignore <依存の名前> minor version` の形で書く
- 根拠: <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands>
