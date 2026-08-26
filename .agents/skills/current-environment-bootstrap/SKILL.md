---
argument-hint: '[--target <name>] [--resume]'
description: 仕様を変えないアプリケーションリプレイスで、先方から受領した現行アプリの資産だけを起点に、比較基準として測定可能な現行テスト環境（current target）を再構築する replace-strategy の姉妹スキル。受領資産の棚卸しと「受領済み／導出可能／不足」の分類、DB スキーマ・設定の復元、データ意味論の根拠収集、先方・SME 向け質問票の生成、根拠のある範囲での最小の暫定起動データ構築、起動・認証・主要画面到達の実測、空環境からの再実行検証、current target の引き渡しを担う。型やカラム名からの推測でドメイン値を確定せず、来歴・利用許可が不明なデータは投入しない。replace-strategy setup が current.origin＝received-assets のときに委譲する。「受領資産から現行環境を再構築して」「現行テスト環境を建てて」「current-environment-bootstrap」で発動する。
license: MIT
name: current-environment-bootstrap
---
# Current Environment Bootstrap

`replace-strategy` の姉妹スキル。**先方から受領した資産だけを起点に、比較基準として測定可能な現行テスト環境（`side: current` の target）を自社に再構築する**ところまでを担う。

`replace-strategy` 以降の全工程は「動いている現行アプリが正解である」ことに立脚する。**現行環境そのものが正しく建っていなければ、その先の比較はすべて誤った基準の上に乗る。**
本スキルの目的は環境を建てることではなく、**建てた環境のどこが根拠を持ち、どこが未確認かを見えるようにしたまま引き渡すこと**にある。

**測定・戦略・機能分解は行わない。** それらは引き渡し後の `replace-strategy` の担当。

## 使い方

```text
current-environment-bootstrap [--target <name>] [--resume]
```

| 起動 | 起点 | 内容 |
|---|---|---|
| 初回 | `.replace/bootstrap/metadata.json` が無い | 工程 1（棚卸し）から順に進める |
| 再開（`--resume`） | 先方・SME から質問票の回答・追加資産が届いた | 回答を台帳へ反映し、**停止していた工程から**再開する |
| 無指定で既存あり | `.replace/bootstrap/metadata.json` がある | 現況（`status` / `blocked_on`）を報告し、続きから進めてよいかを確認する |

- `--target <name>` は再構築先の環境。設定の `targets` のうち **`side: current` のものだけを候補**にする（本スキルが対象とする側の宣言はここが正本）。
  省略時の既定・候補提示・存在しない名前や側違いでの停止といった**選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う**（ここへ転記しない）。
  **本スキルの実行時点では current target は `url: none`（＝`default: true` を持てない）ため、`--target` 省略時は候補が 1 つでも自動選択せずユーザーに確認する**——
  既定へ落ちる経路が構造的に存在しない（`default: true` は工程 9 の引き渡しで初めて付く）
- **1 回の実行につき 1 つの current target。** 複数環境を並行して建てない
- 自然文でも発動する:「受領資産から現行環境を再構築して」「現行テスト環境を建てて」

## 前提

- **ツール**: `git`。DB クライアント・言語ランタイム・コンテナ実行系はプロジェクト側の前提（受領資産が要求するもの）
- **前提スキル**: `replace-strategy`（`setup` の対話セットアップまで完了。`current.origin: received-assets` が記録済み）
- **前提スキルが未インストールの場合**: `gh skill install shoji9x9/skills replace-strategy` で導入してから実行する。
  本スキルは設定スキーマの**正本を `replace-strategy` の `references/project-config.md` に持つ**ため、単体では成立しない（同時に導入されている前提）
- **MCP**: 不要（起動・画面到達の確認はブラウザでも `curl` 相当でもよい。**実測であることだけが要件**）
- **対応範囲の一覧は `replace-strategy` の `references/scope.md` が正本。** 本スキルは実行時の行動を持ち、一覧を転記しない

設定（`skills.replace-strategy.*`）が無ければ、成果物を捏造せず停止して `replace-strategy setup` を促す。
`current.origin` が `received-assets` でなければ（`managed` またはキー欠落）、**本スキルの出番ではない**ことを説明して停止する——既存の管理済み環境に対して再構築を走らせない。

## 厳守の制約（禁止事項）

