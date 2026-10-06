---
name: current-environment-bootstrap
description: 仕様を変えないアプリケーションリプレイスで、先方から受領した現行アプリの資産だけを起点に、比較基準として測定可能な現行テスト環境（current target）を再構築する replace-strategy の姉妹スキル。受領資産の棚卸しと「受領済み／導出可能／不足」の分類、DB スキーマ・設定の復元、データ意味論の根拠収集、先方・SME 向け質問票の生成、根拠のある範囲での最小の暫定起動データ構築、起動・認証・主要画面到達の実測、空環境からの再実行検証、current target の引き渡しを担う。型やカラム名からの推測でドメイン値を確定せず、出所・利用許可が不明なデータは投入しない。replace-strategy setup が current.origin＝received-assets のときに委譲する。「受領資産から現行環境を再構築して」「現行テスト環境を建てて」「current-environment-bootstrap」で発動する。
argument-hint: "[--target <name>] [--resume] [--autonomous]"
license: MIT
---

# Current Environment Bootstrap

`replace-strategy` の姉妹スキル。先方から受け取った資産だけを起点に、比較の基準として測れる現行のテスト環境（`side: current` の target）を自社に作り直すところまでを担う。

`replace-strategy` 以降のすべての工程は、「動いている現行アプリが正解である」ことを前提にしている。
現行の環境そのものが正しく建っていなければ、その先の比較はすべて誤った基準の上に乗る。
このスキルの目的は、環境を建てることではなく、建てた環境のどこに根拠があり、どこが未確認かを見えるようにしたまま引き渡すことにある。

測定・戦略・機能の分解は行わない。それらは、引き渡した後の `replace-strategy` が担う。

## 使い方

```text
current-environment-bootstrap [--target <name>] [--resume] [--autonomous]
```

| 起動 | 起点 | 内容 |
|---|---|---|
| 初回 | `.replace/bootstrap/metadata.json` が無い | 工程 1（棚卸し）から順に進める |
| 再開（`--resume`） | 先方・SME から質問票の回答や追加の資産が届いた | 回答を台帳に反映し、停止していた工程から再開する |
| 指定なしで既存の記録がある | `.replace/bootstrap/metadata.json` がある | 今の状態（`status` / `blocked_on`）を報告し、続きから進めてよいかを確かめる |

- `--target <name>` は、作り直す先の環境である。設定の `targets` のうち、`side: current` のものだけを候補にする（このスキルが対象にする側は、ここで定義する）。
  省略したときのデフォルト、候補の提示、存在しない名前や側の違いで停止することなど、選び方は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）。
  このスキルを実行する時点では、current の target は `url: none` で、`default: true` を持てない。そのため、`--target` を省いたときは、候補が 1 つでも自動で選ばず、利用者に確かめる。
  デフォルトの target として選ばれる道が、構造上ない（`default: true` は工程 9 の引き渡しで初めて付く）。
- 1 回の実行で扱う current の target は 1 つである。複数の環境を並行して建てない。
- `--autonomous` は、その実行だけを自律で進めるという宣言である（下記の「自律実行」）。省いたときは、判断のたびに確かめる。
- 自然文でも起動する。例:「受領資産から現行環境を再構築して」「現行テスト環境を建てて」

## 前提

- ツール: `git`。DB クライアント・言語のランタイム・コンテナの実行環境は、プロジェクト側の前提である（受け取った資産が求めるもの）。
- 前提スキル: `replace-strategy`（`setup` の対話のセットアップまで済み、`current.origin: received-assets` が記録されていること）。
- 前提スキルがインストールされていない場合は、`gh skill install shoji9x9/skills replace-strategy` で入れてから実行する。
  このスキルは設定のスキーマの原本を `replace-strategy` の `references/project-config.md` に持つので、単独では動かない（同時に入っている前提である）。
- MCP: 要らない。起動と画面への到達の確認は、ブラウザでも `curl` に当たるものでもよい。実測であることだけが条件である。
- 対応する範囲の一覧は、`replace-strategy` の `references/scope.md` で定義する。このスキルは実行時の行動を持ち、一覧を転記しない。

