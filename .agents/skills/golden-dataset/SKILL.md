---
argument-hint: '[--phase <a|b>] [--feature <slug>...] [--target <name>] [--autonomous]'
description: 仕様を変えないアプリケーションリプレイスで、現行と新側の比較を成立させるための共通ゴールデンデータセットを構築する replace-strategy の姉妹スキル。データそのものではなく、冪等・決定論的な投入ツール（TypeScript か SQL）を作る。本番環境は参照せずデータを一から作る。新側スキーマは後から出来るため 2 フェーズに分ける（A は論理データ設計と現行テスト環境への投入・検証、B は新側スキーマへの変換・投入・現新一致検証）。投入先の環境は --target で選ぶ（フェーズ B の記録は target 別）。データセットにバージョンを持たせ parity-suite / parity-diff のベースライン陳腐化検出に使う。replace-strategy setup 完了が前提。「ゴールデンデータセットを作って」「テストデータを投入して」「golden-dataset」や --phase / --target を伴う依頼で発動する。
license: MIT
name: golden-dataset
---
# Golden Dataset

`replace-strategy` の姉妹スキル。現行と新側の比較を成り立たせるための、共通のデータセットを作る。
共通のデータが両側に無ければ、「一覧に 3 件出る」という現行の正解を新側で確かめられず、構造しか比べられない。

作るのは、データそのものではなく投入ツールである。データはその出力にすぎない。
ツールは冪等で決定論的に作る。何度実行しても同じ状態になり、現行と新側に同じ論理データを入れる。

新側のスキーマは、`parity-replace` が実装するまで存在しない。そのため、両側への投入を 1 回で終えられないので、作業を 2 つのフェーズに分ける。

## 使い方

```text
golden-dataset [--phase <a|b>] [--feature <slug>...] [--target <name>] [--autonomous]
```

| モード | 起点 | 内容 |
|---|---|---|
| フェーズ A（初回） | `.replace/dataset/metadata.json` が無い | 論理データの設計、投入ツールの生成、現行側への投入、現行側の検証 |
| フェーズ A（再実行） | `parity-suite` の `gaps.md`「データ不足」の行 | 設計の追記、ツールの更新、再投入、再検証。`version` を 1 上げ、影響を受けるベースラインの再取得（`parity-suite` の再実行）を案内する |
| フェーズ B（`--phase b --feature <slug>... [--target <name>]`） | 対象の slug の新側の受け皿（スキーマ／静的データの形式）がそろった | 新側への変換、選んだ新側の target への投入、新側の整合性と現新一致の検証。論理データは変えないので `version` は上げない |

- 何も指定しないとき: `.replace/dataset/metadata.json` が無ければフェーズ A（初回）を行う。あれば用途（データの追加＝フェーズ A の再実行か、フェーズ B か）を確認する
- データセットの実体は、設定の `dataset_mode`（デフォルトは `db`）で決まる。`db` は各 target の DB、`static` はリポジトリの中の静的データ（`dataset_static_paths` の下）である。
  `static` は投入先の target に `db` を求めない（DB を持たない静的サイトなどでもフェーズ A が成り立つ）。取り決めは `replace-strategy` の `references/project-config.md` で定義する
