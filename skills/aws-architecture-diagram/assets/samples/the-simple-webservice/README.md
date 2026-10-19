# サンプル: The Simple Webservice（実 CDK からの setup 例）

公開されている CDK を対象に `aws-architecture-diagram setup` を実行した例である。
starter には影響せず、この 1 ディレクトリだけで完結する。

## 何を示すか

- 情報源は、`cdk-patterns/serverless`（MIT ライセンスの AWS サーバーレスパターン集。<https://github.com/cdk-patterns/serverless>）の `the-simple-webservice` パターンの CDK のコード（`lib/the-simple-webservice-stack.ts`）である。
  パターンの場所は <https://github.com/cdk-patterns/serverless/tree/main/the-simple-webservice> にある。
  - CDK から読み取った構成は、DynamoDB `Hits`、table を読み書きする Lambda `DynamoLambdaHandler`、API Gateway HTTP API `Endpoint`（Lambda proxy 統合）である。
  - 同じリポジトリが提供している構成図の画像は参照していない（CDK のコードだけから作図した）。
  - 出典とアイコンの扱いは [NOTICE.md](NOTICE.md) にある。
- setup の流れを次のとおり再現している。
  1. starter のテンプレート（`architecture-spec.mjs`・`environments.mjs`・`icon-manifest.json`・`icons/`）をこのディレクトリへコピーする。
  2. CDK に合わせて spec を編集する。
  3. スキルに同梱のエンジンでアイコンを取得し、図を生成する。

## このディレクトリの構成

- `architecture-spec.mjs`: CDK から起こした base の仕様（編集済み）
- `environments.mjs`: 環境は `prod` だけ（デプロイ先が 1 つ）
- `icon-manifest.json`: starter からのコピー
- `icons/`: AWS 以外のアイコン（starter からのコピー）。`aws-icons/` は取得したもので、commit しない
- `architecture-prod.svg`: 生成した結果（commit する）

## 生成し直す手順

```bash
SKILL=../../..        # 本スキルルート（assets/engine を含む）
# --icon-dir も渡す。渡さないと、呼び出し元のリポジトリの設定の icon_dir が当たり、アイコンの置き場所がこのディレクトリの外になる
node "$SKILL/assets/engine/fetch-aws-icons.mjs" --dir . --icon-dir ./icons --only api-gateway,lambda,dynamodb
node "$SKILL/assets/engine/render-diagram.mjs" --dir . --icon-dir ./icons --out-dir .
node "$SKILL/assets/engine/preview-diagram.mjs" prod --dir . --icon-dir ./icons --out-dir .
```

生成した SVG には AWS 公式アイコンが埋め込まれる。扱いは [NOTICE.md](NOTICE.md) にある（AWS がアーキテクチャ図を作るために許諾している範囲）。
