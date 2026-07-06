---
name: aws-architecture-diagram
description: AWS 構成図を spec（ノード・エッジ・グループの配列）から SVG として生成・更新するスキル。対象システムの IaC（AWS CDK / Terraform / CloudFormation 等）や説明を情報源に spec を起こし、環境（prod / staging / local 等）ごとに出し分け、PNG にラスタライズして作図ルール（交差最小・直交配線・軸整列・ラベル可読）で目視確認しながら反復する。初回は `setup` で対話的に導入（配置・アイコン取得・環境確定・初期作図）、以降は `update` で生成・更新する。描画エンジン・環境レジストリ・render/preview・AWS アイコン取得を starter kit として同梱。「AWS 構成図を作って」「アーキテクチャ図を SVG で描いて」「構成図を更新して」「CDK/Terraform から構成図を」「aws-architecture-diagram setup」や、環境別の構成図を作りたい依頼で発動する。手描き GUI ではなくテキスト差分で管理できる図を作る。
license: MIT
---

# AWS Architecture Diagram

AWS 構成図を **spec（ノード・エッジ・グループの配列）から SVG として生成**する。GUI で
手描きせず、テキスト差分でレビュー・管理できる図を作る。図は環境（prod / staging / local
など、対象システムに応じて）ごとに出し分け、PNG にラスタライズして作図ルールで目視確認
しながら反復する。

**このスキルで最も重要なのは作図ルール**（`references/conventions.md`）。交差最小・直交
配線・軸整列・ラベル可読を保つための規約であり、spec を書くとき・図を直すときは常に
この観点で確認する。

## 使い方

```text
aws-architecture-diagram setup   [--from <IaCパス>]              # 初回セットアップ（対話的）
aws-architecture-diagram [update] [--env <name>[,<name>...]] [--from <IaCパス>]  # 生成・更新
```

- `setup`: 初回導入を**対話的**に進める。starter kit の配置・AWS アイコン取得・「あるべき
  環境」の確定・情報源からの初期作図・目視確認までを、要所でユーザーに確認しながら行う。
- `update`（既定）: セットアップ済みの前提で、情報源の変化を spec に反映し、図を生成・更新
  する。`--env` 省略時は「あるべき環境」全部が対象（変わった図だけ差分が出る）。
- 自然文でも発動する:「AWS 構成図を作って（→ 未導入なら setup）」「構成図を更新して」
  「CDK から構成図を描いて」「local の図も出して」。

## 入力（構成の情報源）

spec は対象システムのアーキテクチャから起こす。情報源は次のいずれか（`--from <パス>` で
指すか、会話で確認する）。

- **IaC**: AWS CDK（app/stack のソース、または `cdk synth` の CloudFormation 出力）、
  Terraform（`.tf`、`terraform show -json`、plan の JSON）、CloudFormation / SAM テンプレート、
  Serverless Framework など
- **説明・既存図**: 口頭/文章のアーキテクチャ説明、既存のダイアグラム

本スキルは **IaC を自動パースしない**。エージェントが情報源を読み、リソース・グルーピング・
依存関係を把握して、作図ルールに沿って spec を**手で起こす**。したがって CDK でも
Terraform でも情報源として同様に機能する（差を吸収するのは読む側のエージェント）。IaC が
大きいときは主要リソースと依存を優先し、粒度をユーザーと合意する。

## 前提

- **ツール**: Node.js 18+（描画・取得スクリプト用。`fetch-aws-icons.mjs` がグローバル
  `fetch` を使うため 18 未満は不可）、SVG→PNG 変換用の Chrome/Chromium
  （headless。`preview-diagram.mjs` が使う。無い場合は `PUPPETEER_EXECUTABLE_PATH` /
  `CHROME_PATH` を設定）。Chrome サンドボックスは既定で有効。root/コンテナ等で
  サンドボックスが使えず起動に失敗する場合のみ `DIAGRAM_CHROME_NO_SANDBOX=1` を設定する
- **ネットワーク**: AWS 公式アイコン取得時のみ（`fetch-aws-icons.mjs`）
- **MCP**: なし

## 同梱物と配置方針（コピーするもの／しないもの）

スキル更新（`gh skill update`）を安全に取り込めるよう、**プロジェクトへコピーするのは
最小限のテンプレートだけ**にし、機械部（エンジン）はコピーせずスキルから実行する。
コピー物が増えるほど更新時の上書きリスクが上がるため、この線引きを守る。

**プロジェクトへ 1 回だけコピー**（`assets/starter/`。以後ユーザーが編集。更新で上書きしない）:

- `architecture-spec.mjs` — 各環境で共有する base 仕様（サンプル。書き換えて使う）
- `environments.mjs` — 環境レジストリ（＝「あるべき環境」の単一ソース。base ＋ 変換）
- `icon-manifest.json` — アイコン id → AWS サービス名（サービスを増やすとき編集）
- `icons/browser.svg` `icons/internet.svg`（＋ `NOTICE.md`）— 非 AWS 汎用アイコン（再配布可）

