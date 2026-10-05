---
name: aws-architecture-diagram
description: AWS 構成図を spec（ノード・エッジ・グループの配列）から SVG として生成・更新するスキル。IaC（AWS CDK / Terraform / CloudFormation 等）や説明を情報源に spec を起こし、環境（prod / staging / local 等）ごとに出し分け、PNG にラスタライズして作図ルール（交差最小・直交配線・軸整列・ラベル可読）で目視確認しながら反復する。初回は `setup` で対話的に導入（配置・アイコン取得・環境確定・初期作図）、以降は `update` で生成する。描画エンジン・環境レジストリ・render/preview・AWS アイコン取得を starter kit として同梱。「AWS 構成図を作って」「アーキテクチャ図を SVG で描いて」「構成図を更新して」「CDK/Terraform から構成図を」「aws-architecture-diagram setup」や、環境別の構成図を作りたい依頼で発動する。手描き GUI ではなくテキスト差分で管理できる図を作る。
argument-hint: "[setup|update] [--env <name,...>] [--from <IaCパス>]"
license: MIT
---

# AWS Architecture Diagram

AWS 構成図を、spec（ノード・エッジ・グループの配列）から SVG として生成する。
GUI で手描きせず、テキストの差分でレビュー・管理できる図を作る。
図は環境（対象システムに応じて prod / staging / local など）ごとに出し分ける。PNG にラスタライズして作図ルールで目視確認しながら、図を直していく。

このスキルで最も重要なのは作図ルール（`references/conventions.md`）である。
交差の最小化・線の直交・軸の整列・ラベルの読みやすさを保つための規約で、spec を書くときと図を直すときは常にこの観点で確かめる。

## 使い方

```text
aws-architecture-diagram setup   [--from <IaCパス>]              # 初回セットアップ（対話的）
aws-architecture-diagram [update] [--env <name>[,<name>...]] [--from <IaCパス>]  # 生成・更新
```

- `setup` は初回の導入を対話的に進める。
  starter kit の配置、AWS アイコンの取得、「あるべき環境」の確定、情報源からの初期作図、目視確認までを、要所でユーザーに確かめながら行う。
- `update`（デフォルト）は、セットアップ済みであることを前提に、情報源の変化を spec に反映して図を生成・更新する。
  `--env` を省くと「あるべき環境」すべてが対象になる（差分が出るのは変わった図だけ）。
- 自然文でも発動する。例は「AWS 構成図を作って」（未導入なら setup）、「構成図を更新して」、「CDK から構成図を描いて」、「local の図も出して」。

## 入力（構成の情報源）

spec は対象システムのアーキテクチャから起こす。情報源は次のどれかで、`--from <パス>` で指すか、会話で確かめる。

- IaC
  - AWS CDK（app と stack のソース、または `cdk synth` の CloudFormation 出力）
  - Terraform（`.tf`、`terraform show -json`、plan の JSON）
  - CloudFormation・SAM のテンプレート、Serverless Framework など
- 説明と既存の図（口頭や文章のアーキテクチャの説明、既存のダイアグラム）

このスキルは IaC を自動でパースしない。エージェントが情報源を読み、リソース・グループ・依存関係を把握して、作図ルールに沿って spec を手で起こす。
そのため、CDK でも Terraform でも情報源として同じように使える（形式の違いは、読むエージェントが吸収する）。
IaC が大きいときは主要なリソースと依存を優先し、粒度をユーザーと決める。

## 前提

- ツール
  - Node.js 18 以上。描画と取得のスクリプトで使う。`fetch-aws-icons.mjs` がグローバルの `fetch` を使うので、18 未満では動かない。
  - SVG を PNG に変換する Chrome または Chromium（headless）。`preview-diagram.mjs` が使う。
    見つからないときは `PUPPETEER_EXECUTABLE_PATH` か `CHROME_PATH` を設定する。
  - Chrome のサンドボックスはデフォルトで有効にしている。
    root やコンテナでサンドボックスが使えず起動に失敗するときだけ、`DIAGRAM_CHROME_NO_SANDBOX=1` を設定する。
  - PNG への変換はデフォルトで 120 秒で打ち切る。大きな図で足りなければ `DIAGRAM_CHROME_TIMEOUT_MS` で延ばす。
- ネットワークは、AWS 公式アイコンを取得するとき（`fetch-aws-icons.mjs`）だけ使う。
- MCP は使わない。

## 同梱物と配置の方針（コピーするものとしないもの）

スキルの更新（`gh skill update`）を安全に取り込めるように、プロジェクトへコピーするのは最小限のテンプレートだけにする。
描画エンジンなどのスクリプトはコピーせず、スキルから実行する。コピーしたものが増えるほど更新のときに上書きの危険が増えるので、この線引きを守る。

プロジェクトへ 1 回だけコピーするものは、次の `assets/starter/` のファイルである。
コピーした後はユーザーが編集し、更新でも上書きしない。

- `architecture-spec.mjs`: 各環境で共有する base の仕様（サンプル。書き換えて使う）
- `environments.mjs`: 環境のレジストリ（「あるべき環境」を定義する唯一の場所。base と変換を持つ）
- `icon-manifest.json`: アイコンの id から AWS のサービス名への対応（サービスを増やすときに編集する）
- `icons/browser.svg`・`icons/internet.svg`（と `NOTICE.md`）: AWS 以外の汎用アイコン（再配布できる）

スキルから実行するものは、次の `assets/engine/` のファイルである。コピーせず、`gh skill update` で自動で更新される。

