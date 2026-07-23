---
date: 2026-07-23
type: rule
priority: medium
status: pending
session: claude-code
---

# 秘密値の argv/ps 露出対策は「値が渡る全プロセスの argv」を塞ぐ

## 事象

Issue #120 で `box-oauth-init.sh` の認可コードを引数受け取り → stdin に変えて ps/proc 露出を消したが、
直後の `curl` が同じ認可コード・`client_secret` を `--data-urlencode "k=$v"` として argv に載せ、
curl 実行中（≒スクリプト全実行時間）ずっと `ps` / `/proc/<pid>/cmdline` から可視のままだった。
code-review が「対策の目的（引数では渡さず ps/proc への露出を避ける）がほぼ達成できていない」と指摘。
curl を `name@file` 経由（umask 077 の一時ファイル）にし argv からファイル名だけにして解消した。

## 根本原因

露出面をエントリスクリプトの argv だけと捉え、同じ秘密値を argv で受け取る子プロセス（curl）の argv を
露出面に数えなかった。「この値を ps/proc から見えなくする」というゴールを、着手した 1 経路
（スクリプト引数）の除去で満たしたと見なした。値が argv で渡る全プロセスを通しで塞がないとゴールは未達で、
curl の実行時間 ≒ スクリプト実行時間のため curl argv 露出を残すと mitigation はほぼ無効。
ハードニング系の対策で「対策のゴール」ではなく「着手した 1 経路の除去」を完了条件にした思い込みが根本。

## 提案

秘密値を ps/proc（argv）露出から守る対策は、**値が argv で渡る全プロセスを通しで塞ぐ**。
エントリの露出だけ消しても、同じ値を argv で受け取る子プロセス（curl 等）が残れば目的は未達。

- 具体（`skills/**` の shell スクリプト）: curl に秘密を渡すときは `--data-urlencode "k=$v"`
  （値が curl の argv に載る）ではなく、`umask 077` の一時ファイルに書いて `--data-urlencode "k@file"`
  （curl がファイルを読んで URL エンコード。argv にはファイル名だけ）を使い、`trap '...' EXIT` で掃除する。
  送信ボディは `name=value` 直挿しと同一（Issue #120 でローカル検証済み）。秘密でない識別子（`client_id` 等）は直挿し可。
- 配置: `skills/**` スコープの `.agents/rules/curl-data-urlencode.md`（[[curl-api-example-urlencode]] で追加済み・
  現状はエンコード正しさの観点）に「秘密値の argv 露出」観点を追記して統合する。
- レビュー観点としても: 「値を argv から外した」対策を見たら、その値の**次の渡し先**（子プロセスの argv）まで
  追い、露出が本当に消えているかを確認する。関連: [[secret-echo-back-prohibition]]。
