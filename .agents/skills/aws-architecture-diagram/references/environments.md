# 環境の管理と選択

同一システムでも環境（例: prod / staging / local）ごとに構成が少し違うことがある。
本スキルは **単一ベース spec ＋ 環境ごとの変換** でこれを扱い、2 つの問いを分けて管理する。

- **どの環境の構成図があるべきか**（＝更新対象の母集合）— **めったに変わらない**。
  新しい環境を足すときだけ変わる。→ `environments.mjs` の `environments` で管理する。
- **今どの環境の図を更新するか** — **頻繁に変わりうる**。→ `render-diagram.mjs` の `--env`
  で指定する。省略時は「あるべき環境」全部を対象にし、変わった図だけ差分が出る。

## モデル: 単一ベース spec ＋ 変換

- `architecture-spec.mjs` の `baseSpec` を各環境で共有する正規の構成にする。
- 各環境は `environments.mjs` の `environments` に `{ title, transform?(base) => spec }` で定義。
  - `transform` を省略した環境は base をそのまま描く。
  - 差分のある環境は base を**変換**して派生: 未使用ノード/エッジを淡色（`dim`）化、
    置換ノードのラベル差し替え、環境固有フローのエッジ追加、凡例（`notes`）付与。
- **どの環境が base と同じかは対象システム次第。** サンプルでは `prod` が base そのまま、
  `local` がローカル開発の差分を `transform` で表現している。base の配置を直せば全環境が
  追従する（座標の二重管理を避ける）。

## 「あるべき環境」の管理（単一ソース）

`environments.mjs` の `environments` オブジェクトの**キーが、このリポジトリに存在すべき
環境の一覧**。ここが単一ソースなので、`skills.yml` 等に環境一覧を二重に持たない
（drift を避ける）。

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

- 環境を**追加**: キーを足し、必要なら `transform` を書く。
- 環境を**削除**: キーを消す。
- `title` は base そのままの環境で使う。`transform` を持つ環境の title は transform の戻り値で設定する。

## 「今どれを更新するか」の指定

図ディレクトリで、スキル同梱のエンジンを実行する（`$SKILL` は導入先）。

```bash
cd docs/diagrams   # 図ディレクトリ

# 既定: あるべき環境すべてを再生成（更新の要否は差分で判断）
node "$SKILL/assets/engine/render-diagram.mjs"

# 一部だけ更新（その場限り）
node "$SKILL/assets/engine/render-diagram.mjs" --env local
node "$SKILL/assets/engine/render-diagram.mjs" --env prod,local
```

## 出力

環境ごとに `architecture-<env>.svg` を出力する（既定は starter 内の `out/`、
`DIAGRAM_OUT_DIR` で変更可）。ドキュメントへは各環境の SVG を埋め込む。