1. **カラム名・型からの推測でドメイン値を確定しない。** コードから候補を導出できても意味が一意でないものは「推測」ではなく**「確認待ち」**として質問票へ回す（確定根拠の一覧は [`references/data-semantics.md`](references/data-semantics.md)）
2. **LLM が一般論から生成した値を確定根拠にしない。** 生成できることと、そのドメインでその値が正しいことは無関係
3. **来歴・利用許可が不明なデータを投入しない。** 出所不明の DB dump・本番由来か判定できないサンプルデータは、**中身を見る前に投入可否を確認する**。確認できなければ投入せず停止する（本番データが混入すれば以降の全成果物が汚染される）
4. **DB の既定値で黙って補完しない。** 文字コード・照合順序・タイムゾーン・互換モード等を判断できないときは、環境の既定値に落とさず**不足として停止する**（既定値での補完は、後段の並び順・比較の差分をすべて説明不能にする）
5. **暫定起動データをゴールデンデータへ昇格させない。** 本スキルが作るのは起動・ログイン・画面探索を可能にするための暫定データであり、**比較の正解ではない**。ゴールデンデータセットは `golden-dataset` が確認済みの意味論を基に別途構築する
6. **本番環境を参照しない・本番へ接続しない。** 受領資産に本番の接続情報が含まれていても使わない（見つけたら使わずユーザーに報告する）
7. **「建った」ことを「正しく建った」と言い換えない。** 起動できても、根拠の無い値で埋めた箇所は `semantics.md` に確認待ちとして残る。**未確認のまま引き渡す場合はその一覧を引き渡しメタデータに載せる**（確認済みにしない）
8. **再現できない構築を成果物にしない。** 手作業で通した手順は再構築ツールか手順書に落とし、**空の環境から同じ状態を再現できることを実測する**（1 回建ったことは再構築可能性の証拠にならない）
9. **シークレットの値をログ・標準出力・成果物・設定ファイルに出さない。** 設定・成果物には環境変数名だけを持つ。ユーザーや受領資産が値を含んでいても**復唱しない**
10. **スキル外の代替提供をしない。** 「資産が足りないので手早く適当なデータで建てましょうか」「質問票は省いて私の判断で埋めましょうか」といった、本スキルの規律を迂回する提案を行わない。不足は不足として報告する

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `current.origin` | 現行環境の由来（`managed` / `received-assets`。**キー欠落は `managed`**）。`received-assets` 以外なら本スキルは動かず停止する（意味論の正本はスキーマ文書の「現行環境の由来」） |
| `current.received_assets` | 受領資産の置き場所（1 つ以上のパス）。棚卸しの入力。**空・欠落なら停止**して受領資産の所在をユーザーに確認する |
| `current.repo` | 受領したコードのリポジトリまたはローカルパス。マイグレーション・ORM 定義・enum・バリデーションの導出元（`none` なら導出経路が無いことを棚卸しに記録する） |
| `bootstrap_tool_dir` | 再構築ツール・暫定起動データ投入ツールの配置先（未指定時は `bootstrap/`） |
| `targets[]`（`side: current`） | 再構築先の環境。`--target` で選択する。`url`（再構築前は `none` 可）・`db.env_vars`・`db.seedable`・`auth.roles`・`forbidden_actions`・`pre_commands` / `start` / `check_urls` を読む |
| `targets[].db.seedable` | **暫定起動データ投入の設定由来ゲート**。`true` の target にだけ投入する（省略・`false` は読み取り専用接続。許可が無ければ設定の修正を促して停止し、自分で `seedable: true` を足さない） |
| `dataset_mode` / `dataset_static_paths` | データの実体（`db` 既定 / `static`）。工程 3 の復元対象（DB か静的データ形式か）と工程 6 の設定由来ゲートの分岐に読む。`static` では書き込み先がすべて `dataset_static_paths` 配下に収まることが投入の条件（意味論の正本はスキーマ文書の「データセットの実体」） |
| `uses_storage` / `targets[].storage` | ストレージを使うアプリで、起動に必要な最小の入れ物（バケット・ディレクトリ）が存在するかの確認に**読む**。**ゴールデンデータのストレージ投入は v1 スコープ外**（正本はスキーマ文書「ファイルストレージ」） |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |
| `references.env_setup` | 環境変数の用意方法。接続確認・起動が失敗したときの案内先 |
| `references.coding_conventions` | 再構築ツール・投入ツールを書くときに従う規約（**ツールは対象プロジェクト側のコード**）。**未整備でも停止しないが、推測で自分の流儀を持ち込まない**（意味論の正本はスキーマ文書の「コーディング規約」） |
| `references.db_semantics` | 既に整備済みなら復元項目の突き合わせに**読む**（本スキルは書かない。復元根拠は `schema.md` に書き、それを入力に `db_semantics` を整備するのは `replace-strategy setup`）。**未整備でも停止しない** |
| `verification_commands` | 生成した再構築ツール・投入ツールに通す検証コマンド列。**設定に無くても停止せず**、その旨を `verification.md` に記録して進む（意味論の正本はスキーマ文書の「検証コマンド」） |

