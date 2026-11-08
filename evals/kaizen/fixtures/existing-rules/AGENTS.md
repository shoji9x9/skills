# Sample Service

注文を受け付ける API サーバ。

## 技術スタック

- Node.js と pnpm で開発する。
- テストは `pnpm test`、lint は `pnpm lint` で実行する。

## シェルの書き方

- パイプでつないだ検証の成否は、`set -o pipefail` か `${PIPESTATUS[0]}` で取る。パイプの末尾の `$?` は、最後のコマンド（`tail` など）の終了コードなので、判定に使わない。
- 一時ファイルは `mktemp` で作り、`trap` で消す。

## ブランチ運用

- `main` から feature ブランチを作り、PR で取り込む。
