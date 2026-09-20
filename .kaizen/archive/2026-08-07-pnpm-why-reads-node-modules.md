---
date: 2026-08-07
type: skill
priority: high
status: applied
session: claude-code
---

# `pnpm why` は node_modules を読むため lockfile の権威にならない

## 事象

Issue #177（js-yaml / undici / fast-uri の high 脆弱性）の着手で `undici` について、
Issue 本文（2026-08-06 実測: `6.27.0` / `7.28.0` が vulnerable）と `pnpm why undici` の出力
（`6.27.0` / `7.28.0`）が一致したため vulnerable と判断しかけた。

実際には base（remote main）の committed lockfile は `6.28.0` / `7.29.0` のみで、
`pnpm audit` にも undici の advisory は出ていなかった。起票後にマージされた #174
（semantic-release 25.0.5 → 25.0.8）で解消済みだった。
`pnpm install --frozen-lockfile` を実行すると node_modules が同期され、
`pnpm why undici` の出力も `6.28.0` / `7.29.0` に変わった。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ誤った現況を掴んだか? → `pnpm why` は lockfile ではなく **node_modules の実インストール
  ツリー**を読む。`gh issue develop` でブランチを切った直後の node_modules は前回 install 時点の
  ままで、その間に main へマージされた依存更新（#172-#175）が反映されていなかった。
  - なぜ気づかなかったか? → 「Issue 本文」と「`pnpm why`」の 2 情報源が一致したことを裏取りと
    みなした。実際は両者とも「起票時点の古い解決状態」という**同じ軸で古く**、独立していなかった。
    - なぜ独立と誤認したか? → 既存の学び [[2026-07-23-pnpm-update-stdout-vs-lockfile-diff]] は
      「`pnpm update` の *stdout* が node_modules 整合分を含む」と**更新後の判定**に限定して
      書かれており、**着手前のベースライン観測（`pnpm why` / `pnpm list`）も同じ node_modules
      由来**であることが playbook に無かった ← 根本原因（対策可能）

KEDB 照合: [[2026-07-23-pnpm-update-stdout-vs-lockfile-diff]]（applied）が同根で、
「node_modules 由来の出力を lockfile の代理にしない」の別モード（更新後 stdout / 着手前 baseline）。
applied のため追記せず恒久側（`skills/dependabot-alert-issue/references/pnpm-transitive-update.md`）を更新する。

横断スコープ: `pnpm why` / `pnpm list` を使う依存調査全般。加えて、脆弱性 Issue は起票と着手の
間に他 PR（Dependabot 等）がマージされて対象が変わりうるため、着手時点で lockfile 基準で再測定する。
今回 js-yaml / fast-uri は実際に未解消で undici だけが解消済みであり、Issue 本文の全否定ではない
（「本文は古いかもしれない」ではなく「対象ごとに再測定する」が正しい対処）。

## 提案

依存の現況は、インストール済みツリーを読むコマンド（`pnpm why` / `pnpm list`）ではなく
lockfile 基準（`pnpm audit` / lockfile の直接確認 / `git diff pnpm-lock.yaml`）で判定する。
ブランチ切替直後の node_modules は base と乖離しており、古い Issue 本文と「一致」しても
独立した裏取りにならない。先に `pnpm install --frozen-lockfile` で同期してから観測する。

`skills/dependabot-alert-issue/references/pnpm-transitive-update.md` の
「更新結果の判断は lockfile 差分で行う」節を「現況・更新結果とも lockfile を権威にする」へ広げ、
着手前ベースラインの取り方（先に `--frozen-lockfile` で同期／`pnpm why` を単独の根拠にしない／
起票から時間が経った Issue は対象ごとに再測定する）を追記する。

## 適用（2026-08-07・Issue #177）

`skills/dependabot-alert-issue/references/pnpm-transitive-update.md` の当該節を
「判断の権威は lockfile（現況・更新結果とも）」へ改め、着手前ベースラインの手順と本件の実例を追記した。
`pnpm-audit-alert-issue`（private skill）の参照要約も同じ表現へ更新した。
