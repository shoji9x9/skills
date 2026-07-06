# サンプル: Serverless Web App（starter 既定サンプル）

`architecture-*.svg` は、スキル同梱の starter テンプレート（`assets/starter/architecture-spec.mjs`
／ `environments.mjs`）をそのままエンジンで描いた**既定サンプル**。作図ルールに沿った
仕上がりと、単一ベース spec ＋ 変換による環境出し分けの参考として同梱する。

- 特定の実在システムではない**汎用の例**（典型的なサーバーレス Web アプリ）。
- `architecture-prod.svg` — base をそのまま描いた環境（prod）
- `architecture-local.svg` — base をローカル開発向けに変換した環境（local）

## アイコンの扱い

これらの SVG には **AWS 公式アイコンが埋め込まれている**。AWS はアーキテクチャ図の作成
目的でのアイコン利用を許諾しており、本サンプルはその範囲での**完成した構成図**である
（再利用可能なアイコン素材集としての配布ではない）。四半期更新でアイコンの見た目が
変わることがあるため、再生成時はバージョンを混在させない。出典・利用条件はスキルの
`references/icons.md` を参照。

## 再生成

```bash
SKILL=../../..    # 本スキルルート（assets/engine を含む）
DIAGRAM_DIR="$SKILL/assets/starter" DIAGRAM_OUT_DIR=. \
  node "$SKILL/assets/engine/render-diagram.mjs"
```
