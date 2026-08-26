---
name: golden-dataset
description: 仕様を変えないアプリケーションリプレイスで、現行と新側の比較を成立させるための共通ゴールデンデータセットを構築する replace-strategy の姉妹スキル。データそのものではなく、冪等・決定論的な投入ツール（TypeScript か SQL）を作る。本番環境は参照せずデータを一から作る。新側スキーマは後から出来るため 2 フェーズに分ける（A は論理データ設計と現行テスト環境への投入・検証、B は新側スキーマへの写像・投入・現新一致検証）。投入先の環境は --target で選ぶ（フェーズ B の記録は target 別）。データセットにバージョンを持たせ parity-suite / parity-diff のベースライン陳腐化検出に使う。replace-strategy setup 完了が前提。「ゴールデンデータセットを作って」「テストデータを投入して」「golden-dataset」や --phase / --target を伴う依頼で発動する。
argument-hint: "[--phase <a|b>] [--feature <slug>...] [--target <name>]"
license: MIT
---

# Golden Dataset

`replace-strategy` の姉妹スキル。**現行と新側の比較を成立させるための共通データセットを構築する**。共通データが両側に無ければ「一覧に 3 件出る」という現行の正解を新側で検証できず、**構造しか比べられない**。

**作るのはデータそのものではなく、投入ツールである。** データはその出力にすぎない。ツールは冪等・決定論的で、何度実行しても同じ状態になり、現行と新側に同じ論理データを入れる。

**新側スキーマは `parity-replace` が実装するまで存在しない**ため、両側への投入を 1 回で完結できない。作業を 2 フェーズに分ける。

## 使い方

```text
golden-dataset [--phase <a|b>] [--feature <slug>...] [--target <name>]
```

| モード | 起点 | 内容 |
|---|---|---|
| フェーズ A（初回） | `.replace/dataset/metadata.json` が無い | 論理データ設計 → 投入ツール生成 → 現行側へ投入 → 現行側検証 |
| フェーズ A（再実行） | `parity-suite` の `gaps.md`「データ不足」行 | 設計追記 → ツール更新 → 再投入 → 再検証。`version` を +1 し、影響ベースラインの再取得（`parity-suite` 再実行）を案内する |
| フェーズ B（`--phase b --feature <slug>... [--target <name>]`） | 対象 slug の新側の受け皿（スキーマ／静的データ形式）が揃った | 新側への写像 → 選択した新側 target へ投入 → 新側整合性＋現新一致検証。**論理データは変えないので `version` は上げない** |

- **無指定**: `.replace/dataset/metadata.json` が無ければフェーズ A（初回）。あれば用途を確認する（データ追加＝フェーズ A 再実行か、フェーズ B か）
- **データセットの実体は設定の `dataset_mode`**（既定 `db`）。`db` は各 target の DB、`static` はリポジトリ内の静的データ（`dataset_static_paths` 配下）で、
  **`static` は投入先 target に `db` を要求しない**（DB を持たない静的サイト等でもフェーズ A が成立する）。契約の正本は `replace-strategy` の `references/project-config.md`
- `--target <name>` は**投入先の実行対象環境**。フェーズ A は設定の `targets` のうち `side: current`、フェーズ B は `side: new` のものだけを候補にする（本スキルが対象とする側の宣言はここが正本）。
  `dataset_mode: db` ではさらに**`db.seedable: true` の target に限る**（`env_vars` だけの target は読み取り専用、`db` を書かない target の DB には触れない）。
  省略時の既定・候補提示・存在しない名前や側違いでの停止といった**選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う**（ここへ転記しない）
- フェーズ A の論理データが共通の正本で、**フェーズ B は写像するだけ**（新しいデータを作らない）
- `slug` は `.replace/features.md` が採番したものを使う。**自分で採番しない**
- 自然文でも発動する:「ゴールデンデータセットを作って」「テストデータを投入して」

## 前提

- **ツール**: `git`。投入ツールの実行手段（DB クライアント・言語ランタイム）はプロジェクト側の前提
- **前提スキル**: `replace-strategy`（`setup` 完了）。`current.origin: received-assets` のプロジェクトではさらに `current-environment-bootstrap` の引き渡し完了（`.replace/bootstrap/metadata.json` の `status: handed-off`）
- **前提スキルが未インストールの場合**: `gh skill install shoji9x9/skills replace-strategy` で導入してから実行する。
  本スキルは設定スキーマ・成果物様式の**正本を `replace-strategy` の `references/` / `assets/` に持つ**ため、単体では成立しない（同時に導入されている前提）