設定（`skills.replace-strategy.*`）が無ければ、成果物をでっち上げずに停止し、`replace-strategy setup` を促す。
`current.origin` が `received-assets` でなければ（`managed` か、キーが欠けている）、このスキルの出番ではないことを説明して停止する。既にある管理済みの環境に対して、作り直しを実行しない。

## 厳守の制約（禁止事項）

1. 仕様の確認は、十分な証拠が得られる、もっともコストの低い方法から始める。
   証拠は、作り直した対象の環境から取得する。対象の版・採取の時点・条件をたどれる実行ログや観測の記録、現行のソースコード、API の実際の動作、UI の実際の動作の順に調べる。
   下の段の証拠だけでは起動・認証・到達の条件を確定できない場合に限り、次の段に進む。
   この順にするのは、調べるコストが実行ログ・観測の記録、ソースコード、API の操作、UI の操作の順に高くなるからである。必要な証拠が得られた時点で止め、API や UI の操作は不足する場合だけ行う。
   設計書・仕様書・受け取ったログを含む受け取った資料は、調べる候補を挙げるのに使ってよいが、現行の挙動を確定する根拠にはしない。
   UI への到達の引き渡しの確認は UI で行い、コストの低い方法で代えない。
2. カラム名や型からの推測で、ドメインの値を確定しない。
   コードから候補を導けても、意味が 1 つに決まらないものは、推測ではなく「確認待ち」として質問票に回す（確定の根拠の一覧は [`references/data-semantics.md`](references/data-semantics.md)）。
3. LLM が一般論から作った値を、確定の根拠にしない。作れることと、そのドメインでその値が正しいことは関係がない。
4. 出所と利用の許可が分からないデータは投入しない。
   出所の分からない DB のダンプや、本番から来たかを判定できないサンプルデータは、中身を見る前に投入してよいかを確かめる。
   確かめられなければ、投入せずに停止する（本番のデータが含まれると、以降のすべての成果物が汚染される）。
5. DB のデフォルト値で、警告なしに補わない。文字コード・照合順序・タイムゾーン・互換モードなどを判断できないときは、環境のデフォルト値にせず、不足として停止する。
   デフォルト値で補うと、後の段の並び順や比較の差を、すべて説明できなくなる。
6. 暫定の起動データを、ゴールデンデータに格上げしない。
   このスキルが作るのは、起動・ログイン・画面の探索をできるようにするための暫定のデータであり、比較の正解ではない。
   ゴールデンデータセットは、`golden-dataset` が確認済みの意味論を基に、別に作る。
7. 本番の環境を参照しない。本番に接続しない。受け取った資産に本番の接続情報が含まれていても使わない（見つけたら、使わずに利用者に報告する）。
8. 「建った」ことを、「正しく建った」と言い換えない。
   起動できても、根拠の無い値で埋めた箇所は、`semantics.md` に確認待ちとして残る。未確認のまま引き渡す場合は、その一覧を引き渡しのメタデータに載せる（確認済みにしない）。
9. 再現できない構築を成果物にしない。
   手作業で通した手順は、作り直しのツールか手順書にまとめ、空の環境から同じ状態を再現できることを実測する（1 回建ったことは、作り直せることの証拠にならない）。
10. シークレットの値を、ログ・標準出力・成果物・設定ファイルに出さない。設定と成果物には、環境変数の名前だけを持つ。利用者や受け取った資産が値を含んでいても、繰り返して書かない。
11. スキルの外の代わりの手段を提案しない。
    「資産が足りないので、手早く適当なデータで建てましょうか」「質問票を省いて、私の判断で埋めましょうか」のような、このスキルの規律を避ける提案をしない。不足は不足として報告する。

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を直接読む（転記しない）。
スキーマの原本は、`replace-strategy` の `references/project-config.md` である。このスキルが読み書きするキーは次のとおりである。