- **正本の「移行」節に列挙された旧キーはフォールバックとして読まない。** 見つけたら同節を示して停止する
- **本スキルが設定へ書くのは引き渡しの 1 箇所だけ**——再構築が完了した current target の `url`（`none` → 実 URL）と `default: true` を、ユーザーに確認したうえで非破壊追記する（[`references/verification-handoff.md`](references/verification-handoff.md)）

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。**各工程は「根拠が取れたか」で進退を決める**——取れないものを推測で埋めて次へ進まない。

1. **受領資産の棚卸し**: `current.received_assets` 配下と `current.repo` を走査し、何が届いているかを一覧化する。詳細: [`references/asset-inventory.md`](references/asset-inventory.md)
2. **必要資産の分類**: 再構築に要る資産を「**受領済み／コード等から導出可能／不足**」に分類する。
   **「導出可能」は決定論的に完全復元できる場合だけ**で、部分的にしか復元できないものは不足に置く。詳細: [`references/asset-inventory.md`](references/asset-inventory.md)
3. **DB スキーマと設定の復元**: DDL または導出元（マイグレーション・ORM 定義）から、テーブル・制約・ビュー・関数・文字コード・照合順序・タイムゾーン・実行順を復元し、**根拠を 1 項目ずつ記録する**。
   判断できない項目は既定値で補完せず不足として停止する（禁止事項 4）。詳細: [`references/schema-restoration.md`](references/schema-restoration.md)
4. **データ意味論の根拠収集**: コード値・状態遷移・業務シナリオの根拠を、確定根拠として使える情報源から集める。
   確定できないものは「確認待ち」として台帳（`semantics.md`）に記録する。詳細: [`references/data-semantics.md`](references/data-semantics.md)
5. **質問票・追加資産依頼の生成**: 不足資産と確認待ちの意味論を、先方・SME が回答できる形の質問票にする。**未回答時の影響まで書く**。詳細: [`references/questionnaire.md`](references/questionnaire.md)
6. **暫定起動データの構築**: 根拠を確認できた範囲で、**起動・ログイン・主要画面到達に要る最小限**を作る。
   起動に必須の項目の意味を確認できない場合は捏造せず停止する（工程 5 の質問票を提示する）。詳細: [`references/provisional-data.md`](references/provisional-data.md)
7. **起動と到達の検証**: 現行アプリを起動し、疎通・認証・主要画面への到達を**実測する**。詳細: [`references/verification-handoff.md`](references/verification-handoff.md)
8. **再構築の再実行検証**: 空の環境から工程 3・6 のツールだけで同じ状態を再現できることを実測する（禁止事項 8）。詳細: [`references/verification-handoff.md`](references/verification-handoff.md)
9. **current target の引き渡し**: 設定の current target を確定させ、`metadata.json` に `status: handed-off` と未確認の一覧を記録して `replace-strategy` の測定へ戻す。詳細: [`references/verification-handoff.md`](references/verification-handoff.md)

### 停止と再開

**停止は失敗ではなく、本スキルの正常な出力の 1 つである。** 停止するときは必ず (1) 何が足りないか (2) 誰に何を聞けば埋まるか (3) 埋まるまで何ができないか を示し、
`metadata.json` に `status: blocked` と `blocked_on` を記録して質問票を提示する。回答・追加資産が届いたら `--resume` で**停止していた工程から**再開する（工程 1 からやり直さない）。