- **MCP**: 不要
- **固定の技術スタック前提**: 投入ツールは TypeScript が既定。難しければ SQL（まとめてコミットできる形）

設定（`skills.replace-strategy.*`）または `.replace/features.md` が無ければ、成果物を捏造せず停止して `replace-strategy setup` を促す。

## 厳守の制約（禁止事項）

1. **本番環境を参照しない・本番へ投入しない。** 投入前に接続先の環境変数**名**を提示し（値は表示しない）、テスト環境であることをユーザーに確認してから実行する。
   この自己申告ゲートに加えて**設定由来ゲート**（禁止事項 9）を必ず通す。**どちらか一方でも通らなければ投入しない**
2. **非冪等なツールを作らない。** 事前削除 → 投入で、何度実行しても同じ状態にする
3. **非決定論的なデータを生成しない。** ID・連番・UUID・基準時刻を固定する
4. **代表性を「確認済み」と宣言しない。** 何を含めなかったかを理由付きで必ず残す
5. **本番データ移行ツールを兼ねさせない**（要件が異なる: データ量・性能・停止時間・実データの取り扱い）
6. **非現実的な値ばかりにしない**（文字幅・桁数・改行が表示比較に影響する。`テスト1` のような値ばかりにしない）
7. **シークレットの値をログ・成果物・応答に出さない**（変数名のみ扱う。ユーザーが値を提示しても復唱しない）
8. **データは一から作る。** 例外として非本番の既存データを参考にする場合のみ、本番コピーの可能性を前提にマスキング方針を適用する（**既定は新規作成**）
9. **設定が許可した書き込み先の外へ投入しない**（設定由来ゲート）。`dataset_mode: db` では `db.seedable: true` の target の DB のみ、`static` では `dataset_static_paths` 配下のみ。
   **読み取り専用接続（`db.env_vars` はあるが `seedable` の無い target）へ削除・投入を行わない。** 許可が無ければ設定の修正を促して停止する（自分で設定に `seedable: true` を足さない）
10. **投入ツールに依存を追加するとき、配布元の素性・ライセンス・メンテナンス状況を確認せずに導入しない**（既存パッケージを探さずに自前実装を始めるのも同様）。
    判断材料・工程の正本は `replace-strategy` の `references/dependency-selection.md`、記録先は `.replace/dependencies.md`
11. **フェーズ B の現新一致を逆写像の往復で検証しない**（`map∘unmap = id` で空回りし、宣言外の正規化を足しても通る）。判定は「差の列挙 × 宣言済み差分一覧との完全一致」で行い、
    **宣言外の正規化を 1 件足したら落ちること**まで確認する（詳細: [`references/phase-b.md`](references/phase-b.md)）
12. **ファイルストレージ実体へ投入しない**（v1 スコープ外）。`targets[].storage.seedable: true` でも投入せず、ストレージ実体に依存するデータは
    「ストレージ投入はスコープ外＝未検証」として `verification.md` と `gaps` に残す（確認済みにしない）。アップロード用ファイルの**生成**（決定論的な fixture 生成）は対象で、
    **手書きの静的ファイルを直接コミットして生成ツールを省略しない**（正本: `replace-strategy` の `references/file-io.md`「ファイル入力（アップロード）」・同 `references/project-config.md`「ファイルストレージ」）
13. **暫定起動データをゴールデンデータへ昇格させない。** `current-environment-bootstrap` が作った暫定起動データ（`<bootstrap_tool_dir>`・`.replace/bootstrap/semantics.md` の「暫定起動データに投入した値」）は
    **起動・ログイン・画面探索のための最小限であって比較の正解ではない**。流用は代表性の検討を飛ばすことになる——本スキルは確認済みの意味論から**一から設計する**（投入ツールも別ディレクトリに分ける）
