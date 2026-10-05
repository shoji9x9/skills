# アイコンの取得と出典

図のアイコンは 2 種類ある。
AWS 公式アイコンは、再配布を避けるためにスキルに同梱せず、取得スクリプトで公式パッケージから取得する。AWS 以外の汎用アイコンだけを同梱する。

## AWS 公式アイコン（取得スクリプトで用意）

スキルに同梱のエンジン `assets/engine/fetch-aws-icons.mjs` が、[AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) の公式パッケージを取得する。
そして、プロジェクトの `icon-manifest.json`（`DIAGRAM_DIR`、デフォルトは cwd）の対応に従って、`icons/aws-icons/<id>.svg` を書き出す。
図のディレクトリで実行する（`$SKILL` は導入先）。

```bash
cd docs/diagrams                                          # 図ディレクトリ
# 全件取得（icons/aws-icons へ）
node "$SKILL/assets/engine/fetch-aws-icons.mjs"

# 一部だけ / 出力先を直接指定
node "$SKILL/assets/engine/fetch-aws-icons.mjs" --only lambda,dynamodb,s3
node "$SKILL/assets/engine/fetch-aws-icons.mjs" --out path/to/icons/aws-icons
```

- パッケージの URL は四半期ごとに変わるので固定しない。公式ページから、その時点の `Icon-package_*.zip` を見つけて使う。
  ZIP は Node の `zlib` だけで展開する（`unzip` や `python` には依存しない）。
- マニフェストに載っていて見つからなかった id は、stderr に警告を出す。
  AWS がファイル名を変えて取得できなかったときは、公式パッケージの `Architecture-Service-Icons_*/Arch_*/64/Arch_<name>_64.svg` を見る。
  そのうえで、`icon-manifest.json` の値（`Arch_` と `_64` を除いた部分）を直す。
- サービスを増やすときは、`icon-manifest.json` の `aws` に `id: "<AWSサービス名>"` を足す。
- 取得した後、出典と利用条件を書いた `NOTICE.md` が同じディレクトリに書き出される。

### 利用条件（要確認）

AWS は、アーキテクチャ図を作る目的でのアイコンの利用を許諾している。四半期ごとに更新されるので、版を混在させない。
社外に配布するものへ使うときは、配布元のパッケージに同梱の Terms と、AWS の商標・ブランドのガイドラインを確かめる（AWS と提携していると誤解させる使い方はできない）。
このスキルは SVG を同梱せず取得する方式にしているので、この確認はアイコンを使う人に任せている。

## 非 AWS アイコン（テンプレートに同梱）

テンプレートの `assets/starter/icons/` に汎用アイコンを同梱する。
このスキルのために新しく描いたオリジナルで、第三者のアイコンセットを流用・派生したものではなく、自由に利用・再配布できる（出典は同じディレクトリの `NOTICE.md`）。
setup のときに、プロジェクトの `icons/` へコピーされる。

- `browser.svg`: ブラウザ（利用者）
- `internet.svg`: 外部 API・インターネット

自作のアイコンを足すときは、`viewBox` を持つ 1 つの `<svg>` として、プロジェクトの `icons/` に置く。
spec の `icon` には、拡張子の無いパス（例: `"internet"`）で指定する。
描画エンジンは `<?xml>` と外側の `<svg>` を取り除き、元の `viewBox` を保ったまま埋め込む。

## アイコンの参照方法（spec 側）

`node.icon` は、iconDir（プロジェクトの `icons/`、つまり `DIAGRAM_DIR/icons`）からの相対パス（拡張子なし）で書く。

- AWS: `"aws-icons/lambda"`、`"aws-icons/dynamodb"` など（`fetch-aws-icons.mjs` の出力）
- AWS 以外: `"browser"`、`"internet"`
- `icon: null` は、アイコンの無い無地の箱を描く。
