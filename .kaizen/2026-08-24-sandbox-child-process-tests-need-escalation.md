---
date: 2026-08-24
type: doc
priority: medium
status: pending
applied-to: []
session: codex
---

# sandbox の子 Node 起動失敗は直ちに sandbox 外で再検証する

## 事象

`pnpm test` を制限付き sandbox 内で実行したところ、`spawnSync(process.execPath, ...)` が
`EPERM` になり、7 テストが失敗したままプロセスが約 212 秒終了しなかった。

## 根本原因

テストが mise 配下の Node を子プロセスとして起動していたが、sandbox はその実行を許可しなかった。
失敗出力に `spawnSync ... EPERM` が出ていたにもかかわらず、実行中セッションを待ち続けた。
このリポジトリの子プロセステストに対する、sandbox 起因エラーの切り分け手順が明文化されていなかった。

## 提案

制限付き sandbox のテストで子プロセス起動の `EPERM` を確認したら、同じ環境で待機・再試行せず、
プロセスを終了して承認付きの sandbox 外実行で検証する。