- `--target <name>` は、投入先の実行対象環境である。フェーズ A は設定の `targets` のうち `side: current` のものだけを、フェーズ B は `side: new` のものだけを候補にする（このスキルが対象とする側は、ここで定義する）。
  `dataset_mode: db` では、さらに `db.seedable: true` の target に限る（`env_vars` だけの target は読み取り専用で、`db` を書かない target の DB には触れない）。
  省略したときのデフォルト、候補の提示、存在しない名前や側の違いで止めることなどの選択の規則は、`replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）
- フェーズ A の論理データが共通の原本で、フェーズ B は変換するだけである（新しいデータを作らない）
- `slug` は `.replace/features.md` が採番したものを使う。自分で採番しない
- `--autonomous` は、その実行だけを自律で進めるという宣言である（下の「自律実行」）。省いたときは、判断のたびに確認する
- 自然文でも発動する:「ゴールデンデータセットを作って」「テストデータを投入して」

## 前提

- ツール: `git`、`node`（同梱のスクリプト [`scripts/predicate-coverage-check.mjs`](scripts/predicate-coverage-check.mjs) の実行に使う。依存パッケージは要らない）。投入ツールを実行する手段（DB クライアント・言語ランタイム）は、プロジェクト側で用意する
- 前提スキル: `replace-strategy`（`setup` が完了していること）。`current.origin: received-assets` のプロジェクトでは、さらに `current-environment-bootstrap` の引き渡しが完了していること（`.replace/bootstrap/metadata.json` の `status: handed-off`）
- 前提スキルがインストールされていない場合: `gh skill install shoji9x9/skills replace-strategy` で導入してから実行する。
  このスキルは、設定のスキーマと成果物の様式を `replace-strategy` の `references/` と `assets/` で定義しているので、単体では動かない（同時に導入されている前提）
- MCP: 要らない
- 技術スタック: 投入ツールは、デフォルトでは TypeScript で書く。難しければ SQL（まとめてコミットできる形）で書く

設定（`skills.replace-strategy.*`）か `.replace/features.md` が無ければ、成果物を捏造せずに止まり、`replace-strategy setup` を促す。
`.replace/strategy-pending.json` に `setup` の未解決の保留があるときも、同じく止まる。どの保留を見るかは、`replace-strategy` の `references/autonomy.md`「下流の前提判定」で定義する。

## 厳守の制約（禁止事項）

仕様の確認は、十分な証拠が得られる、いちばんコストの低い方法から始める。
選んだ現行の target から取得し、対象の版・採取の時点・条件を追跡できる実行ログや観測記録、現行のソースコード、API の実際の動き、UI の実際の動きの順に調べる。
ページサイズや状態の値を下位の証拠だけで確定できない場合に限って、次に上げる。調査のコストは、実行ログや観測記録、ソースコード、API の操作、UI の操作の順に高くなるからである。
必要な証拠が得られた時点で止め、API や UI の操作は足りないときだけ行う。
設計書・仕様書・受け取ったログを含む受領資料は、調べる候補を挙げるのに使ってよいが、現行の挙動を確定する根拠にはしない。
UI に固有のページ送りの機能は UI で確定し、どこまで上げたかと理由を `design.md` に残す。

1. 本番環境を参照せず、本番へ投入しない。投入の前に、接続先の環境変数の名前を示し（値は表示しない）、テスト環境であることをユーザーに確認してから実行する。
   この自己申告のチェックに加えて、設定によるチェック（禁止事項 9）を必ず通す。どちらか一方でも通らなければ投入しない
2. 冪等でないツールを作らない。事前に削除してから投入し、何度実行しても同じ状態にする
3. 決定論的でないデータを生成しない。ID・連番・UUID・基準の時刻を固定する
4. 代表性を「確認済み」と宣言しない。何を含めなかったかを、理由付きで必ず残す
5. 本番のデータ移行ツールを兼ねさせない（データの量・性能・停止時間・実データの扱いという要件が違う）
6. 現実的でない値ばかりにしない（文字の幅・桁数・改行が表示の比較に影響する。`テスト1` のような値ばかりにしない）
7. シークレットの値を、ログ・成果物・応答に出さない（変数名だけを扱う。ユーザーが値を示しても繰り返さない）
8. データは一から作る。例外として、本番でない既存のデータを参考にする場合だけ、本番のコピーである可能性を前提に、マスキングの方針を当てる（デフォルトは新規の作成）
9. 設定が許した書き込み先の外へ投入しない（設定によるチェック）。`dataset_mode: db` では `db.seedable: true` の target の DB だけ、`static` では `dataset_static_paths` の下だけに投入する。
   読み取り専用の接続（`db.env_vars` はあるが `seedable` の無い target）に、削除も投入もしない。許可が無ければ設定を直すよう促して止まる（自分で設定に `seedable: true` を足さない）
10. 投入ツールに依存を足すとき、配布元の素性・ライセンス・メンテナンスの状況を確かめずに導入しない（既存のパッケージを探さずに自前の実装を始めるのも同じ）。
    判断の材料と工程は `replace-strategy` の `references/dependency-selection.md` で定義し、記録先は `.replace/dependencies.md` である
11. フェーズ B の現新一致を、逆変換の往復で検証しない。前向きの変換と同じ表を使う限り `map∘unmap = id` になるので、宣言していない正規化を足しても通ってしまう。
    判定は、差の列挙と、宣言済みの差分の一覧が過不足なく一致するかで行う。宣言していない正規化を 1 件足したら失敗することまで確かめる（詳細: [`references/phase-b.md`](references/phase-b.md)）
12. ファイルストレージの実体へ投入しない。スコープ外で、`replace-strategy` の `references/scope.md` で定義している。
    `targets[].storage.seedable: true` でも投入せず、ストレージの実体に依存するデータは「ストレージへの投入はスコープ外＝未検証」として `verification.md` と `gaps` に残す（確認済みにしない）。
    アップロード用のファイルの生成（決定論的な fixture の生成）は対象である。手で書いた静的ファイルを直接コミットして、生成ツールを省かない。
    取り決めは `replace-strategy` の `references/file-io.md`「ファイル入力（アップロード）」と、`replace-strategy` の `references/project-config.md`「ファイルストレージ」で定義する
13. 暫定の起動データを、ゴールデンデータに昇格させない。
    `current-environment-bootstrap` が作った暫定の起動データ（`<bootstrap_tool_dir>` と、`.replace/bootstrap/semantics.md` の「暫定起動データに投入した値」）は、起動・ログイン・画面の探索のための最小限で、比較の正解ではない。流用すると代表性の検討を飛ばすことになる。このスキルは、確認済みの意味論から一から設計する（投入ツールも別のディレクトリに分ける）
14. 確認待ちの意味論を、確定したものとして扱わない。`.replace/bootstrap/semantics.md` の状態「確認待ち」の行と「確認したが確定できなかったもの」の行の値を、推測・多数決・LLM の一般論で確定させない。
    後者は確認済みだが確定していない。「確認待ちに無いから確定済み」と読み替えない。
    確定できないまま必要になった場合は、その機能のデータを捏造せず、未確定として記録して `verification.md` の「意味論が未確定の機能」に回す（その機能の `parity-suite` は始められない）
15. 同じ投入先に、2 つの実行を同時に入れない。投入は削除してから投入する構造なので、途中では対象のテーブル（`static` では生成先）が空になる。
    同じ target に別の実行が重なると、片方が空を読んで、失敗するか、失敗せずに空を正解として通す。冪等性はこれを防がない（「繰り返しても同じ状態」と「同時に入っても不具合が出ない」は別である）。
    機能ごとに別のブランチや別の worktree で並列に進めること自体は禁じない。そのため、投入ツールに排他（ロック）を実装し、ロックを取れなければ待たずに、投入せずに 0 以外で終える
    （単位・手段・機能することの実測は [`references/seeding-tool.md`](references/seeding-tool.md)「同時実行の排他（ロック）」）。
    ロックが止めるのは、投入どうしの衝突だけである。同じ投入先を読むテスト（`parity-suite` / `parity-diff` の実行）を投入の間に実行しないことは、運用で守る。
    守れなかったことは検出できない（空を読んだテストが失敗するとは限らない）。並列に進めるなら、投入先そのものを分ける（target を分ける）

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を直接読む（転記しない）。スキーマは `replace-strategy` の `references/project-config.md` で定義する。
このスキルが読み書きするキーは次のとおりである。

| キー | 用途 |
|---|---|
| `dataset_mode` | データセットの実体（`db`〈デフォルト〉/ `static`）。投入先の解決と、フェーズ A / B の投入の手順が分かれる |
| `dataset_static_paths` | `dataset_mode: static` のとき、投入ツールが生成・削除してよいパス（書き込みの範囲の、設定によるチェック）。無ければ止まる |
| `targets[].db.seedable` | 投入の許可の、設定によるチェック。`true` の target だけが投入の対象になる（省略や `false` は読み取り専用の接続） |
| `uses_storage` / `targets[].storage` | ファイルストレージを使うかと、その環境の接続・書き込みの範囲・投入の許可（`storage.seedable`）・アップロードの方法。読むだけで投入しない。ストレージの実体への投入はスコープ外である（禁止事項 12）。`uses_storage: true` なら、ストレージの実体に依存するデータを `verification.md` の未投入の一覧に残し、`gaps` に回す |
| `targets[].db.env_vars` | 投入先の DB に接続する環境変数の名前（フェーズ A は `side: current`、フェーズ B は `side: new` の、選んだ target のもの。値は読まず、出力しない） |
| `secrets.wrapper` | シークレットが要るコマンドの前に付けるラッパー |
| `references.db_semantics` | フェーズ B の変換と現新一致の検証で読む、型の対応づけと意味論の差（`static` では静的データの形式の対応と意味論の差）。キーが無い・値が空・解決できないパスは、どれも未整備として止まる |
| `verification_commands` | 生成・更新した投入ツールに通す検証コマンド。通すのは `full`（全体を見る列）で、`diff`（変更したファイルだけの列）は使わない。`full` が無くても、値がリスト（旧形式で、実行の範囲が宣言されていない）でも止まらず、その旨を `verification.md` に記録して進む。`parity-replace` の完了の判定と違い、ここでは生成物の品質を保つためのもので、投入の合否の判定ではない。意味論はスキーマの文書の「検証コマンド」で定義する |
| `references.coding_conventions` | 投入ツールを書くときに従うコーディング規約。投入ツールは対象のプロジェクト側のコードなので、そのリポジトリの規約に従う。未整備でも止まらないが、推測で自分の流儀を持ち込まず、基底ドキュメント・リントの設定・既存のコードから読み取る。意味論はスキーマの文書の「コーディング規約」で定義する |
| `references.dependency_policy` | 投入ツールに依存を足すときの方針（3 つの値。意味論はスキーマの文書の「依存導入の方針」で定義する）。キーが無い＝未確認のときだけ、ユーザーに要否を確かめた結果を同じキーに、既存を消さずに追記する |
| `dataset_tool_dir` | 投入ツールの置き場所（指定が無ければ `seed/`） |
| `current.origin` | 現行環境の由来（`managed` / `received-assets`。キーが無ければ `managed`）。`received-assets` のときだけ、`.replace/bootstrap/` を前提の確認と設計の入力にする。意味論はスキーマの文書の「現行環境の由来」で定義する |
| `bootstrap_tool_dir` | `current-environment-bootstrap` の暫定起動データの投入ツールの置き場所（指定が無ければ `bootstrap/`）。このスキルの `dataset_tool_dir` と分けるために読む（同じディレクトリ・同じエントリに相乗りさせない。禁止事項 13） |

`targets[].forbidden_actions` は、アプリへの UI と API の操作が対象で、投入ツールには当てはまらない。そのため、このスキルは読まない。
投入の安全のための確認は、上の表の設定によるチェックと、本番でないことの確認の 2 つが担う。

対象のテーブルとリソースのドメインは、`.replace/features.md` から取得する。テーブルは 3 つの表（機能の一覧の「テーブル」列、横断 API とバッチの「参照テーブル」列）に分かれているので、3 つとも読む。
その後、現行のコードや実測から、各消費側の絞り込みの列・並び替えの列・ページサイズを求め、必要な値と件数を決める（詳細: [`references/data-design.md`](references/data-design.md)）。

- スキーマの文書の「移行」の節に挙がった旧キーは、フォールバックとして読まない。見つけたら、その節を示して止まる。
  一律に止まるのは、キーの名前が変わった旧キーだけである。`verification_commands` がリストの場合のように、キーの名前が変わらない移行は、上の表の挙動に従う
- このスキルは設定を生成しない（読むだけ）。例外は、既存を消さずに追記する次の 2 つである。
  - フェーズ B で見つけた新しい意図的差異を、`intentional_diffs.pending` に、追記元が分かる形で追記し、ユーザーの確認に回す。
    書くのは 4 つのキーで、差異の文言は `item`（照合のキー）、`added_by: golden-dataset`、`added_at`、`slug` である。`slug` は、帰属できる機能があればその slug、無ければ `cross-cutting` にする。
    `item` を別のキーの名前で書くと、追記のときは通り、何工程か後の `parity-diff` の棚卸しで「`item` が空」として表に出る。要素の形は、スキーマの文書の「`pending` 要素の形」で定義する
  - 投入ツールに依存を足すときに `references.dependency_policy` がキーの無い＝未確認だった場合、確認の結果を同じキーに追記する

## 自律実行（`--autonomous`）

宣言、越えない線、停止の 2 つの分類、保留の記録の形、終わりにまとめて聞く手順という規約は、`replace-strategy` の `references/autonomy.md` で定義する（ここへ転記しない）。
`replace-strategy` の `references/autonomy.md` を読めない場合は、自律実行せず、確認のたびに止まる。このスキルに固有の扱いは次のとおりである。

- 対象の選択（何も指定せず既存の `metadata.json` があるときの用途〈フェーズ A の再実行かフェーズ B か〉と、デフォルトの無い `--target`）は、保留にせず、候補を示して止まる（`replace-strategy` の `references/autonomy.md`「宣言」）
- 判断待ち（保留にする）: 投入の前の自己申告のチェック（テスト環境であることの確認。自律実行でも省かない）、投入ツールへの依存の追加、フェーズ B で `intentional_diffs.pending` に追記した差異の確認
- 保留にしても進める工程: 自己申告のチェックが保留なら、データの設計・投入ツールの生成・`verification_commands.full` の実行までは進める。
  投入・投入後の検証・`metadata.json` への投入の記録（`current.seeded_at` / `current.verified_at` / `phase_b.<slug>.<target>`）は行わない
- 自律実行でも止まる場合: DDL や静的データの形式を決定論的に得られない、設定によるチェック（`seedable` / `dataset_static_paths`）を通らない、`current-environment-bootstrap` が `handed-off` でない
- 記録先: `.replace/dataset/pending-decisions.json`（テンプレート: [`assets/pending-decisions-template.json`](assets/pending-decisions-template.json)）。
  - 要素ごとに `phase` を書く。フェーズ B では、`slugs`（その判断が影響するすべての slug）と `target` も書く。下流は範囲が一致する保留だけで止まるので、書かないと関係の無い機能まで止まる
  - `metadata.json` には書かない。下流（`parity-suite` / `parity-component` / `parity-replace`）は、そのファイルがあることをフェーズ A の完了とみなす。
    保留を残すためにこのファイルを作ると、投入していない環境で後続が進んでしまう
  - 未解決の保留が残る間は、そのフェーズの `metadata.json` を新しく作ることも更新することもせず（投入していない版を記録しない）、完了と報告しない
  - 再実行で既存の `metadata.json` が残っていても、下流は `pending-decisions.json` の未解決の保留を見て、未完了として止まる（`replace-strategy` の `references/autonomy.md`「下流の前提判定」で定義する）

## 実行フロー

詳細は各 reference で定義する。番号の順に進める。

### フェーズ A（現行フェーズ）

1. 前提の確認と早期の失敗。設定と `.replace/features.md` を確かめ、`dataset_mode`（デフォルトは `db`）で分岐する。
   `current.origin: received-assets` の場合は、先に `.replace/bootstrap/metadata.json` を読む。`status` が `handed-off` でなければ、現行環境がまだ比較の基準として成り立っていない。
   そのため、投入せずに止まり、`current-environment-bootstrap` の完了を促す（`blocked` なら、質問票の回答待ちであることもあわせて示す）。
   `handed-off` なら、`handoff.boot_requirements` を控える（手順 2 で使う）。`managed` とキーが無いプロジェクトでは、この確認をしない。
   - `db`: DDL（またはスキーマを決定論的に得る手段）が無ければ止まり、ユーザーに確認する。投入先の target（`side: current`）を確定する。
     候補は `db.seedable: true` の target に限る。選んだ target（`--target` を省いたときの `default` を含む）が `seedable: true` を持たなければ、投入せずに止まる。
     そして、投入してよい target を選ぶか、設定に `seedable: true` を足すよう、ユーザーに促す（`env_vars` だけの target は読み取り専用で、`db` を書かない target の DB には触れないため）。
     確定したら、その `db.env_vars` があることの確認（値は出さない）を、`secrets.wrapper` を前に付けて最初に行い、つながらなければ早く失敗させる
   - `static`: `dataset_static_paths` が 1 つ以上あることを確かめ（無ければ止まる）、その下を現行のリポジトリで読み書きできることを確かめる。投入先の target に `db` を求めない。
     現行の静的データの形式（ファイルの配置・フィールドの構成・型。DDL に当たる）を現行のリポジトリから決定論的に読み取れなければ、止まってユーザーに確認する
2. データの設計。DDL の制約と機能のインベントリを起点に、エッジケースを意図して含めて設計する。詳細: [`references/data-design.md`](references/data-design.md)。
   - `current.origin: received-assets` では、加えて `.replace/bootstrap/semantics.md` を読む。「確定済み」の意味論だけを設計の根拠に使い、「確認待ち」の行は根拠にしない（禁止事項 14）。
   - `handoff.boot_requirements` に挙がった起動の要件（認証ユーザー・マスタ・コード表など）は、必ず設計に含める。このフェーズの投入は、暫定の起動データを事前の削除で置き換える。
     そのため、含めないと投入した後に現行のアプリが起動しなくなる。確認待ちのために設計できなかった機能は、手順 6 で「意味論が未確定の機能」として記録する。
   - 設計の段階で、参照表の役割と行数を消費側から決める。3 つの表を `design.md`「対象テーブル」に転記して役割（`投入する` / `読み取りだけ`）を付ける。
     述語ごとに真と偽の両側を通れる行数を「述語ごとの分岐網羅」に数え、通れない分岐は「足す」か「gaps に記録」のどちらかを選ぶ。
   - 述語の値は、消費側が述語に渡す値（変換の後の値）で書き、「値の出どころ」を残す。データセットが決める識別子の値（採番の帯）は、
     消費側（slug × テーブル）ごとに受け取る型と変換を挙げて「識別子の値の範囲」に記録し、変換の後も同じ値で届くかを確かめる。
     届かないと、述語は設計者の値では真でも、消費側が取得する行は 0 件になり、分岐網羅の表にも検証にも表れない。
   - 突き合わせは、`node <skill>/scripts/predicate-coverage-check.mjs --features .replace/features.md --design .replace/dataset/design.md` を exit 0 になるまで通す。
     通れない分岐を下流で見つけると、ベースラインを採り終えた後に version が上がり、採取した成果物が古くなる
3. 投入ツールの生成。削除（FK の依存の逆順）、投入（依存の順）、検証の構造で、冪等で決定論的に作る。
   同じ投入先への同時の実行を止める排他（ロック）も、ツールに実装する（禁止事項 15）。投入の途中は投入先が空なので、これが無いと、並列に進める別の機能のテストが空を読む。
   機能することを実測してから使う（ロックを持ったまま 2 つ目を起動し、1 行も書かずに 0 以外で終えること）。実測した日時は、`metadata.json` の `tool.lock.verified_at` に残す。
   書き方はリポジトリの規約（`references.coding_conventions`）に従い、生成した後に設定の `verification_commands.full` を通す（無ければ止まらず、記録して進む）。詳細: [`references/seeding-tool.md`](references/seeding-tool.md)
4. 投入のチェック（2 つ）。設定によるチェック（禁止事項 9。`db` は投入先の target の `db.seedable: true`、`static` は書き込み先がすべて `dataset_static_paths` の下に収まること）と、
   自己申告のチェック（厳守の制約 1 の確認）の両方を通してから投入する。どちらか一方でも通らなければ投入しない
5. 投入。`db` は選んだ `side: current` の target へ投入し、`static` は `dataset_static_paths` の下に生成する（新側の受け皿はまだ無いので、新側へは投入しない）
6. 検証。`db` は FK の整合・必須の項目・件数を、`static` は形式の妥当性（必須のフィールド・型・参照の整合）・件数を検査し、カバレッジ（どのテーブル、どの静的データのどのパターンを含んだか）を報告する。
   - 加えて、`design.md` の述語を 1 つずつ実行して該当する行数を数え、`verification.md` の「述語ごとの該当行数」に残す。
     ここで数えるのは、入れたものが入ったかではなく、入れたもので消費側のどの分岐を通れるかである。0 件と 1 件が報告に表れる。
     突き合わせは、同じスクリプトを `--verification .replace/dataset/verification.md` を付けて、exit 0 になるまで通す。
   - `current.origin: received-assets` では、未確定の意味論（「確認待ち」と「確認したが確定できなかったもの」の両方）のために最低限のシナリオを確定できなかった機能を、
     `verification.md` の「意味論が未確定の機能」に slug の単位で記録する。`parity-suite` はこの記録を読んで、始めてよいかを判断する。捏造で埋めて「確認済み」にしない
7. 成果物の記録。`design.md` / `verification.md` / `metadata.json` を生成し、投入ツールとデータをコミットする。
   本番に由来せず PII を含まないからである。大きなバイナリをコミットしないという規約は視覚のベースラインの話で、ここには当てはまらない。
   初回は `changes` に version 1 を、再実行では新しい version と、実際に変えたテーブルや静的データの単位の `affects` を追記し、過去の履歴を残す。
   `metadata.json` の `mode` に `dataset_mode` の値を記録したうえで、次のように書く。
   - `db`: `current.target` に、投入先の current の target 名を記録する（`parity-suite` がベースラインの採取のときに自分の選んだ target と照らし合わせ、一致しなければ止まる）
   - `static`: 投入先の環境を持たないので、`current.target` と `current.seeded_at` を `null` にする。代わりに、`current.fingerprint` に生成物の決定論的なハッシュを記録する
     （`parity-suite` は、`current.target` が `null` なら target を照らし合わせない）

### フェーズ B（新側フェーズ・slug ごと）

1. 前提の確認。対象の slug の新側の受け皿（`parity-replace` が実装したスキーマ／静的データの形式）と `references.db_semantics` を確かめ、無ければ止まる（`db_semantics` は整備を促す）。
   投入先の target（`side: new`。`--target` で選ぶ）について、`dataset_mode: db` なら `db.seedable: true` と `db.env_vars` の接続を求め、`static` なら `db` を求めず、`dataset_static_paths` に書けるかを確かめる。
   `.replace/dataset/metadata.json`（フェーズ A の完了）が無いか、`.replace/dataset/pending-decisions.json` にフェーズ A の未解決の保留があれば、フェーズ A を先に実行するよう案内する
2. 変換の設計。論理データから新側の受け皿への変換を設計する（`db_semantics` の型の対応づけ・意味論の差、`intentional_diffs.may_change` の型の変換などを当てる）。詳細: [`references/phase-b.md`](references/phase-b.md)
3. 投入。投入ツールに新側のターゲットを足し、フェーズ A と同じ 2 つのチェックを通してから、選んだ target へ投入する（`static` は生成する）。
   ツールを更新したら、フェーズ A と同じく規約（`references.coding_conventions`）に従い、設定の `verification_commands.full` を通す（無ければ止まらず、`verification.md` に記録して進む）
4. 検証。新側の整合性と現新一致を検査する。現新一致は、差のある箇所を挙げ、宣言済みの差分の一覧（`db_semantics` / `intentional_diffs.may_change`）と過不足なく一致するかで判定する。
   逆変換（新側 → 論理）の往復では書かない。前方の変換と同じ表を使う限り恒等になり、宣言していない正規化を足しても通るからである。
   宣言していない正規化を 1 件足したら検証が失敗することまで確かめて、`verification.md` に記録する。説明できない不一致は失敗として扱い、直す。
   新しい意図的差異は、`intentional_diffs.pending` に追記してユーザーの確認に回す
5. 成果物の記録。`metadata.json` の `phase_b.<slug>.<target>` を更新する（`version` は上げない）。同じ DB を共有する target でも、target ごとに実行して記録する

## 成果物

すべて対象のプロジェクト側に置く。スキーマはこのスキルが定義する（テンプレート: [`assets/`](assets/)）。
投入ツールは対象のプロジェクト側の成果物で、スキル本体に同梱する配布物ではない（位置づけの詳細: [`references/seeding-tool.md`](references/seeding-tool.md)）。

| 成果物 | 場所 | 内容・原本 |
|---|---|---|
| 投入ツール | `<dataset_tool_dir>`（デフォルトは `seed/`） | 削除・投入・検証。冪等・決定論的で、コミットする |
| データの設計 | `.replace/dataset/design.md` | 原本: [`assets/design-template.md`](assets/design-template.md) |
| 検証のレポート | `.replace/dataset/verification.md` | 原本: [`assets/verification-template.md`](assets/verification-template.md) |
| メタデータ | `.replace/dataset/metadata.json` | 原本: [`assets/metadata-template.json`](assets/metadata-template.json) |
| 依存の決定の記録（投入ツールに依存を足したときだけ） | `.replace/dependencies.md` に既存を消さずに追記する（無ければテンプレートから作る） | 様式の原本: `replace-strategy` の `assets/dependencies-template.md` |

- `version` の運用（上げる条件、フェーズ B では変えないこと、古くなったことの検出）は、[`references/versioning.md`](references/versioning.md) で定義する

## 姉妹スキルとの連携

- 依存の順: 全体の依存の順は、`replace-strategy` の `SKILL.md`「姉妹スキルと依存順」で定義する（ここへ転記しない）。
  フェーズ A の直前は `replace-strategy setup` が完了していること、フェーズ B は各機能の `parity-replace` の途中（新側のスキーマが確定した後）で呼ばれる
- `current-environment-bootstrap`: `current.origin: received-assets` のとき、`.replace/bootstrap/semantics.md` の確定済みの意味論と根拠を引き継ぐ。
  暫定の起動データとツールは流用せず（禁止事項 13）、`handoff.boot_requirements` の起動の要件だけを、このスキルのデータの設計に取り込む
- `parity-suite`: フェーズ A の完了（`.replace/dataset/metadata.json` があること）が前提である。探索でシードの不足を見つけると、`gaps.md`「データ不足」でこのスキルに戻る。
  戻ると `version` が上がり、影響を受けるベースラインを再取得する
- `parity-replace`: フェーズ B の前提となる新側のスキーマを作る。自分が選んだ新側の target を渡して、`golden-dataset --phase b --feature <slug> --target <name>` として呼ぶ
- `parity-diff` / `replace-strategy status`: `metadata.json` の version の順序と `changes[].affects` を、slug が実際に参照するテーブルと照らし合わせて、古くなったことを検出する。
  フェーズ B の投入の状況は、`phase_b.<slug>.<target>` を target の単位で同じ判定にかける