| キー | 用途 |
|---|---|
| `current.origin` | 現行の環境の由来（`managed` / `received-assets`。キーが欠けていれば `managed`）。`received-assets` 以外なら、このスキルは動かずに停止する（意味の原本は、スキーマ文書の「現行環境の由来」） |
| `current.received_assets` | 受け取った資産の置き場所（1 つ以上のパス）。棚卸しの入力である。空か欠けていれば停止し、受け取った資産の場所を利用者に確かめる |
| `current.repo` | 受け取ったコードのリポジトリかローカルのパス。マイグレーション・ORM の定義・enum・バリデーションを導く元である（`none` なら、導く方法が無いことを棚卸しに記録する） |
| `bootstrap_tool_dir` | 作り直しのツールと、暫定の起動データを投入するツールの置き場所（指定が無ければ `bootstrap/`） |
| `targets[]`（`side: current`） | 作り直す先の環境。`--target` で選ぶ。`url`（作り直す前は `none` でよい）・`db.env_vars`・`db.seedable`・`auth.roles`・`forbidden_actions`・`pre_commands` / `start` / `check_urls` を読む |
| `targets[].db.seedable` | 暫定の起動データを投入してよいかの、設定によるチェック。`true` の target にだけ投入する（省略や `false` は読み取り専用の接続である。許可が無ければ設定を直すよう促して停止し、自分で `seedable: true` を足さない） |
| `dataset_mode` / `dataset_static_paths` | データの実体（`db` がデフォルト / `static`）。工程 3 で何を作り直すか（DB か静的データの形式か）と、工程 6 の設定によるチェックの分かれ目に読む。`static` では、書き込み先がすべて `dataset_static_paths` の下に収まることが、投入の条件である（意味の原本は、スキーマ文書の「データセットの実体」） |
| `uses_storage` / `targets[].storage` | ストレージを使うアプリで、起動に要る最小の入れ物（バケット・ディレクトリ）があるかを確かめるのに読む。ゴールデンデータのストレージへの投入は、スコープの外である（原本は、スキーマ文書の「ファイルストレージ」） |
| `secrets.wrapper` | シークレットが要るコマンドの前に付けるラッパー |
| `references.env_setup` | 環境変数の用意の仕方。接続の確認や起動に失敗したときの案内先 |
| `references.coding_conventions` | 作り直しのツールと投入ツールを書くときに従う規約（ツールは対象のプロジェクトのコードである）。未整備でも停止しないが、推測で自分の書き方を持ち込まない（意味の原本は、スキーマ文書の「コーディング規約」） |
| `references.db_semantics` | 既に整備されていれば、作り直す項目の突き合わせに読む（このスキルは書かない。作り直しの根拠は `schema.md` に書き、それを入力に `db_semantics` を整備するのは `replace-strategy setup` である）。未整備でも停止しない |
| `verification_commands` | 作った作り直しのツールと投入ツールに通す、検証のコマンド。通すのは `full`（全体を対象にする列）で、`diff`（変更したファイルだけの列）は使わない。`full` が無くても、値がリスト（古い形式で、実行する範囲を宣言していない）でも停止せず、そのことを `verification.md` に記録して進む（意味の原本は、スキーマ文書の「検証コマンド」） |

- 原本の「移行」の節に並んだ古いキーは、代わりの値として読まない。見つけたら、その節を示して停止する。
  一律に停止するのは、キー名が変わった古いキーだけである。`verification_commands` がリストのような、キー名の変わらない移行は、上の表のとおりに扱う。
- このスキルが設定に書くのは、引き渡しの 1 か所だけである。
  作り直しが済んだ current の target の `url`（`none` から実際の URL へ）と `default: true` を、利用者に確かめたうえで、既存の内容を消さずに追記する（[`references/verification-handoff.md`](references/verification-handoff.md)）。

## 自律実行（`--autonomous`）

取り決め（宣言・越えない線・停止の 2 つの種類・保留の記録の形・最後にまとめて聞く手順）の原本は、`replace-strategy` の `references/autonomy.md` である（ここへ転記しない）。
そのファイルを読めない場合は自律実行せず、確認のたびに止まる。このスキルに固有の扱いは次のとおりである。

- 対象の選択（`--target` を省いたとき。候補が 1 つでも自動で選ばない）は保留にせず、候補を示して停止する（原本の「宣言」）。
- 判断待ち（保留にする）は次のものである。
  - `--resume` が無いときに、既存の `metadata.json` がある実行を続きから進めてよいか
  - 暫定の起動データを投入する前の「テスト環境であることの確認」（自己申告のチェック）
  - 出所と利用の許可が分からないデータを投入してよいか
  - 引き渡しのときの `url` と `default: true` の書き込み
