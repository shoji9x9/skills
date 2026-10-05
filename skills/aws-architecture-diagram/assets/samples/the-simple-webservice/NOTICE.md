# サンプル: The Simple Webservice — 出典と扱い

## 情報源

- CDK のコードは、`cdk-patterns/serverless`（MIT ライセンスの AWS サーバーレスパターン集）の `the-simple-webservice` パターンである。
  - リポジトリ: <https://github.com/cdk-patterns/serverless>
  - パターン: <https://github.com/cdk-patterns/serverless/tree/main/the-simple-webservice>
- 構成は、上の CDK のコード（`lib/the-simple-webservice-stack.ts`）だけから導いた。
  同じリポジトリが README で提供している構成図の画像は参照していない。

## アイコンの扱い

`architecture-prod.svg` には AWS 公式アイコンが埋め込まれている。
AWS はアーキテクチャ図を作る目的でのアイコンの利用を許諾しており、このサンプルはその範囲で作った完成した構成図である（再利用できるアイコン素材集としての配布ではない）。
AWS はアイコンを四半期ごとに更新し、見た目が変わることがあるので、生成し直すときは版を混在させない。
出典と利用条件は、スキルの `references/icons.md` にある。

AWS 以外のアイコン（`icons/browser.svg`・`icons/internet.svg`）は、このスキルのオリジナルである（`icons/NOTICE.md`）。
