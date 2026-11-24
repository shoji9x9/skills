# Sample Service

注文を受け付ける API サーバ。

## 技術スタック

- Node.js と pnpm で開発する。
- エージェントの Hook は `tools/hooks/` に置く。

## 作業の規約

- `package.json` の依存を変えたら、`pnpm install` で `pnpm-lock.yaml` を更新してから、`pnpm install --frozen-lockfile` を実行する。
- PR には関連 Issue、変更の概要、確認した内容を書く。