- 自律実行でも停止するのは、下記の「停止と再開」の表の条件である（資産の不足・スキーマを作り直せない・DB の設定を判断できない・質問票の回答待ち・`seedable` の欠落）。
  これらは先方や SME の回答や資産で埋まる前提の欠落で、実行中の利用者の判断では埋まらない。
- 記録先は、`metadata.json` の `pending_decisions[]` と `run.autonomous` である。
  解決していない保留が残る間は、`status: handed-off` にしない。`status: blocked` のまま、`blocked_on` に `判断待ち: <id>` を載せる。
- このスキルが設定に書く 1 か所（引き渡し）も、越えない線に当たる（人が確定させる方針のキー）。値は保留に記録し、答えが得られてから書く。

## 実行フロー

詳しい手順は、各 reference にある。番号の順に進める。
各工程は「根拠が取れたか」で、進むか止まるかを決める。取れないものを推測で埋めて、次に進まない。

1. 受け取った資産の棚卸し: `current.received_assets` の下と `current.repo` を走査し、何が届いているかを一覧にする。詳細: [`references/asset-inventory.md`](references/asset-inventory.md)
2. 必要な資産の分類: 作り直しに要る資産を、「受領済み」「導出可能」（コードなどから導ける）「不足」に分ける。
   「導出可能」は、決定論的に欠けなく作り直せる場合だけである。一部しか作り直せないものは、不足に置く。詳細: [`references/asset-inventory.md`](references/asset-inventory.md)
3. DB のスキーマと設定の作り直し: DDL か、導く元（マイグレーション・ORM の定義）から、テーブル・制約・ビュー・関数・文字コード・照合順序・タイムゾーン・実行の順を作り直し、根拠を 1 項目ずつ記録する。
   判断できない項目は、デフォルト値で補わず、不足として停止する（禁止事項 5）。詳細: [`references/schema-restoration.md`](references/schema-restoration.md)
4. データの意味論の根拠を集める: コードの値・状態遷移・業務のシナリオの根拠を、確定の根拠として使える情報源から集める。
   確定できないものは、「確認待ち」として台帳（`semantics.md`）に記録する。詳細: [`references/data-semantics.md`](references/data-semantics.md)
5. 質問票と追加の資産の依頼を作る: 不足する資産と確認待ちの意味論を、先方や SME が答えられる形の質問票にする。答えが無いときの影響まで書く。詳細: [`references/questionnaire.md`](references/questionnaire.md)
6. 暫定の起動データを作る: 根拠を確かめられた範囲で、起動・ログイン・主要な画面への到達に要る最小限を作る。
   起動に欠かせない項目の意味を確かめられない場合は、でっち上げずに停止する（工程 5 の質問票を示す）。詳細: [`references/provisional-data.md`](references/provisional-data.md)
7. 起動と到達の検証: 現行のアプリを起動し、疎通・認証・主要な画面への到達を実測する。詳細: [`references/verification-handoff.md`](references/verification-handoff.md)
8. 作り直しの再実行の検証: 空の環境から、工程 3 と 6 のツールだけで同じ状態を再現できることを実測する（禁止事項 9）。詳細: [`references/verification-handoff.md`](references/verification-handoff.md)
9. current の target の引き渡し: 設定の current の target を確定させ、`metadata.json` に `status: handed-off` と未確認の一覧を記録して、`replace-strategy` の測定に戻す。詳細: [`references/verification-handoff.md`](references/verification-handoff.md)

### 停止と再開

停止は失敗ではなく、このスキルの正常な出力の 1 つである。
停止するときは、必ず次の 3 つを示す。(1) 何が足りないか。(2) 誰に何を聞けば埋まるか。(3) 埋まるまで何ができないか。
`metadata.json` に `status: blocked` と `blocked_on` を記録し、質問票を示す。回答や追加の資産が届いたら、`--resume` で停止していた工程から再開する（工程 1 からやり直さない）。

