# サンプル: The Simple Webservice（実 CDK からの setup 例）

公開 CDK を対象に `aws-architecture-diagram setup` を実行した**動作例**。starter に影響を
与えず、この 1 ディレクトリだけで完結する。

## 何を示すか

- **情報源**: `cdk-patterns/serverless`（MIT ライセンスの AWS サーバーレスパターン集。
  <https://github.com/cdk-patterns/serverless>）の `the-simple-webservice` パターン
  （<https://github.com/cdk-patterns/serverless/tree/main/the-simple-webservice>）の
  **CDK コード**（`lib/the-simple-webservice-stack.ts`）。
  - CDK から読み取った構成: DynamoDB `Hits` ／ Lambda `DynamoLambdaHandler`（table を
    read/write）／ API Gateway HTTP API `Endpoint`（Lambda proxy 統合）。
  - **同リポジトリが提供する構成図画像は参照していない**（CDK コードのみから作図）。
  - 出典・アイコンの扱いは [NOTICE.md](NOTICE.md) を参照。
- **setup フローの再現**: starter テンプレート（`architecture-spec.mjs` / `environments.mjs` /
  `icon-manifest.json` / `icons/`）をこのディレクトリへコピー → CDK に合わせて spec を編集 →
  スキル同梱エンジンでアイコン取得・生成。

## このディレクトリの構成

- `architecture-spec.mjs` — CDK から起こした base 仕様（編集済み）
- `environments.mjs` — 環境は `prod` のみ（単一デプロイ）
- `icon-manifest.json` — starter からのコピー
- `icons/` — 非 AWS アイコン（starter からのコピー）。`aws-icons/` は取得物（未コミット）
- `architecture-prod.svg` — 生成結果（コミット対象）

## 再生成

```bash
SKILL=../../..        # 本スキルルート（assets/engine を含む）
DIAGRAM_DIR=. node "$SKILL/assets/engine/fetch-aws-icons.mjs" --only api-gateway,lambda,dynamodb
DIAGRAM_DIR=. DIAGRAM_OUT_DIR=. node "$SKILL/assets/engine/render-diagram.mjs"
DIAGRAM_DIR=. DIAGRAM_OUT_DIR=. node "$SKILL/assets/engine/preview-diagram.mjs" prod
```

生成 SVG には AWS 公式アイコンが埋め込まれる。扱いは [NOTICE.md](NOTICE.md) を参照
（AWS のアーキテクチャ図作成許諾の範囲）。
