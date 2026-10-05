# 環境の管理と選択

同じシステムでも、環境（例: prod・staging・local）ごとに構成が少し違うことがある。
このスキルは、1 つの base の spec と環境ごとの変換でこれを扱い、次の 2 つの問いを分けて管理する。

- どの環境の構成図があるべきか（更新の対象になる環境の一覧）。
  これはめったに変わらず、新しい環境を足すときだけ変わる。`environments.mjs` の `environments` で管理する。
- 今どの環境の図を更新するか。これはよく変わる。`render-diagram.mjs` の `--env` で指定する。
  省くと「あるべき環境」すべてが対象になり、差分が出るのは変わった図だけになる。

## モデル: 単一ベース spec ＋ 変換

- `architecture-spec.mjs` の `baseSpec` を、各環境で共有する基準の構成にする。
- 各環境は、`environments.mjs` の `environments` に `{ title, transform?(base) => spec }` の形で定義する。
  - `transform` を省いた環境は、base をそのまま描く。
  - 差分のある環境は、base を変換して作る。
    変換では、たとえば次のことをする。
    - 使わないノードやエッジを淡い色（`dim`）にする。
    - 置き換えたノードのラベルを差し替える。
    - 環境に固有の流れのエッジを足す。
    - 凡例（`notes`）を付ける。
- どの環境が base と同じかは、対象のシステムによって決まる。
  サンプルでは、`prod` が base そのままで、`local` がローカル開発の差分を `transform` で表している。
  base の配置を直せばすべての環境に反映されるので、座標を二重に管理せずに済む。

## 「あるべき環境」の管理（単一ソース）

`environments.mjs` の `environments` オブジェクトのキーが、このリポジトリにあるべき環境の一覧である。
ここが唯一の定義なので、`skills.yml` などに環境の一覧を二重に持たない（一方だけが古くなるのを避ける）。

```js
// environments.mjs（抜粋）。環境 → spec の解決はエンジンが行うので、ここは定義だけ。
import { baseSpec } from "./architecture-spec.mjs";

export const environments = {
  prod: { title: "システム構成図（prod）" },      // base をそのまま（title だけ差し替え）
  staging: { transform: toStaging },              // transform を持つ環境は title を transform 内で設定
  local: { transform: toLocal },
};

export { baseSpec }; // エンジンが base を読めるよう再エクスポート
```

- 環境を追加するときは、キーを足し、必要なら `transform` を書く。
- 環境を削除するときは、キーを消す。
- `title` は base をそのまま描く環境で使う。`transform` を持つ環境の title は、transform の戻り値で設定する。

### ファイル名の拡張子

エンジンはレジストリを、`environments.mjs`、`environments.js` の順に探す。
両方あれば `.mjs` を使い、使わなかった方を警告に出す。
リネームしたら、古い方を必ず削除する。残すと、編集した側のファイルが警告なしに無視される。

`package.json` に `"type": "module"` があるプロジェクトでは `.js` も ESM として解釈されるので、リポジトリの拡張子の規約に合わせて `environments.js` にリネームしてよい。
base の仕様（`architecture-spec.mjs`）はレジストリから相対パスで import するので、名前も拡張子も自由に決められる（リネームしたら、レジストリの import も直す）。

## 「今どれを更新するか」の指定

図のディレクトリで、スキルに同梱のエンジンを実行する（`$SKILL` は導入先）。

```bash
cd docs/diagrams   # 図ディレクトリ

# 既定: あるべき環境すべてを再生成（更新の要否は差分で判断）
node "$SKILL/assets/engine/render-diagram.mjs"

# 一部だけ更新（その場限り）
node "$SKILL/assets/engine/render-diagram.mjs" --env local
node "$SKILL/assets/engine/render-diagram.mjs" --env prod,local
```

## 出力

環境ごとに `architecture-<env>.svg` を出力する。
出力先はデフォルトでは starter の中の `out/` で、`DIAGRAM_OUT_DIR` で変えられる。ドキュメントには、各環境の SVG を埋め込む。