**停止したときも、到達した工程の成果物はファイルとして書く。**
どれだけ早い工程で止まっても、`assets-inventory.md`・`questionnaire.md`・`metadata.json` の 3 つは、必ず書き出してから停止する。
この 3 つが `--resume` で再開する材料そのものであり、応答の本文に書いただけでは、次の実行に何も残らない。
作らないのは、到達していない工程の成果物だけである（工程 3 に入っていなければ、`schema.md` を空のテンプレートで置かない。空のテンプレートは着手済みに見え、未着手と区別できなくなる）。
この 2 つを取り違えて、何も書かずに停止することはしない。
成果物を作ったと報告するなら、実際にファイルを書いたことを確かめてから書く（書いていないものを「作成した」と述べない）。

| 停止する条件 | 再開に要るもの |
|---|---|
| 受け取った資産の場所が分からない、または空である（`current.received_assets`） | 資産の受け取り、または場所の確認 |
| スキーマを欠けなく作り直せない（一部しか作り直せない、導けない） | DDL・マイグレーション・スキーマのダンプの追加の受け取り |
| DB の設定（文字コード・照合順序・タイムゾーンなど）を判断できない | 先方の設定の情報、またはスキーマのダンプのヘッダ |
| 出所と利用の許可が分からないデータしか無い | 出所と利用の許可の確認、または本番でないデータの追加の受け取り |
| 起動に欠かせない項目の意味論を確かめられない | 質問票への回答（SME・先方） |
| 投入先の target が `db.seedable: true` でない | 設定の修正（人が行う） |

## 成果物

すべて対象のプロジェクトに置く。スキーマの原本はこのスキルにある（テンプレートは [`assets/`](assets/)）。

| 成果物 | 場所 | 内容・原本 |
|---|---|---|
| 受け取った資産のインベントリと、不足する資産の一覧 | `.replace/bootstrap/assets-inventory.md` | 原本: [`assets/assets-inventory-template.md`](assets/assets-inventory-template.md) |
| DB のスキーマと設定の、作り直しの根拠 | `.replace/bootstrap/schema.md` | 原本: [`assets/schema-template.md`](assets/schema-template.md) |
| データの意味論の台帳（暫定のデータの根拠・確認の状態） | `.replace/bootstrap/semantics.md` | 原本: [`assets/semantics-template.md`](assets/semantics-template.md)。`golden-dataset` と `parity-suite` が読んで引き継ぐ |
| 先方・SME 向けの質問票と、追加の資産の依頼 | `.replace/bootstrap/questionnaire.md` | 原本: [`assets/questionnaire-template.md`](assets/questionnaire-template.md) |
| 起動・認証・到達・再実行の検証の結果 | `.replace/bootstrap/verification.md` | 原本: [`assets/verification-template.md`](assets/verification-template.md) |
| 引き渡しのメタデータ | `.replace/bootstrap/metadata.json` | 原本: [`assets/metadata-template.json`](assets/metadata-template.json) |
| 作り直しのツールと、暫定の起動データを投入するツール | `<bootstrap_tool_dir>`（デフォルトは `bootstrap/`） | 決定論的で冪等にし、commit する（原本: [`references/provisional-data.md`](references/provisional-data.md)） |

## 姉妹スキルとの連携

- 依存の順: 全体の依存の順の原本は、`replace-strategy` の `SKILL.md`「姉妹スキルと依存順」である（ここへ転記しない）。
  このスキルの直前は `replace-strategy setup` の由来の確認で、直後は `replace-strategy setup` の測定・戦略・機能インベントリである。
- `replace-strategy`: `current.origin: received-assets` のとき、`setup` が測定の前にこのスキルに任せる。引き渡した後、`setup` は作り直した target を測定する。
  機能インベントリで採番した後、`semantics.md` の「対象機能」列に slug を書き戻すのは、`replace-strategy` の担当である。
- `golden-dataset`: `semantics.md` の確定済みの意味論と根拠を引き継いで、ゴールデンデータセットを設計する。
  確認待ちや、確かめたが確定できなかった意味論を、確定したものとして扱わない。暫定の起動データを流用しない。
  フェーズ A の投入は暫定の起動データを置き換えるので、起動に要る前提（認証のユーザー・マスタなど）は、確定の根拠に基づいてフェーズ A のデータ設計に含める。
- `parity-suite`: 対象の slug に欠かせない意味論が、`semantics.md` の状態「確認待ち」か「確認したが確定できなかったもの」に残っている間は、その機能のスイートの構築を始めない（足りない情報を報告して停止する）。
