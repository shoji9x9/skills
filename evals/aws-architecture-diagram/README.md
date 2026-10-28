# aws-architecture-diagram の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## evals.json が検証する観点

- IaC（CDK / Terraform 等）や説明から spec（nodes / edges / groups）を起こせるか
- 環境（prod / local など）ごとに出し分けできるか
- 作図ルール（交差の最小化・線の直交・軸の整列・ラベルの読みやすさ）に沿って崩れを直せるか

## 前提条件

- Node.js 18 以上（描画・取得スクリプト `skills/aws-architecture-diagram/scripts/*.mjs` の実行に使う）。
  `fetch-aws-icons.mjs` がグローバルの `fetch` を使うので、18 未満では動かない
- Chrome か Chromium（headless。SVG→PNG 変換 `preview-diagram.mjs` に使う）。見つからない場合は
  `PUPPETEER_EXECUTABLE_PATH` か `CHROME_PATH` を設定する