14. **確認待ちの意味論を確定扱いにしない。** `.replace/bootstrap/semantics.md` の「確認待ち」行と「確認したが確定できなかったもの」行の値を、推測・多数決・LLM の一般論で確定させない
    （後者は確認済みだが**確定していない**——「確認待ちに無いから確定済み」と読み替えない）。
    確定できないまま必要になった場合は、その機能のデータを捏造せず**未確定として記録し `verification.md` の「意味論が未確定の機能」へ回す**（その機能の `parity-suite` は開始できない）

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `dataset_mode` | データセットの実体（`db`〈既定〉/ `static`）。投入先解決とフェーズ A / B の投入手順が分岐する |
| `dataset_static_paths` | `dataset_mode: static` のとき投入ツールが生成・削除してよいパス（**書き込み範囲の設定由来ゲート**。無ければ停止） |
| `targets[].db.seedable` | **投入許可の設定由来ゲート**。`true` の target だけが投入対象（省略・`false` は読み取り専用接続） |
| `uses_storage` / `targets[].storage` | ファイルストレージの利用と、その環境の接続・書き込み範囲・投入ゲート（`storage.seedable`）・アップロード経路。**読むだけで投入しない**——ストレージ実体への投入は v1 スコープ外（禁止事項 12）。`uses_storage: true` なら、ストレージ実体に依存するデータを `verification.md` の未投入一覧に残し `gaps` へ回す |
| `targets[].db.env_vars` | 投入先 DB 接続の環境変数**名**（フェーズ A は `side: current`、フェーズ B は `side: new` の選択 target のもの。値は読まない・出力しない） |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |
| `references.db_semantics` | フェーズ B の写像・現新一致検証で読む型マッピングと意味論差（`static` では静的データ形式の対応と意味論差）。**キー欠落・空値・解決できないパスはいずれも未整備**として停止する |
| `verification_commands` | 生成・更新した投入ツールに通す検証コマンド列（静的解析・型検査・テスト）。**設定に無くても停止せず**、その旨を `verification.md` に記録して進む（`parity-replace` の完了判定と違い、ここでは生成物の品質担保であって投入の合否判定ではない。意味論の正本はスキーマ文書の「検証コマンド」） |
| `references.coding_conventions` | 投入ツールを書くときに従うコーディング規約（**投入ツールは対象プロジェクト側のコード**であり、リポジトリの規約に従う）。**未整備でも停止しないが、推測で自分の流儀を持ち込まない**——基底ドキュメント・リント設定・既存コードから読み取る（意味論の正本はスキーマ文書の「コーディング規約」） |
| `references.dependency_policy` | 投入ツールに依存を足すときの方針（**三値**。意味論の正本はスキーマ文書の「依存導入の方針」）。**キー欠落＝未確認**のときだけ、ユーザーに要否を確認した結果を同キーへ非破壊追記する |
| `dataset_tool_dir` | 投入ツールの配置先（未指定時は `seed/`） |
| `current.origin` | 現行環境の由来（`managed` / `received-assets`。**キー欠落は `managed`**）。`received-assets` のときだけ `.replace/bootstrap/` を前提確認と設計の入力にする（意味論の正本はスキーマ文書の「現行環境の由来」） |
| `bootstrap_tool_dir` | `current-environment-bootstrap` の暫定起動データ投入ツールの配置先（未指定時 `bootstrap/`）。**本スキルの `dataset_tool_dir` と分けるため**に読む（同じディレクトリ・同じエントリに相乗りさせない。禁止事項 13） |

`targets[].forbidden_actions` は**アプリへの UI / API 操作**が対象で投入ツールには適用されないため、本スキルは読まない（正本参照）。投入の安全弁は上表の設定由来ゲートと「本番でないことの確認ゲート」の 2 枚が担う。

対象テーブル・リソースドメインは `.replace/features.md` から引く。**テーブルは 3 つの表（機能一覧の「テーブル」列・横断 API とバッチの「参照テーブル」列）に分散しているので 3 つとも読む**（詳細: [`references/data-design.md`](references/data-design.md)）。

- **正本の「移行」節に列挙された旧キーはフォールバックとして読まない。** 見つけたら同節を示して停止する
- **本スキルは設定を生成しない**（読むだけ）。例外は**非破壊追記の 2 つ**——フェーズ B で見つかった新規の意図的差異を `intentional_diffs.pending` へ追記してユーザー確認へ回すことと、
  投入ツールに依存を足すときに `references.dependency_policy` が**キー欠落＝未確認**だった場合の確認結果を同キーへ追記すること

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

### フェーズ A（現行フェーズ）