**スキルから実行**（`assets/engine/`。コピーしない。`gh skill update` で自動更新される）:

- `diagram-engine.mjs` — spec から SVG を生成する純関数（描画エンジン）
- `render-diagram.mjs` — 対象環境の SVG を生成（既定は全環境）
- `preview-diagram.mjs` — SVG を PNG にラスタライズ（目視確認用）
- `fetch-aws-icons.mjs` — AWS 公式アイコン取得

エンジンはプロジェクトの図ディレクトリを `DIAGRAM_DIR`（既定は実行時の cwd）で受け取り、
そこの `architecture-spec.mjs` / `environments.mjs` / `icon-manifest.json` / `icons/` を読む。
図ディレクトリで実行するだけでよい（`$SKILL` は本スキルの導入先、例
`.claude/skills/aws-architecture-diagram`）:

```bash
cd docs/diagrams                                   # 図ディレクトリ（テンプレを置いた場所）
node "$SKILL/assets/engine/render-diagram.mjs"     # 既定=全環境。--env prod で一部だけ
```

サンプルは `assets/samples/`（各ディレクトリが独立した実出力例）:
`serverless-web-app/`（starter 既定サンプル。prod / local）、`the-simple-webservice/`（実 CDK
から setup した例）。詳細は各 `references/`（作図ルール・環境・アイコン）。

## スキル更新の取り込み（update 運用）

1. スキル本体を更新: `gh skill update aws-architecture-diagram`。エンジン（`assets/engine/`）は
   スキル側にあるため、これだけで最新化される（プロジェクトへコピーしていないので上書き
   衝突が起きない）。
2. テンプレート（`architecture-spec.mjs` / `environments.mjs` / `icon-manifest.json` / `icons/`）は
   ユーザー所有のため自動では変わらない。スキル側テンプレート（`assets/starter/`）に有用な
   変更があれば差分を確認し、必要な部分だけ手で取り込む（既存を上書きしない）。

## セットアップ（`setup`・対話的）

初回のみ。要所でユーザーに確認しながら進める。

1. **配置**: 図を置く場所（例 `docs/diagrams/`）を確認し、テンプレート `assets/starter/` 一式
   （spec / environments / manifest / icons）をコピーする。エンジンはコピーしない（スキルから
   実行）。既に同種の仕組みがあればそれを尊重し、無いときだけ同梱物を使う（既存ファイルは
   上書きしない）。
2. **アイコン取得**: 図ディレクトリで `node "$SKILL/assets/engine/fetch-aws-icons.mjs"` を実行し、
   AWS 公式アイコンを `icons/aws-icons/` に用意する（同梱の `browser`/`internet` はそのまま
   使える）。出典・追加方法は [`references/icons.md`](references/icons.md)。
3. **あるべき環境の確定**: どの環境の図を持つか（例: prod のみ / prod＋local / …）を
   ユーザーと決め、`environments.mjs` の `environments` に反映する。モデルと管理方針は
   [`references/environments.md`](references/environments.md)。
4. **情報源の確認と初期 spec**: `--from` か会話で情報源（IaC/説明）を確定し、それを読んで
   `architecture-spec.mjs` の `nodes` / `edges` / `groups` を起こす。**必ず
   [`references/conventions.md`](references/conventions.md) の作図ルールに従う**。
5. **初期生成 → 目視確認 → 反復**: 下記「生成・更新」の 2〜3 を回して初回の図を仕上げる。

## 生成・更新（`update`・既定）

セットアップ済みで図を作り直すとき。

1. **spec に反映**: 情報源（IaC/説明）と現行 spec を突き合わせ、差分（追加/削除/変更された
   リソース・依存）を `architecture-spec.mjs`（と必要なら `environments.mjs` の transform）に
   反映する。作図ルールを維持する。
2. **生成**: 図ディレクトリで `node "$SKILL/assets/engine/render-diagram.mjs" [--env a,b]` で
   SVG を生成（省略時は全環境）。
3. **目視確認 → 反復**: `node "$SKILL/assets/engine/preview-diagram.mjs" <env>` で PNG 化 →
   出力 PNG を画像として読み、conventions.md の確認観点（a〜j）でチェック → 崩れていれば
   座標・`waypoints` を直して再生成。**SVG は画像参照ツールで直接描画できないため、必ず
   PNG 化を挟む。**

## 作図ルール（要点）

詳細と確認観点（a〜j）は [`references/conventions.md`](references/conventions.md)。要点:

- エッジ交差の最小化を最優先。次いで屈曲削減・直交性・非重なり。
- 同じ層のノードは x か y を揃えて格子に乗せる。
- 外部依存は無関係グループを貫通しない位置に置く（例: 外部 API を永続層の上段に）。
- 多対多で集まる領域は幹線 x に寄せてから分岐。平行線は 20px 以上離す。
- ノード間の矢印は最大 1 本。同じ辺への複数進入は `waypoint` で進入位置をずらす。
- 残った交差は飛び越し（line jump）で「非接続」を明示（エンジンが自動付与）。
- ラベルは線の出ていない辺へ。キャンバス端に 50px 以上の余白。