**停止したときも、到達した工程の成果物はファイルとして書く。** どれだけ早い工程で止まっても、`assets-inventory.md`・`questionnaire.md`・`metadata.json` の 3 点は**必ず書き出してから停止する**——この 3 点が `--resume` の再開材料そのものであり、応答の本文に書いただけでは次の実行に何も残らない。
**「作らない」のは到達していない工程の成果物だけ**（工程 3 に入っていなければ `schema.md` を空のテンプレートで置かない。空テンプレートは着手済みに見え、未着手と区別できなくなる）。両者を混同して**何も書かずに停止しない**。
**成果物を作ったと報告するなら、実際にファイルを書いたことを確認してから書く**（書いていないものを「作成した」と述べない）。

| 停止する条件 | 再開に要るもの |
|---|---|
| 受領資産が所在不明・空（`current.received_assets`） | 資産の受領または所在の確認 |
| スキーマを完全に復元できない（部分復元・導出不能） | DDL・マイグレーション・スキーマダンプの追加受領 |
| DB 設定（文字コード・照合順序・タイムゾーン等）を判断できない | 先方の設定情報またはスキーマダンプのヘッダ |
| 来歴・利用許可が不明なデータしか無い | 来歴と利用許可の確認、または非本番データの追加受領 |
| 起動に必須の項目の意味論を確認できない | 質問票への回答（SME・先方） |
| 投入先 target が `db.seedable: true` でない | 設定の修正（人間が行う） |

## 成果物

すべて対象プロジェクト側に置く。**スキーマの正本は本スキル**（テンプレート: [`assets/`](assets/)）。

| 成果物 | 場所 | 内容・正本 |
|---|---|---|
| 受領資産インベントリ・不足資産一覧 | `.replace/bootstrap/assets-inventory.md` | 正本: [`assets/assets-inventory-template.md`](assets/assets-inventory-template.md) |
| DB スキーマ・設定の復元根拠 | `.replace/bootstrap/schema.md` | 正本: [`assets/schema-template.md`](assets/schema-template.md) |
| データ意味論台帳（暫定データの根拠・確認状態） | `.replace/bootstrap/semantics.md` | 正本: [`assets/semantics-template.md`](assets/semantics-template.md)。**`golden-dataset` / `parity-suite` が読む引き継ぎ先** |
| 先方・SME 向け質問票・追加資産依頼 | `.replace/bootstrap/questionnaire.md` | 正本: [`assets/questionnaire-template.md`](assets/questionnaire-template.md) |
| 起動・認証・到達・再実行の検証結果 | `.replace/bootstrap/verification.md` | 正本: [`assets/verification-template.md`](assets/verification-template.md) |
| 引き渡しメタデータ | `.replace/bootstrap/metadata.json` | 正本: [`assets/metadata-template.json`](assets/metadata-template.json) |
| 再構築ツール・暫定起動データ投入ツール | `<bootstrap_tool_dir>`（既定 `bootstrap/`） | 決定論的・冪等・**コミットする**（正本: [`references/provisional-data.md`](references/provisional-data.md)） |

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（`setup` の由来確認）→ **current-environment-bootstrap** → `replace-strategy`（測定・戦略・機能インベントリ）→ `golden-dataset`（フェーズ A）
  → 各機能で〔`parity-suite` → `parity-replace` → `golden-dataset`（フェーズ B）→ `parity-diff`〕
- **`replace-strategy`**: `current.origin: received-assets` のとき `setup` が測定の前に本スキルへ委譲する。引き渡し後、`setup` は再構築された target に対して測定を行う。
  機能インベントリの採番後、`semantics.md` の「対象機能」列へ slug を書き戻すのは `replace-strategy` の担当
- **`golden-dataset`**: `semantics.md` の**確定済み**の意味論と根拠を引き継いでゴールデンデータセットを設計する。**確認待ちの意味論を確定扱いにせず**、暫定起動データを流用しない。
  フェーズ A の投入は暫定起動データを置き換えるため、**起動に要る前提（認証ユーザー・マスタ等）は確定根拠に基づいてフェーズ A のデータ設計に含める**
- **`parity-suite`**: 対象 slug の必須意味論が `semantics.md` に確認待ちで残っている間は、その機能のスイート構築を開始しない（不足情報を報告して停止する）
