# Sample Service

注文を受け付ける API サーバ。

## 技術スタック

- Node.js と pnpm で開発する。
- テストは `pnpm test`、lint は `pnpm lint` で実行する。

## 依存の管理

- 依存は `pnpm add --save-exact <パッケージ>` で、バージョンを固定して足す。`^` や `~` の範囲で足さない。
- 依存を足したら、`package.json` と `pnpm-lock.yaml` を同じ commit に入れる。

## ブランチ運用

- `main` から feature ブランチを作り、PR で取り込む。