1. **前提確認と早期失敗**: 設定・`.replace/features.md` を確認し、`dataset_mode`（既定 `db`）で分岐する。
   **`current.origin: received-assets` の場合は先に `.replace/bootstrap/metadata.json` を読む**——`status` が `handed-off` でなければ、現行環境がまだ比較基準として成立していないため
   **投入せず停止**して `current-environment-bootstrap` の完了を促す（`blocked` なら質問票の回答待ちであることを併せて示す）。
   `handed-off` なら `handoff.boot_requirements` を控える（手順 2 で使う）。`managed`・キー欠落のプロジェクトでは本確認を行わない。
   - **`db`**: DDL（またはスキーマを決定論的に得る手段）が無ければ停止してユーザーに確認する。投入先 target（`side: current`）を確定する。
     **候補は `db.seedable: true` の target に限る**——選択された target（`--target` 省略時の `default` を含む）が `seedable: true` を持たなければ**投入せず停止**し、
     投入してよい target を選ぶか設定に `seedable: true` を足すようユーザーに促す（`env_vars` だけの target は読み取り専用、`db` を書かない target の DB には触れないため）。
     確定したらその `db.env_vars` の存在確認（値は出さない）を `secrets.wrapper` 前置で最初に行い、繋がらなければ早期に失敗する
   - **`static`**: `dataset_static_paths` が 1 つ以上あることを確認し（無ければ停止）、その配下が現行リポジトリで読み書きできることを確認する。**投入先 target に `db` を要求しない**。
     現行の静的データの形式（ファイル配置・フィールド構成・型。DDL に相当する）を現行リポジトリから決定論的に読み取れなければ停止してユーザーに確認する
2. **データ設計**: DDL の制約と機能インベントリを起点に、エッジケースを意図的に含めて設計する。詳細: [`references/data-design.md`](references/data-design.md)。
   **`current.origin: received-assets` では加えて `.replace/bootstrap/semantics.md` を読む**——「確定済み」の意味論だけを設計の根拠に使い、「確認待ち」の行は根拠にしない（禁止事項 14）。
   `handoff.boot_requirements` に挙がった**起動要件（認証ユーザー・マスタ・コード表等）を必ず設計に含める**——本フェーズの投入は暫定起動データを事前削除で置き換えるため、
   含めないと投入後に現行アプリが起動しなくなる。確認待ちのために設計できなかった機能は手順 6 で「意味論が未確定の機能」として記録する
3. **投入ツール生成**: 削除（FK 依存の逆順）→ 投入（依存順）→ 検証の構造で、冪等・決定論的に作る。
   書き方はリポジトリの規約（`references.coding_conventions`）に従い、生成後に設定の `verification_commands` を通す（無ければ停止せず記録して進む）。詳細: [`references/seeding-tool.md`](references/seeding-tool.md)
4. **投入ゲート（2 枚）**: **設定由来**（禁止事項 9。`db` は投入先 target の `db.seedable: true`、`static` は書き込み先がすべて `dataset_static_paths` 配下に収まること）と
   **自己申告**（厳守の制約 1 の確認）の両方を通してから投入する。どちらか一方でも通らなければ投入しない
5. **投入**: `db` は選択した `side: current` の target へ投入し、`static` は `dataset_static_paths` 配下へ生成する（新側の受け皿はまだ存在しないため新側へは投入しない）
6. **検証**: `db` は FK 整合・必須項目・件数、`static` は形式妥当性（必須フィールド・型・参照整合）・件数を検査し、カバレッジ（どのテーブル／どの静的データのどのパターンを含んだか）を報告する。
   **`current.origin: received-assets` では、未確定の意味論（「確認待ち」と「確認したが確定できなかったもの」の両方）のせいで最低限のシナリオを確定できなかった機能を
   `verification.md` の「意味論が未確定の機能」へ slug 単位で記録する**
   （`parity-suite` がこの記録を読んで開始可否を判断する。**捏造で埋めて「確認済み」にしない**）
7. **成果物記録**: `design.md` / `verification.md` / `metadata.json` を生成し、**投入ツールとデータをコミットする**（本番由来でなく PII を含まないため。大きなバイナリをコミットしない規約は視覚ベースラインの話でここには当てはまらない）。
   `metadata.json` の `mode` に `dataset_mode` の値を記録したうえで:
   - **`db`**: `current.target` に**投入先の current target 名**を記録する（`parity-suite` がベースライン採取時に自分の選択 target と照合し、不一致なら停止する）
   - **`static`**: 投入先環境を持たないため `current.target` と `current.seeded_at` を `null` にし、代わりに `current.fingerprint` へ生成物の決定論的ハッシュを記録する
     （`parity-suite` は `current.target` が `null` なら target 照合を行わない）

### フェーズ B（新側フェーズ・slug ごと）

