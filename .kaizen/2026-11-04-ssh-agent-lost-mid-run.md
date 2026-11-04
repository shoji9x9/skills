---
date: 2026-11-04
type: skill
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 長い run の途中で SSH の鍵が使えなくなり、push と `gh issue develop` の取得が失敗した

## 事象

issue-batch の run の途中（#891 の 2 回目の push）で、`git push` が `git@github.com: Permission denied (publickey).` で失敗した。
`ssh-add -l` は `Could not open a connection to your authentication agent.` を返し、ssh-agent に接続できなくなっていた。1 回目の push は成功していた。

その後、#888 の branch を作る `gh issue develop`（`--checkout` なし）は、リモートに branch を作った後の取得で同じエラーになり、exit 1 で終わった。
出力の 1 行目に `github.com/shoji9x9/skills/tree/feature/888-...` が出ていて、branch はリモートにできていた。
どちらも、gh の認証を使う HTTPS に切り替えて続けた。
使った設定は `-c credential.helper= -c 'credential.helper=!gh auth git-credential'` で、取得には `-c url.https://github.com/.insteadOf=git@github.com:` も付けた。

## 根本原因

- なぜ push が失敗したか: セッションが ssh-agent に接続できなくなった。run は数時間続き、途中で agent が無くなった。
- なぜ run の途中まで気付かなかったか: preflight は `gh` の認証を確かめるが、git の remote の転送の認証（SSH の鍵）は確かめない。
- なぜ `gh issue develop` の失敗が紛らわしかったか: 失敗したのはリモートに branch を作った後の取得で、終了コードだけを見ると、branch ができていないと誤って判断して作り直そうとしうる。

## 根拠

push・fetch・`gh issue develop` で 3 回、同じ `Permission denied (publickey)` を観測した。`gh` の API の呼び出しは同じ間も成功していた。
1 つのセッションでの観測なので medium とする。KEDB 照合は `publickey`・`gh issue develop`・`ssh` で行い、一致は無かった。

## 提案

issue-batch の preflight で、git の remote の転送の認証も確かめ（`git ls-remote origin` が成功するか）、run の途中で失敗したら、gh の認証で HTTPS に切り替える手順を `references/orchestration.md` に書く。

- `gh issue develop` が exit 1 でも、出力に branch の URL があればリモートには branch ができているので、作り直さずに取得だけをやり直す、と issue-start の branch の作成の手順に書く。
- 機構は作らない。失敗は git がその場で出すので、手順の追記で足りる。