- `diagram-engine.mjs`: spec から SVG を生成する純関数（描画エンジン）
- `render-diagram.mjs`: 対象の環境の SVG を生成する（デフォルトはすべての環境）
- `preview-diagram.mjs`: SVG を PNG にラスタライズする（目視確認用）
- `fetch-aws-icons.mjs`: AWS 公式アイコンを取得する

エンジンは、プロジェクトの図のディレクトリを `DIAGRAM_DIR`（デフォルトは実行時の cwd）で受け取る。
そのディレクトリの `architecture-spec.mjs`・`environments.mjs`・`icon-manifest.json`・`icons/` を読む。
そのため、図のディレクトリで実行するだけでよい。`$SKILL` はこのスキルの導入先（例: `.claude/skills/aws-architecture-diagram`）を指す。

```bash
cd docs/diagrams                                   # 図ディレクトリ（テンプレを置いた場所）
node "$SKILL/assets/engine/render-diagram.mjs"     # 既定=全環境。--env prod で一部だけ
```

サンプルは `assets/samples/` にあり、各ディレクトリが独立した出力の例になっている。
`serverless-web-app/` は starter のデフォルトのサンプル（prod と local）、`the-simple-webservice/` は実際の CDK から setup した例である。
作図ルール・環境・アイコンの詳細は、それぞれ `references/` にある。

## スキル更新の取り込み（update 運用）

1. `gh skill update aws-architecture-diagram` でスキル本体を更新する。
   エンジン（`assets/engine/`）はスキルの側にあるので、これだけで最新になる。プロジェクトへコピーしていないので、上書きの衝突は起きない。
2. テンプレート（`architecture-spec.mjs`・`environments.mjs`・`icon-manifest.json`・`icons/`）はユーザーのものなので、自動では変わらない。
   スキル側のテンプレート（`assets/starter/`）に役立つ変更があれば、差分を確かめて必要な部分だけを手で取り込む（既存のファイルを上書きしない）。

## セットアップ（`setup`・対話的）

初回だけ行う。要所でユーザーに確かめながら進める。

1. 配置
   - 図を置く場所（例: `docs/diagrams/`）を確かめ、テンプレート `assets/starter/` 一式（spec・environments・manifest・icons）をコピーする。
   - エンジンはコピーせず、スキルから実行する。
   - 同じ種類の仕組みがすでにあればそれに合わせ、無いときだけ同梱物を使う。既存のファイルは上書きしない。
2. アイコンの取得
   - 図のディレクトリで `node "$SKILL/assets/engine/fetch-aws-icons.mjs"` を実行し、AWS 公式アイコンを `icons/aws-icons/` に用意する。
   - 同梱の `browser` と `internet` はそのまま使える。出典と追加の方法は [`references/icons.md`](references/icons.md) にある。
3. あるべき環境の確定
   - どの環境の図を持つか（例: prod だけ、prod と local など）をユーザーと決め、`environments.mjs` の `environments` に反映する。
   - モデルと管理の方針は [`references/environments.md`](references/environments.md) にある。
4. 情報源の確認と初期の spec
   - `--from` か会話で情報源（IaC か説明）を決め、それを読んで `architecture-spec.mjs` の `nodes`・`edges`・`groups` を起こす。
   - [`references/conventions.md`](references/conventions.md) の作図ルールに必ず従う。
5. 初期の生成、目視確認、反復
   - 下の「生成・更新」の手順 2〜3 を繰り返して、初回の図を仕上げる。

## 生成・更新（`update`・既定）

セットアップ済みで図を作り直すときの手順である。

1. spec への反映
   - 情報源（IaC か説明）と今の spec を突き合わせ、追加・削除・変更されたリソースと依存を `architecture-spec.mjs` に反映する。
     必要なら `environments.mjs` の transform も直す。作図ルールは保つ。
2. 生成
   - 図のディレクトリで `node "$SKILL/assets/engine/render-diagram.mjs" [--env a,b]` を実行し、SVG を生成する（省くとすべての環境）。
3. 目視確認と反復
   - `node "$SKILL/assets/engine/preview-diagram.mjs" <env>` で PNG にし、出力された PNG を画像として読む。
   - conventions.md の確認観点（a〜j）で確かめ、崩れていれば座標と `waypoints` を直して生成し直す。
   - 画像を読むツールは SVG を直接描画できないので、必ず PNG への変換を挟む。

## 作図ルール（要点）

詳細と確認観点（a〜j）は [`references/conventions.md`](references/conventions.md) にある。要点は次のとおりである。

- エッジの交差を最小にすることを最優先にする。次に、屈曲を減らす、直交させる、重ならないようにする。
- 同じ層のノードは x か y を揃えて格子に乗せる。
- 外部への依存は、関係の無いグループを貫かない位置に置く（例: 外部 API を永続層の上の段に置く）。
- 多対多で集まる領域は、幹線の x に寄せてから分岐させる。平行な線は 20px 以上離す。
- ノードの間の矢印は最大 1 本にする。同じ辺へ複数の線が入るときは、`waypoint` で入る位置をずらす。
- 残った交差は、飛び越し（line jump）で接続していないことを示す（エンジンが自動で付ける）。
- 斜めのエッジはエンジンがエラーで止める。直交はエンジンが保証するので、目視で確かめる対象にしない。
- エッジのラベルは屈曲点を避けて自動で配置する。位置を指定するときだけ `labelAt` を使う。
- ノードのラベルは線の出ていない辺に置く。キャンバスの端には 50px 以上の余白を取る。
