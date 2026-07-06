# アイコンの取得と出典

図のアイコンは 2 系統。**AWS 公式アイコンはスキルに同梱せず、取得スクリプトで
公式パッケージから取得する**（再配布を避けるため）。非 AWS の汎用アイコンだけ同梱する。

## AWS 公式アイコン（取得スクリプトで用意）

スキル同梱のエンジン `assets/engine/fetch-aws-icons.mjs` が
[AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) の公式パッケージを
取得し、プロジェクトの `icon-manifest.json`（`DIAGRAM_DIR`、既定 cwd）のマッピングに従って
`icons/aws-icons/<id>.svg` を書き出す。図ディレクトリで実行する（`$SKILL` は導入先）。

```bash
cd docs/diagrams                                          # 図ディレクトリ
# 全件取得（icons/aws-icons へ）
node "$SKILL/assets/engine/fetch-aws-icons.mjs"

# 一部だけ / 出力先を直接指定
node "$SKILL/assets/engine/fetch-aws-icons.mjs" --only lambda,dynamodb,s3
node "$SKILL/assets/engine/fetch-aws-icons.mjs" --out path/to/icons/aws-icons
```

- パッケージ URL は四半期ごとに変わるため固定せず、公式ページから現行の
  `Icon-package_*.zip` を**動的に抽出**する。ZIP は Node の `zlib` だけで展開する
  （`unzip` / `python` への依存なし）。
- マニフェストに載っていて見つからなかった id は **stderr に警告**する。AWS 側の
  ファイル名変更で取りこぼしたら、公式パッケージの
  `Architecture-Service-Icons_*/Arch_*/64/Arch_<name>_64.svg` を見て
  `icon-manifest.json` の値（`Arch_` と `_64` を除いた部分）を直す。
- サービスを増やすときは `icon-manifest.json` の `aws` に `id: "<AWSサービス名>"` を足す。
- 取得後、出典・利用条件を記した `NOTICE.md` が同じディレクトリに書き出される。

### 利用条件（要確認）

AWS はアーキテクチャ図の作成目的でのアイコン利用を許諾している。四半期更新のため
バージョンを混在させない。**社外配布物へ転用する場合は、配布元パッケージ同梱の Terms と
AWS の商標／ブランドガイドラインを確認する**（AWS との提携を誤認させる使用は不可）。
本スキルは SVG を同梱せず取得方式にすることで、この確認をアイコン利用者に委ねている。

## 非 AWS アイコン（テンプレートに同梱）

テンプレート `assets/starter/icons/` に汎用アイコンを同梱する（本スキルのために新規に
描き起こしたオリジナル。第三者アイコンセットの流用・派生ではなく、自由に利用・再配布可。
出典は同ディレクトリの `NOTICE.md`）。setup 時にプロジェクトの `icons/` へコピーされる。

- `browser.svg` — ブラウザ（利用者）
- `internet.svg` — 外部 API / インターネット

自作アイコンを足すときは `viewBox` 付きの単一 `<svg>` としてプロジェクトの `icons/` に置き、
spec の `icon` に拡張子なしのパス（例 `"internet"`）で参照する。描画エンジンが
`<?xml>` と外側の `<svg>` を剥がして元の `viewBox` を保ったまま埋め込む。

## アイコンの参照方法（spec 側）

`node.icon` は iconDir（プロジェクトの `icons/`＝ `DIAGRAM_DIR/icons`）からの相対パス
（拡張子なし）。

- AWS: `"aws-icons/lambda"`, `"aws-icons/dynamodb"` …（`fetch-aws-icons.mjs` の出力）
- 非 AWS: `"browser"`, `"internet"`
- `icon: null` はアイコンなしの無地の箱を描く。
