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

- ignore は PR を閉じて以後の通知を止める外向きの操作なので、単位を選んだら、付ける前にユーザーの承認を得る
- 単位ごとに止まる範囲が違う。PR が上げる先の版（7.0.2）について、minor はその minor の版（7.0.x）を、major はその major の版（7.x）を、patch はその版だけを止める。
  7.1 を待つなら minor、8.0 を待つなら major、直後の patch を待つなら patch を選ぶ
- 0.x の依存で Dependabot が各単位をどう数えるか（0.3→0.4 を minor と major のどちらとして扱うか）は、公式の文書に無い。確かめるまでは、0.x の依存の見送りもユーザーに確認する
- 待つ版が直後の版でないとき（7.0 の PR で 7.2 を待つなど）は、間の版（7.1）の PR も作られる。その PR も同じ理由で見送るかを確かめる
- major を選ぶのは、次の major を待つときだけにする。その major を使わないと決めたときの扱いは、前例が無く決まっていないので、適用するときにユーザーと決める。
  `dependabot.yml` の ignore に書くなら、`update-types: version-update:semver-major` は次の major も止めるので、`versions` でその major だけを指す
- 待つ条件が版で表せない（他のツールの対応を待つなど）ときは、単位を決めずにユーザーに確認する
- 公式の文書は、グループの PR 用に `@dependabot ignore <依存の名前> minor version` の形を別に挙げている。
  この形が止める範囲（その minor だけか、minor の更新の種別全体か）は公式の文書から読み切れないので、確かめるまではグループの PR の見送りもユーザーに確認する
- 見送りの理由と解く条件は、dependabot-merge の「判断の記録（PR コメント）」に書く。ignore のコマンドは理由を残さず、条件もファイルとしてリポジトリに残らない
- 単独の PR で付けた条件は、その PR を再び開くか、自分でその版に上げると外れる（公式の文書と、PR #648 への Dependabot の返信）。見送りの理由を確かめるときも、PR は再び開かない
- 見送った PR の候補は、`gh pr list --state closed --author app/dependabot --search "<依存の名前> is:unmerged" --limit 200` で挙げる。
  そのうえで、各 PR の Dependabot の返信（ignore を受けた旨）で特定する。候補には、superseded で閉じた PR や人が閉じた PR も出る。
  グループの PR で見送ったときに、どの PR に記録が残るかは、下の実測の項目で確かめる
- 次の点は、適用するときに公式の文書を読み、Dependabot を有効にした検証用のリポジトリで実測してから手順に書く（このリポジトリの PR では試さない）。
  - グループの形が止める範囲、グループの PR で `ignore this ...` が使えるか、ignore の後にグループの PR が閉じられるか作り直されるか
  - 0.x の依存で、各単位がどの版を止めるか
  - `@dependabot show <依存の名前> ignore conditions` をどの PR に書けば応答するか（見送った依存の PR は閉じている）
  - 条件を指定する `unignore <依存の名前> <条件>` と、グループの PR で付けた条件が、手で依存を上げたときに外れるか
  - `dependabot.yml` の `versions` で 1 つの major だけを指す書き方
- 根拠: <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands>
