# サンプル: Serverless Web App（starter 既定サンプル）

`architecture-*.svg` は、スキルに同梱の starter テンプレート（`assets/starter/architecture-spec.mjs`・`environments.mjs`）を、そのままエンジンで描いたデフォルトのサンプルである。
作図ルールに沿った仕上がりと、1 つの base の spec と変換による環境の出し分けの参考として同梱する。

- 実在の特定のシステムではない、汎用の例（典型的なサーバーレス Web アプリ）である。
- `architecture-prod.svg`: base をそのまま描いた環境（prod）
- `architecture-local.svg`: base をローカル開発向けに変換した環境（local）

## アイコンの扱い

これらの SVG には AWS 公式アイコンが埋め込まれている。
AWS はアーキテクチャ図を作る目的でのアイコンの利用を許諾しており、このサンプルはその範囲で作った完成した構成図である（再利用できるアイコン素材集としての配布ではない）。
AWS はアイコンを四半期ごとに更新し、見た目が変わることがあるので、生成し直すときは版を混在させない。
出典と利用条件は、スキルの `references/icons.md` にある。

## 生成し直す手順

```bash
SKILL=../../..    # 本スキルルート（assets/engine を含む）
DIAGRAM_DIR="$SKILL/assets/starter" DIAGRAM_OUT_DIR=. \
  node "$SKILL/assets/engine/render-diagram.mjs"
```
