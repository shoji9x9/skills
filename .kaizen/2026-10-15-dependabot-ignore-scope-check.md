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

dependabot-merge の判断ガイドに、見送るときは待つ版を先に決め、待つ版を含まない単位のうち最も大きいもの（7.1 を待つなら 7.0 の minor）で ignore する、と書く。

- 単位ごとに止まる範囲が違う。PR が上げる先の版（7.0.2）について、minor はその minor の版（7.0.x）を、major はその major の版（7.x）を、patch はその版だけを止める。
  7.1 を待つなら minor、8.0 を待つなら major、直後の patch を待つなら patch を選ぶ
- 待つ版が直後の版でないとき（7.0 の PR で 7.2 を待つなど）は、間の版（7.1）の PR も作られる。その PR も同じ理由で見送るかを確かめる
- major を選ぶのは、次の major を待つときだけにする。その major を使わないと決めたときの扱いは、まだ決まっていない。
  前例は `@types/node` で、`dependabot.yml` の ignore に理由を添えて書き、人が定期的に確かめている（docs/vulnerability-handling.md）。
  これに倣うかは、適用するときにユーザーと決める。倣う場合も、`update-types: version-update:semver-major` は次の major も止めるので、
  `versions` でその major だけを指す（書き方は、適用するときに公式の文書で確かめる）
- 待つ条件が版で表せない（他のツールの対応を待つなど）ときは、単位を決めずにユーザーに確認する
- 公式の文書は、グループの PR 用に `@dependabot ignore <依存の名前> minor version` の形を別に挙げている。
  この形が止める範囲（その minor だけか、minor の更新の種別全体か）は公式の文書から読み切れないので、確かめるまではグループの PR の見送りもユーザーに確認する
- 見送りの理由と解く条件は、ignore のコメントだけに残さず PR のコメントに書く（ignore の条件はファイルとしてリポジトリに残らない）。
  付いている条件は `@dependabot show <依存の名前> ignore conditions` で確かめる（グループの PR で使えるかは、下の項目で実測する）
- ignore で閉じた PR を再び開くと、その PR で付けた条件が外れる（PR #648 への Dependabot の返信）。
  見送りの理由を確かめるときは、閉じた PR のコメントを読み、PR は再び開かない。閉じた PR は `gh pr list --state closed --author app/dependabot --search "<依存の名前> is:unmerged" --limit 200` で探す
- 次の点は、適用するときに公式の文書を読み、Dependabot を有効にした検証用のリポジトリで実測してから手順に書く（このリポジトリの PR では試さない）。
  - グループの形が止める範囲と、グループの PR で `ignore this ...` と `show` が使えるか
  - 条件を指定する `unignore <依存の名前> <条件>` と、手で依存を上げたときに条件が外れるか
- 根拠: <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands>
