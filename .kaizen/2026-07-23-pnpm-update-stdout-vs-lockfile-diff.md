---
date: 2026-07-23
type: skill
priority: low
status: pending
session: claude-code
---

# pnpm update の stdout サマリは lockfile 差分と一致しない

## 事象

Issue #113（transitive `fast-uri` を 3.1.4 へ）の着手で `pnpm update fast-uri` を実行したところ、
stdout サマリに `devDependencies: - markdownlint-cli2 0.23.0 + markdownlint-cli2 0.23.1` と表示され、
対象外パッケージの混入を疑った。しかし `git diff pnpm-lock.yaml` は fast-uri のみの差分で、
`git show HEAD:pnpm-lock.yaml` を見ると committed lockfile は既に `markdownlint-cli2@0.23.1` だった。
stdout の増減は node_modules を lockfile 記載へ整合させた表示で、commit 対象（lockfile 差分）ではなかった。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ混入を疑ったか? → `pnpm update` の stdout サマリ（`- pkg X + pkg Y`）を commit 差分とみなした。
  - なぜズレたか? → stdout サマリは node_modules の実インストール状態の増減も報告し、
    lockfile が既に新しい場合は「lockfile 差分ゼロなのに stdout には増減が出る」。
    - なぜ気づきにくいか? → 既存の学び [[2026-06-17-pnpm-peer-keyed-transitive-update]] は
      「update が lockfile に無関係 float を*足す*」逆方向のケースで、stdout が lockfile 差分を
      *過大表示*する本ケースは未記載。← 根本原因（対策可能）

KEDB 照合: `2026-06-17-pnpm-peer-keyed-transitive-update.md`（applied）が最も近い。同ノートの提案 #4
「float 範囲は `git diff` の base `name@version` 比較で確認する」と同じ方向だが、本件は stdout が
*過大*に見える別モードで補完関係。

横断スコープ: `pnpm update <pkg>` を使う任意の依存更新（Dependabot 手動対応・脆弱性対応・transitive bump）で、
stdout サマリだけを見て「混入した／していない」を判断すると誤りうる。判断の権威は常に lockfile 差分。

## 提案

混入・float の有無は stdout サマリでなく `git diff pnpm-lock.yaml`（必要なら `git show HEAD:pnpm-lock.yaml`）で
判断する。stdout の依存増減は node_modules 整合を含み、commit 対象（lockfile 差分）と一致しない。
[[2026-06-17-pnpm-peer-keyed-transitive-update]] の「float 範囲は git diff で確認」を、
「stdout は過大表示もあり得るので lockfile 差分が唯一の権威」と補強する（適用先も同ノートと同じ
`pnpm-audit-alert-issue` / `dependabot-alert-issue` の実装手順・裏取り例）。