1. **前提確認**: 対象 slug の新側の受け皿（`parity-replace` が実装したスキーマ／静的データ形式）と `references.db_semantics` を確認し、無ければ停止する（`db_semantics` は整備を促す）。
   投入先 target（`side: new`。`--target` で選択）は `dataset_mode: db` なら `db.seedable: true` と `db.env_vars` 接続を要求し、`static` なら `db` を要求せず `dataset_static_paths` の書き込み可否を確認する。
   `.replace/dataset/metadata.json`（フェーズ A 完了）が無ければフェーズ A を先に実行するよう案内する
2. **写像設計**: 論理データ → 新側の受け皿への写像を設計する（`db_semantics` の型マッピング・意味論差、`intentional_diffs.may_change` の型変換等を適用）。詳細: [`references/phase-b.md`](references/phase-b.md)
3. **投入**: 投入ツールに新側ターゲットを追加し、フェーズ A と同じ 2 枚のゲートを通してから選択した target へ投入（`static` は生成）する。
   **ツールを更新したらフェーズ A と同じく規約（`references.coding_conventions`）に従い、設定の `verification_commands` を通す**（無ければ停止せず `verification.md` に記録して進む）
4. **検証**: 新側整合性＋現新一致を検査する。現新一致は**差のある箇所を列挙し、宣言済みの差分一覧（`db_semantics` / `intentional_diffs.may_change`）と完全一致するか**で判定し、**逆写像（新側 → 論理）の往復で書かない**（前方写像と同じ表を使う限り恒等になり、宣言外の正規化を足しても通る）。
   宣言外の正規化を 1 件足したら検証が落ちることまで確認して `verification.md` に記録する。**説明できない不一致は失敗として扱い修正する**。新規の意図的差異は `intentional_diffs.pending` へ追記しユーザー確認へ回す
5. **成果物記録**: `metadata.json` の `phase_b.<slug>.<target>` を更新する（`version` は上げない）。同じ DB を共有する target でも target ごとに実行して記録する

## 成果物

すべて対象プロジェクト側に置く。**スキーマの正本は本スキル**（テンプレート: [`assets/`](assets/)）。**投入ツールは対象プロジェクト側の成果物**であり、スキル本体に同梱する配布物ではない（位置づけの詳細: [`references/seeding-tool.md`](references/seeding-tool.md)）。

| 成果物 | 場所 | 内容・正本 |
|---|---|---|
| 投入ツール | `<dataset_tool_dir>`（既定 `seed/`） | 削除・投入・検証。冪等・決定論的・**コミットする** |
| データ設計 | `.replace/dataset/design.md` | 正本: [`assets/design-template.md`](assets/design-template.md) |
| 検証レポート | `.replace/dataset/verification.md` | 正本: [`assets/verification-template.md`](assets/verification-template.md) |
| メタデータ | `.replace/dataset/metadata.json` | 正本: [`assets/metadata-template.json`](assets/metadata-template.json) |
| 依存の決定記録（投入ツールに依存を足したときのみ） | `.replace/dependencies.md` へ**非破壊追記**（無ければテンプレートから作成） | 様式の正本: `replace-strategy` の `assets/dependencies-template.md` |

- `version` の運用（上げる条件・フェーズ B で不変・陳腐化検出）は [`references/versioning.md`](references/versioning.md) が正本

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup。`received-assets` なら測定前に `current-environment-bootstrap`）→ **golden-dataset（フェーズ A）**
  → 各機能で〔`parity-suite` → `parity-replace` → **golden-dataset（フェーズ B）** → `parity-diff`（`parity-replace` と往復）〕
- **`current-environment-bootstrap`**: `current.origin: received-assets` のとき、`.replace/bootstrap/semantics.md` の**確定済み**の意味論と根拠を引き継ぐ。
  暫定起動データとツールは流用せず（禁止事項 13）、`handoff.boot_requirements` の起動要件だけを本スキルのデータ設計へ取り込む
- **`parity-suite`**: フェーズ A 完了（＝`.replace/dataset/metadata.json` の存在）が前提。探索でシード不足を見つけると `gaps.md`「データ不足」で本スキルへ戻る。戻ると `version` が上がり、影響ベースラインを再取得する
- **`parity-replace`**: フェーズ B の前提となる新側スキーマを作る。自分が選んだ新側 target を渡して `golden-dataset --phase b --feature <slug> --target <name>` として呼ぶ
- **`parity-diff` / `replace-strategy status`**: `metadata.json` の `version` で陳腐化を検出する（記録 < 現在なら再取得）。フェーズ B の投入状況は `phase_b.<slug>.<target>` を target 単位で見る
