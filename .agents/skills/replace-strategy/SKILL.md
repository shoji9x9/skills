---
argument-hint: <setup | issues | status | evidence> [--feature <slug>...] [--endpoint <口> --evidence <根拠>]... [--autonomous]
description: 仕様を変えないアプリケーションリプレイスの起点。現行アプリを実測して戦略を決め、機能に分解して姉妹スキル群へ振り分ける（自分では実装しない）。setup（測定・戦略決定・機能インベントリ。受領資産からの再構築は current-environment-bootstrap、共通部品優先なら parity-component へ委譲）／issues（対象機能の GitHub Issue を起票。issue-create へ委譲）／status（Issue と成果物から現況と未検証領域を導出）／evidence（確定した API の要求単位の根拠を機能インベントリへ非破壊で書き戻す。parity 姉妹からの委譲先）の 4 モードを持つ。測定できない場合は停止する。「リプレイス戦略を立てて」「リプレイスを始めたい」「現行アプリを測定して」「要求単位を書き戻して」「replace-strategy」や、setup / issues / status / evidence を伴う依頼で発動する。
license: MIT
name: replace-strategy
---
# Replace Strategy

「仕様を変えずにアプリケーションをリプレイスする」作業の起点になるスキルである。
リプレイスは、現行の挙動を証拠として固定し、別の実装で再現し、差分がゼロであることを確かめるループで進める。
このスキルは、そのループの最初にある戦略の判断を、推測ではなく実測に基づいて行わせる。

このスキルは自分では実装しない。測定し、戦略を決めさせ、機能に分解し、姉妹スキルに振り分ける役割に徹する。

## 使い方

```text
replace-strategy setup [--autonomous]
replace-strategy issues [--feature <slug>...] [--autonomous]
replace-strategy status
replace-strategy evidence --feature <slug> (--endpoint <口> --evidence <根拠>)... [--autonomous]
```

| モード | 内容 | 実行のタイミング |
|---|---|---|
| `setup` | 依存の確認 → 現行環境の由来の確認 → 対話セットアップ → 現行環境の再構築（受領資産のときだけ） → 測定 → 戦略の決定 → レジストリの作成 → 機能インベントリ → 共通部品の依存の決定 → 静的資産の方針の決定 | 最初に 1 回 |
| `issues` | 対象の機能を選んで Issue を起票する。まだ起票していない機能だけが候補に出る | 何度でも |
| `status` | Issue の状態とリポジトリ内の成果物から現況を導き、未検証の領域の一覧を出す | 何度でも。切り替えを判断する前に |
| `evidence` | 確定した API の要求単位の根拠を、`.replace/features.md` の「要求単位の根拠」列に非破壊で書き戻す（`推定` → `実測`） | 口の要求単位を確定したとき。`parity-suite` / `parity-replace` から任されて呼ばれることもある |

- `issues` は `--feature <slug>...` で対象の機能を選べる。省くと、まだ起票していない機能から対話で選ぶ。
- `evidence` は `--feature` を 1 つだけ取り、`--endpoint` と `--evidence` を対で繰り返して、複数の口を一度に書き戻す。
  口を指定しない一括の昇格はできない。行に 1 つでも `実測` があると行全体が実測に見える、という問題を避けるためにこの列を作ったので、一括の昇格はその理由を失わせる。
- モードを指定しないときは、どのモードかをユーザーに確認する（`setup` が済んでいなければ `setup` を提案する）。
- `--autonomous` は、その実行だけを自律で進める宣言である（下の「自律実行」）。省くと、判断のたびに確認する。
- 自然文でも起動する。例: 「リプレイス戦略を立てて」「リプレイスを始めたい」「現行アプリを測定して」「要求単位を確定したので書き戻して」。

## 前提

- ツール: `gh`（GitHub CLI）、`git`
- 前提スキル:
  - `issue-create`（`issues` モードで起票を任せる先）
  - `browser-test`（現行アプリのブラウザ操作の作法）
  - `current-environment-bootstrap`（現行環境の由来が「受領資産からの再構築」のときだけ要る。任せる先で、下の「setup モード」の手順 2・4 で使う）
- MCP: chrome-devtools MCP（セマンティクスの測定に必須）
- 固定する技術スタック（スキル群で共通。ここに挙げたもの以外は固定しない）:
  - 新側のフロントエンドとバックエンド: TypeScript
  - パリティスイート: Playwright（TypeScript）
  - `golden-dataset` の投入ツール: TypeScript（SQL も使える）
  - テキストの成果物: Git
  - Issue・PR・任せる先: GitHub（`gh`）
- 利用者が選ぶもの（設定と references で受け取る。スキル本体に固有の名前を書かない）:
  - 新側アプリの骨格（下の項目）
  - 生成先のリポジトリのコーディング規約（生成物ごとに読む先が変わり、常に新側とは限らない）
  - 新しい UI コンポーネントライブラリと design token
  - 現行・新の DB と、その型・意味論の差
  - 検証コマンドの一式（静的解析・テスト。全体を対象にする `full` と、差分に限る `diff` の 2 列）
  - 実行対象の環境（`targets`）と、環境変数の用意の方法
  - 現行アプリのスタックは、測定で把握する。
- 新側のアーキテクチャは、このスキル群の対象外である。フレームワーク、バックエンドの構成、ORM、レイヤとディレクトリの構成、API の設計方針、ホスティングとリリースの構成、実行基盤と使うマネージドサービスがこれに当たる。
  - 言語は上のとおり TypeScript に固定で、骨格はその上での選択である。言語まで利用者が選べるという意味ではない。
  - 骨格は事前に決まっていて、新側のリポジトリには骨格がスキャフォールド済みである前提に立つ。
  - 骨格は現行アプリの測定からは決まらない（組織の制約・運用・既存の資産・人員で決まる）。スキルが決めると、「測定できなければ止まる」という規律が成り立たなくなる。
    そのため、`setup` は決定の確認と記録だけを行う（`new.stack` / `references.architecture`。原本は [`references/project-config.md`](references/project-config.md) の「新側アーキテクチャ」）。
- IaC と CI/CD のパイプラインは、スキル群の必須の要件ではない。
  - 新側は、`side: new` のローカルの target 1 つ（`start` と `check_urls` で起動と稼働を確かめられる環境）だけで、すべての工程が成り立つ。
  - 配信型の target（`develop` / `preview` など、デプロイで更新される環境）を `targets` に登録する場合にだけ、そのパイプラインが動いていることが前提になる（`commit_check` / `on_diff` はその環境のための任意のキー）。
  - パイプラインと IaC を新しく作ることは対象外（事前条件）である。区分の原本は [`references/scope.md`](references/scope.md)「スキルが行う作業の範囲」にある。

## 厳守の制約（禁止事項）

- 測定せずに戦略を語らない。測れない場合は、戦略に進まずに止まる。推測は「未測定」と明記する。
- 仕様の確認は、十分な証拠が得られる最もコストの低い方法から始める。
  - 調べる順は、実行ログと観測記録（選んだ現行 target から取得し、対象の版・採取の時点・条件を追跡できるもの）→ 現行のソースコード → API の実際の動作 → UI の実際の動作である。
  - 下位の証拠だけでは挙動を確定できない場合に限って、次に上げる。調査のコストは、実行ログと観測記録 < ソースコード < API の操作 < UI の操作の順に高くなるからである。
    必要な証拠が得られた時点で止め、API と UI の操作は、証拠が足りない場合だけ行う。
  - 設計書・仕様書・受領したログを含む受領資料は、調べる候補を挙げるのに使ってよいが、現行の挙動を確定する根拠にはしない。
  - UI に固有の表示と操作は UI で確定し、コストの低い方法で代用しない。
- 現行のテスト環境が無いまま、測定に進まない。
  - 現行環境の由来（`current.origin`）が「受領資産からの再構築」なら、`current-environment-bootstrap` の引き渡しが終わる（`.replace/bootstrap/metadata.json` の `status: handed-off`）まで、測定と戦略に進まない。
  - 再構築を自分で代わりに行わない。推測で建てた環境を正解の基準にすると、以降のすべての比較がその誤りを追認する。
- LLM に「差分があるか」を聞かない。差分の検出は決定論的なツールが行い、LLM は分類（要対応／許容／環境ノイズ）を行う。
- モデルの主観（「同じに見えます」）を、収束の根拠にしない。収束の判定は決定論的なツールが行う。
- 振る舞いを保つことと品質を改善することを、同じフェーズで狙わない。忠実な移植は、良い性質も悪い性質も同じように運ぶ。
- id と name を比較のアンカーにしない。原則は role とアクセシブルネームである。
- カタログサイトと部品のベンダーの機能一覧を、比較の正解にしない。
  どちらも「確かめるべき状態を網羅したリスト」を作る材料であり、正解は動いている現行アプリである。
- 現行アプリを変更しない。
  比較のために現行アプリのコードの変更（ログの挿入・SMTP の迂回・プロキシの挿入など）が必要なもの、または比較そのものが現実的でないものは、スコープ外とする。
  それらは `gaps` に「手動検証が必要」として記録する（確認済みにしない）。
- 対応する範囲を推測で決めない。また、一覧を各所に転記しない。
  - 対象・対象外・条件付きの一覧の原本は [`references/scope.md`](references/scope.md) で、各スキルと各 references は実行時の行動だけを持つ。
  - `references/scope.md` は、比較・検証の範囲（現・新を比べて合否を出すか）と、スキルが行う作業の範囲（スキルが行うか、事前条件か）の 2 つの一覧を持つ。軸が違うので混同しない。
  - 判断に迷ったら、`references/scope.md` を読んで確かめる。読めない環境では、対象外と決めつけずに、`gaps` に未検証として残す。
- 依存の判断の基準を、リポジトリに無い方針があることを前提に組まない。
  ライセンスの拒否リスト、供給網のポリシー、バンドルサイズの上限などは、あればそれに従い、無ければ方針の要否をユーザーに確認する。スキルのデフォルトの拒否リスト・閾値・待機の日数を持ち込まない。
- シークレットの値を、ログ・標準出力・成果物・設定ファイルに出さない。
  設定ファイルには環境変数の名前だけを持つ。ユーザーが値を示してきた場合も、それを繰り返さない（コマンドの例にも埋め込まず、環境変数の名前で置き換える）。

## プロジェクト設定の解決

次のものは、リポジトリごとに異なる。現・新のリポジトリ、実行対象の環境（`targets`。環境の名前で複数定義し、`--target` で選ぶ）、DB の接続の環境変数の名前、成果物の保存の方針、意図的差異レジストリ、references（利用者が選ぶ知識の注入）である。
設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` のスキーマと解決の手順は、[`references/project-config.md`](references/project-config.md) にある。

設定は対象のプロジェクトに 1 つで、すべてのスキルが読める。そのため、下流のスキル（姉妹スキル）はこのキーを直接読む（転記しない）。

## 自律実行（`--autonomous`）

置換系のスキル群に共通する自律性ポリシーの原本は [`references/autonomy.md`](references/autonomy.md) である（宣言の仕方・越えない線・停止の 2 分類・保留の記録の形・終わりにまとめて聞く手順）。
姉妹スキルは、それぞれの「自律実行」の節で、そのスキルに固有の対応だけを持ち、`references/autonomy.md` を参照する。このスキルに固有の対応は次のとおりである。

- 判断待ち（保留に落とす）にするもの:
  - `setup` の対話セットアップ（手順 3）で人が決める値
  - 戦略の承認（手順 6）
  - 現行の弱点の仕分け（手順 8）
  - ページ要素の帰属の確定（手順 9）
  - 依存の方針の要否と、共通部品の採否（手順 10）
  - 静的資産の方針と、「同等物を作る」の宣言の承認（手順 11）
  - `issues` モードの起票の承認と、抜けた行・抜けたつながりを埋めるための既存の Issue の本文への追記の承認
- 保留に落とさないもの:
  - 手順 10 の洗い出しで確かめられなかった種類（禁止された操作でしか状態を作れない、または自律実行では書き込みを伴う手段を使わないため）は、`.replace/dependencies.md` の `未確認` の行として残し、件数と内訳を最終報告に並べる。
  - 引き取り手（その部品が要る機能の `parity-replace`）が別にあるので、この種類が残っていても `setup` は完了できる。
    線引きの原本は [`references/autonomy.md`](references/autonomy.md)「保留に落とすか、成果物の値として残すか」である。
  - 採否そのものの承認は、上のとおり保留に落とす。
- 依存関係:
  - 手順 3 の値のうち、設定に無い項目に依存する工程は止める（例: `targets` が未確定なら、測定も止まる）。
  - 手順 6 が保留なら、`.replace/strategy.md` を確定しない。戦略に依存しない測定（手順 5）と、機能インベントリの下書き（手順 9）は進める。
- `issues` モードは起票しない（`issue-create` に任せるのは越えない線に当たる）。
  - 候補・依存関係・本文の下書きを作って保留に記録し、最後にまとめて承認を聞く。承認が得られたら、同じ実行で 1 件ずつ任せる。
  - 既存の Issue の本文の編集も越えない線なので、突き合わせで見つけた抜けた行・抜けたつながりの追記案も同じに扱う。
    追記する番号と差分を保留に記録し（`blocks` にその行の着手を挙げる）、承認が得られたら同じ実行で反映する。
  - 突き合わせそのもの（本文の取得と差分）は読み取りなので保留にせず進め、結果を「受け入れ条件」列に書き戻す。
- 記録先: `.replace/strategy-pending.json`（テンプレート: [`assets/strategy-pending-template.json`](assets/strategy-pending-template.json)）
- `setup` の保留が残る間は、`.replace/features.md` / `.replace/components.md` を作らない。下流はこの 2 つがあることを、`setup` が済んだとみなすからである。
  - 機能インベントリと部品インベントリは、`.replace/features.draft.md` / `.replace/components.draft.md` に下書きし、答えを反映したら正規の名前に移す。
  - 部品インベントリの下書きは、共通部品を画面より先に作る方針が採用されたときだけ移し、採用されなければ削除する（原本の「完了の証拠になる成果物には書かない」）。
- `setup` から `current-environment-bootstrap` に任せるときは、`--autonomous` を引き継ぐ。

## setup モード

依存の確認 → 現行環境の由来の確認 → 対話セットアップ → 現行環境の再構築（必要なときだけ）→ 測定 → 戦略の決定 → レジストリの作成 → 機能インベントリ → 共通部品の依存の決定 → 静的資産の方針の決定、の順に進める。

1. 依存の確認
   - 前提スキル（`issue-create` / `browser-test`）がインストールされているかと、chrome-devtools MCP が有効かを確かめる。
   - 入っていない・無効なら、導入の手順（`gh skill install shoji9x9/skills <name>`、MCP の設定）を示す。
   - MCP が無いままでは測定できないので、手順を示したうえで止まる。
2. 現行環境の由来の確認
   - 測定の対象になる現行のテスト環境が次のどちらかを確かめ、`current.origin` に記録する（意味の原本は [`references/project-config.md`](references/project-config.md) の「現行環境の由来」）。
   - 由来を推測で決めない。現行アプリの URL を設定に書けることは、その環境が動いている証拠ではない。
   - `managed`（既存の管理済みのテスト環境）: 自社で管理している、動く環境がある。手順 4 は行わない。
   - `received-assets`（受領資産から自社で再構築する）: 先方から受け取った資産だけがあり、比較の基準になる環境をこれから建てる。
     - 受領資産の置き場所を `current.received_assets`（1 つ以上のパス）に記録し、ここで `current-environment-bootstrap` がインストールされているかを確かめる。
     - 入っていなければ `gh skill install shoji9x9/skills current-environment-bootstrap` を示して止まる。再構築を代わりに行わない。
3. 対話セットアップ
   - 次のことを対話で確かめて、設定ファイルに保存する。技術スタックはスキル本体に書かず、設定で受け取る。
   - シークレットの扱いは、[`references/project-config.md`](references/project-config.md) の「シークレットの扱い」に従う。接続を最初に確かめ、つながらなければ早い段階で失敗にする。
   - 現・新のリポジトリと、起動のラッパー。
   - 新側のアーキテクチャの確認と記録:
     - 事前に決まっている骨格を確かめ、スタックの列挙を `new.stack` に、決定を記録したドキュメントのパスを `references.architecture` に記録する。
     - 骨格を決めず、下書きも作らない。決まっていなければ決定を促し、`references.architecture` は空の値の枠だけを残す。原本は [`references/project-config.md`](references/project-config.md) の「新側アーキテクチャ」である。
   - 実行対象の環境（`targets`）:
     - 現側は測定の対象のテスト環境、新側は local-dev / develop などである。
     - 環境ごとに、次のキーを確かめる。
       - `side`（必須）
       - `url`。URL が実行ごとに決まる環境では、`url` の代わりに `url_command` を使う。
       - `api_url`（UI と API が別の origin のときだけ）
       - DB（環境変数の名前と、投入してよいかを表す `seedable`）
       - 認証（ロールごとの環境変数の名前だけ）
       - 禁止操作
       - `pre_commands` / `start` / `check_urls`
       - `commit_check`（`start` を持たない配信型の環境で、動いているコミットを確かめるコマンド）
       - 側ごとの `default`（`current` / `new` で 1 つずつ）
       - `on_diff`
     - スキーマの不変条件は [`references/project-config.md`](references/project-config.md)「実行対象環境」、選び方の規則は同じ節の「選択規則」に従う。
     - 先に、「新側はローカルだけで始めるか、配信型の環境（`develop` / `preview` など）も使うか」を確かめる。
       ローカルだけなら、`commit_check` / `on_diff` は確かめず、配信型の環境が求める CI/CD のパイプラインの前提も当たらない（前提の条件は上の「前提」）。
       配信型の環境は後から足せるので、この時点で無理に決めさせない。
   - ゴールデンデータセットの実体（`dataset_mode`）:
     - DB なら `db`（デフォルト）、リポジトリ内の静的なデータなら `static` を選ぶ。`static` では、投入ツールが作って消してよい `dataset_static_paths` を確定する。
     - `seedable` と `dataset_static_paths` は、設定による投入の制限である。デフォルトでは許可しない（書かなければ投入されない）。
       実データを持つ環境は、`seedable` を付けずに読み取り専用として登録する。原本は [`references/project-config.md`](references/project-config.md) の「データセットの実体」である。
   - ファイルストレージ（`uses_storage` / `targets[].storage`）:
     - アップロード先とファイルの出力先のストレージを使うかを確かめる。これは `dataset_mode` とは独立した別の軸なので、`dataset_mode` に 3 つ目の値を足さない。
     - 使うなら、環境ごとに、接続の環境変数の名前・書き込みの範囲（パス、または `<bucket>/<prefix>`）・アップロードの方式（`direct` / `presigned`）を確かめる。
     - 投入の制限（`storage.seedable`）はデフォルトで許可しない。ストレージの実体へのゴールデンデータの投入は、スコープ外である。
       宣言だけを残し、ストレージに依存する検証は `gaps` に未検証として記録させる。原本は [`references/project-config.md`](references/project-config.md) の「ファイルストレージ」である。
   - 検証コマンド（`verification_commands`）:
     - 完了の前に実行する静的解析とテストなどを、実行する範囲で `full`（全体を対象にする）と `diff`（変更したファイルだけ）の 2 列に分けて確定する。
       環境の準備と起動は含めない（それらは target の `pre_commands` / `start` に書く）。
     - `full` は `parity-replace` の完了判定に必須なので、無いままにしない。
     - `full` は、生成先のリポジトリの必須の CI から導く。
       - 対象のブランチで有効な ruleset は、`gh api --paginate` ですべてのページ・すべての rule type を取得する。classic branch protection も読む。
       - 必須の status check と、ruleset の必須の workflow を、抜けなく棚卸しする。
       - workflow の job と、その job が呼ぶ script / reusable workflow の実行コマンドまでたどって突き合わせる。
         次のどれかに当たるなら、確定しない。取得できない。強制される未知の rule がある。対応が分からない。説明の無い差がある。
       - status check の context は、文字列から job の名前を推測しない。実在する PR / commit の check run の `name` から、workflow と job にたどる。
         同じ名前の job、matrix の展開、check run がまだ作られていない、などで 1 つに対応づけられなければ確定しない。
       - 推奨は、必須の CI の job と `full` が、同じリポジトリ内にある全体を検証する 1 本のコマンドを呼ぶ形である。
         まとめられない場合は、必須の CI と `full` の対応と、対象外の理由を記録する。どちらかを変えたら失敗する、プロジェクト側のずれのチェックを、必須の CI に含める。
         setup の時点の目視の比較だけでは、その後の CI の変更を検出できないので、完了にしない。
       - 詳細は [`references/project-config.md`](references/project-config.md)「必須 CI との整合」にある。
     - `full` は、フックの設定を見るだけで埋めない。
       コミットの前のフックが、同じツールを差分に限って実行していることは多い。スクリプト側が引数をどう使うかまで読まないと、全体を対象にしているかは判別できない。
       判別できないコマンドは、全体を対象にする起動の形をここで確かめる。全体を対象にする起動の形が無いツールは `full` に入れず、未チェックとして `.replace/strategy.md` の「未検証領域の扱い」に記録する。
     - どちらの列にも、auto-fix 付きの起動の形（フォーマッタの書き込みモード、リンタの `--fix`）を置かない。対象を警告なしに直したうえで必ず成功するので、チェックにならない。
       差分があれば 0 以外で終わるチェックの形を確かめる。チェックの形かどうかは、1 回通した後に作業ツリーの差分が増えないことを実測して確かめる（`--check` の有無では判断しない）。
       詳細は [`references/project-config.md`](references/project-config.md) の、`full` と `diff` の範囲を書いた節にある。
     - `golden-dataset` の投入ツール（`dataset_tool_dir`）と `parity-suite` のスイート（`parity_suite_dir`）も、この列で検証される。
       そのため、それらのパスをチェックの対象に含めるかを、ここでユーザーに確かめる。
       含めない選択もできる。ただし、下流は範囲を勝手に広げず「含まれていない」と記録するだけなので、ここで決めないと、ずっと未チェックのままになる。
   - 規約の機械的なチェックの仕分け:
     - `references.coding_conventions` の規約の項目を、`verification_commands.full` で失敗になるものと、失敗にならないものに分け、未チェックの項目を記録する。
     - 判定は「規約に対応するルールの設定があるか」ではなく、「その規約を破った入力が `full` で失敗するか」で行う。
     - 未チェックのままだと、規約に従ったつもりの箇所が、`parity-replace` の敵対的レビューやユーザーの指摘で初めて見つかる。そして、機能ごとに「指摘を受けてからチェックを足す」を繰り返す。
     - ルールやフォーマッタの設定で表せる項目は、ここで整備を促し、足したチェックは `full` に載せる。
       残った未チェックの項目は、`.replace/strategy.md` の「未検証領域の扱い」に記録する（`parity-replace` の敵対的レビューが、人が見る観点として使う）。
       原本は [`references/project-config.md`](references/project-config.md)「コーディング規約」である。
   - `on_diff` のドキュメント: 内容はプロジェクトが持つものだが、`references` と同じく、`setup` が下書きを作り、人がレビューして確定する（デフォルトの挙動で足りる環境には作らない）。
   - `references`（知識の注入）:
     - パス型のキー（`architecture` / `coding_conventions` / `ui_library` / `db_semantics` / `env_setup`）を、キーごとに作る。
       この時点でパスが決まらないキーも省かずに空の値で置き、「どのスキルがいつ読むか」をコメントで添える。
     - 整備されていないことで下流が止まるのは、正しい挙動である。枠を作るのは、止まるのを避けるためではなく、不足を `setup` の時点で見えるようにするためである。
       キーごと無いと、下流のスキルが止まって初めて不足が分かる。
     - `dependency_policy` だけは、空の値で作らない。キーの有無そのものが「未確認」を表す三値なので、空の値の枠を置くと、下流の確認が始まらなくなる。
       手順 10 の確認の結果としてパスか `none` を書き、確認まで進まなければキーごと書かない。
       原本は [`references/project-config.md`](references/project-config.md) の「references（知識の注入）」である。
4. 現行環境の再構築（`current.origin: received-assets` のときだけ）
   - `current-environment-bootstrap` に任せる。
   - 引き渡しが終わる（`.replace/bootstrap/metadata.json` の `status: handed-off`）まで、測定に進まない。
     `blocked` なら、質問票の回答と追加の資産を待ち、`--resume` での再開を案内して止まる。
   - 引き渡しの後は、再構築された target が、測定と特性化の対象になる。
   - `managed` の場合は、この手順を飛ばす。
5. 測定
   - すべて実測する。手順は [`references/measurement.md`](references/measurement.md) にある。
   - 測るものは次のとおりである。
     - セマンティクス（同梱の [`scripts/role-probe.mjs`](scripts/role-probe.mjs) を使う）
     - DB を復元できるか
     - 現行のコードを入手できるか
     - 副作用の棚卸し
     - ファイルの入出力の到達性（画面駆動の捕捉ができるか、バッチの出力がファイルシステムに届くか、ストレージ）
     - 既存のテストの評価
     - 横断の応答ヘッダー
   - 結果は `.replace/survey.md` に記録する（横断の応答ヘッダーの一覧だけは `.replace/response-headers.json`）。
   - 測れない場合は、ここで止まる。止まる条件は [`references/measurement.md`](references/measurement.md)「停止条件」にある。横断の応答ヘッダーを採れないことは止まる条件ではなく、未測定として `gaps` に回す。
   - 応答ヘッダーは、機能ごとの工程のどこでも採らない。
     サーバーやリバースプロキシの設定がすべての応答に付ける防御のヘッダーは、画面の処理にも API の定義にも現れない。新側が付けなくても、すべての工程が緑のまま、安全性だけが下がる。
     画面・API・静的ファイル・エラーの応答を 1 度だけ採り、アプリのコードの外で付くものを `.replace/response-headers.json` に一覧にする。
     `survey.md` の表にはしない。原本は [`references/security.md`](references/security.md)「横断の応答ヘッダー」である。
6. 戦略の提示とユーザーの承認
   - 測定の結果から、次のことを示し、承認を得て `.replace/strategy.md` に記録する。
     - パリティスイートの戦略
     - ゴールデンデータセットの作り方
     - フロントとバックの非対称な設計（バックエンドは現行のコードから直接移植し、フロントエンドはパリティスイートとベースラインで進める）
     - 未検証の領域の扱い
7. 成果物の扱いの決定（設定ファイルへ）
   - 保持の方針（作業ツリーは最新のものだけを持ち、履歴は Git が持つ）を決める。
   - 保存先は `local`（デフォルト、コミットしない）／`git`／`git-lfs` に限る。それ以外の外部の保管は対象外で、選ぶ場合はポインタの記録だけを残し、検証しないことを明記する。
   - 容量の閾値を決める。
   - ここで決めるのはデフォルトの値で、機能ごとに上書きできる。
8. 意図的差異レジストリの作成（設定ファイルへ）
   - 「変えない」「変えてよい」「保留（測定の結果で決める）」の 3 つに分類する。
   - references（`ui_library` / `db_semantics`）から入る差（例: 空文字と NULL の扱い、collation による並び順）も、レジストリに入れる。
   - references の下書き（`architecture` を除く）は、DDL・測定の結果・技術スタックから作り、人がレビューして確定する。
   - `db_semantics` の下書き:
     - 移植のときの点検の項目（NULL の並び順・暗黙の型変換と失敗したときの値・照合順序・連結のときの NULL・書式のロケールへの依存）を節として立て、現行の DB と新しい DB のデフォルトを埋める形にする。
     - このキーは、`parity-replace` が実装の前に読む点検の表でもある。節が無い項目は、「差が無い」ではなく「誰も見ていない」になる。
       原本は [`references/project-config.md`](references/project-config.md) の「DB 意味論」である。
   - 「保留（測定の結果で決める）」にした項目は、`intentional_diffs.pending` に 4 キーの形で書く。
     - `item` に照合のキーの文言、`added_by: replace-strategy`、`added_at` に追記した日を書く。
     - `slug` は `cross-cutting` にする。機能の slug は次の手順 9 で採番するので、この時点では書ける機能の slug が無い。
     - 書く前に既存の `pending` を読み、同じ `item` の要素があれば追記しない。
       `setup` の再実行（`--resume` を含む）で同じ文言が 2 件になると、`pending-triage-check.mjs` が「同じ文言が複数ある」として失敗にする。
       重複を消すのは既存の値の削除なので、追記専用のチェックにも当たる（どちらの取り決めにも反せずに直すことはできない）。
     - 次の書き方は、どれも帰属が分からないと判定され、すべての機能の棚卸しに出続ける。`added_by` を空にする。`unknown` と書く。採番の前の slug を推測で書く。
       チェックは `parity-diff` の `pending-triage-check.mjs` が行う。要素の形の原本は [`references/project-config.md`](references/project-config.md) の「`pending` 要素の形」である。
   - 現行の振る舞いに含まれるセキュリティ上の弱点を挙げ、「直す（`may_change`）」か「そのまま移す（`keep`）」に仕分けて、`.replace/weaknesses.md` に記録する。
     - スイートも敵対的レビューも、「現行と一致しているか」を見る。そのため、現行と同じ弱点はどの工程にも指摘されず、新側にそのまま移る。
     - 挙げる起点は、OWASP Top 10 の 1 つの版に固定する。
     - 次の 3 つの基準を、すべて満たすものだけを直す。
       - 権限の無い人が届くか、誘導するだけで成り立つ。
       - 影響が、他の利用者のブラウザでのスクリプトの実行か、許可の無い書き込みである。
       - 直しても、正規の使い方での振る舞いが変わらない。
     - 直すと仕様そのものが変わるもの（認可の欠落など）は、そのまま移し、扱うための設計の作業を記録する。
     - 仕分けは人が決める。手順・基準・宣言の原本は [`references/security.md`](references/security.md)「現行の弱点の仕分け」である。
9. 機能インベントリ
   - 現行アプリを機能の単位に分解し、各機能のページ・API・テーブル・副作用の出力、横断 API の fan-out と参照するテーブル、slug を `.replace/features.md` に記録する。
   - 機能は、画面の中の表示のセクションではなく、利用者の目的・データの境界・依存関係・副作用の持ち主で分解する（複数のページにまたがる機能は 1 行にする）。
   - API の口を書く前に、その口の要求単位を現行のソースコードから読み、根拠を「要求単位の根拠」列に口ごとに `実測` / `推定` で記録する。
     - 読む場所は、口の向きで変わる。読み取りの口は、起点の問い合わせと、応答への対応づけを読む。書き込みの口は、要求の組み立てと、ハンドラの受け取りと、トランザクションの境界を読む。
     - どちらの向きでも、操作が共通部品を通るなら、部品の内側を送信・実行の直前まで読む。
       送る前の判定（上限・必須・形式）と、表への書き込み（監査・利用ログ。例外処理の中を含む）は、画面の処理にも部品に渡す引数にも現れない。
       見つけた書き込み先の表は、副作用の出力に書く。規則は [`references/features-issues.md`](references/features-issues.md) にある。
     - 採番はここで 1 回だけ行い、画面の特性化（`parity-suite`）はそれより後になる。そのため、この列は、まだ 1 度も測っていない画面についても埋まる。
     - 行に 1 つだけ書かない。1 行が複数の口を持ち、根拠が分かれることはよくある。1 つでも実測があると行全体が実測に見え、未確定の口が `status` から抜ける。
     - ソースが読めないときだけ、証拠の階段を上げる。API や UI の実際の動作で確定したものも、`実測` として記録してよい。
       ソースで足りるなら、観測は求めない。観測していない部分を、推測で補わない。
     - 同じ表や同じ主キーを触ることは、要求の単位が同じであることの根拠にならない。規則は [`references/features-issues.md`](references/features-issues.md) にある。
   - あわせて、ページ一覧（ページ × そのページに乗る機能）を記録する。
     機能の単位に分けたことの裏返しとして、同じページに乗る別の機能のセクションが丸ごと欠けても、どのスイートも赤くならない。
     `parity-suite` は、このページ一覧を、ページに部品があるかのチェックの根拠に使う。規則は [`references/features-issues.md`](references/features-issues.md) にある。
   - ページ一覧を書いたら、そのページの見える要素が、抜けなくどれかの slug に帰属しているかを確かめる。
     どの機能の行のセクションにも収まらない要素は、「ページ要素の帰属」表に記録して、配置の持ち主を決める。
     - 機能一覧が持ち主を持つのは、テーブル・API・副作用の出力だけである。スコープ外と決めた要素にも場所を占めるものがあり、誰も配置しなければ、実装した後の `parity-diff` まで「説明できない差分」として現れない。
     - 帰属の無い要素が残るなら、候補の slug を添えて着手の前にユーザーに確認する。確定するまで、持ち主は空欄のまま残す（暫定値で埋めない）。
       規則は [`references/features-issues.md`](references/features-issues.md) にある。
   - `.replace/response-headers.json` の 2 つの slug も、採番の後に同じく候補を添えて確認し、書き戻す。
     1 つは持ち主の slug（`owner_slug`。どの機能にも属さない静的ファイルと 404 の応答）、もう 1 つは新側のサーバーの設定の作業を引き受ける slug（`server_config_slug`）である。測定の時点では slug が無いので、`null` で残っている。原本は [`references/security.md`](references/security.md)「横断の応答ヘッダー」である。
   - 4 種（ゴールデンデータセット／横断 API／機能／バッチ）に当てはめられない作業（例: テーブルをまたぐ新側のスキーマの前倒しの設計）は、「その他の Issue（4 種以外）」表に置く。
     記録先が無いことを理由に、ヘッダに独自の項目を足したり、記録をあきらめたりしない。
   - `current.origin: received-assets` の場合は、採番した slug を `.replace/bootstrap/semantics.md` の「対象機能」列に非破壊で書き戻す。
     このファイルは `.replace/features.md` が無い時点で書かれるので、機能の呼び名しか持てない。書き戻さないと、`golden-dataset` / `parity-suite` が、確認待ちの意味論を slug で探せない。
     原本は `current-environment-bootstrap` の `references/data-semantics.md` である。
10. 共通部品の依存の決定
    - 複数の機能で使う部品を洗い出し、自前で書くか、どのパッケージを使うかを、実装が始まる前に決めて `.replace/dependencies.md` に記録する。
      部品は、UI ライブラリ・フォント・状態管理・日付の処理などの基盤と、ボタン・セレクト・モーダルダイアログなどの個々の UI プリミティブの両方を含む。
    - 判断の材料・確かめる手段・決める順は [`references/dependency-selection.md`](references/dependency-selection.md) にある。
    - 洗い出しは、同じファイルの「洗い出しの網羅（共通 UI プリミティブ）」の種類を、1 つずつページで確かめて行う。
      - 確かめた種類は、どれも台帳の行として残す。採否に至らない結果にも値がある（`該当なし` / `内蔵` / `機能固有` / `未確認`）ので、行を作らない扱いは設けない。
        値の意味・書く工程と読む工程・覆したときの記録の方法の原本は、同じファイルの「洗い出しの 6 値」である。初期表示に出ない種類の扱いは「洗い出しの網羅」の節にある。
      - 確かめられなかった種類を、`該当なし` として扱わない（`未確認` の行にし、理由と、確かめるのに要る条件を書く）。
      - 基盤の種類（UI ライブラリ・フォント・状態管理・日付の処理）だけを手がかりにすると、ライブラリの外にある個々の UI プリミティブ（セレクト・ページネーション・トーストの通知など）が抜ける。
    - ライセンスの方針と供給網のポリシーがあるかは、リポジトリごとに違う。あればそれに従い、確かめていなければ、方針の要否そのものをユーザーに確認し、結果を設定（`references.dependency_policy`）に記録する。
      `none`（確認済みで方針なし）なら、確認し直さない。
    - 機能に固有の部品は、`parity-replace` が実装のフェーズの前に、同じ基準で決める（ここですべてを洗い出そうとしない）。
    - 共通の UI 部品を画面より先に作る方針を採るかを、ここで確かめる。採るなら、`.replace/components.md` に部品インベントリを作る（テンプレート: [`assets/components-template.md`](assets/components-template.md)）。
      - 採否だけを記録して終えると、部品を実装する側は、「現行のどこを測れば実装の正解が分かるか」を自分で探すことになる。
        `dependencies.md` は採否の記録で、測定の対象の一覧ではない。`parity-suite` の網羅表はページができてから作られるので、部品を先に作る時点では、どちらも対象を持たない。
      - インベントリには、部品ごとに slug・インスタンス（ページと、その部品を指す論理名）・データへの依存の有無・採否を書く。
      - ページ一覧は候補を挙げる材料であって、インスタンスそのものではない。
        ページ一覧が持つのはページのパスと機能の slug だけで、部品の論理名は入っていない。`/orders/:id` のようなパターンは、現行の target で開ける URL ではない。
      - 手順 9 のページ一覧を候補に、現行アプリを実際に開いて確かめる。その部品を role とアクセシブルネームで 1 つに特定できる論理名を確かめる。
        パラメータ付きのページは、具体的な URL か、その値を決める規則（どのデータから採るか）をインベントリに残す。
        `parity-component` の採取は、到達できる URL と、1 つに特定できる論理名を前提にする。ここを埋めないと、採取する側が推測するか、採取を飛ばすことになる。
      - インスタンスが 1 件しか無い部品は、先に作る対象にしない。固定の値と可変の値を区別できないからである。
        「先に作らない部品」表に理由を付けて置き、その機能を実装するときに `parity-replace` が作る。
      - 採取・実装・照合は `parity-component` が行う。ここでは対象と slug を確定するだけで、見た目の採取は行わない。
      - あわせて、部品カタログの実体（1 インスタンス × 1 状態を、固定の URL で描画できる場所）を確かめる。
        取り決めのドキュメントのパスは、`references.component_catalog` に記録する。
        カタログの baseURL は、`side: new` の target の `catalog_url`（固定の文字列）か `catalog_url_command`（実行ごとに変わる環境。2 つは同時に書けない）に記録する。
        確定しなければ枠だけを残し、`parity-component build` に入る前に確定させる。
    - 画面より先に作らない方針なら、`.replace/components.md` は作らない（機能ごとに `parity-replace` が部品も作る）。
11. 移行元の静的資産の方針の決定
    - 移行元が配信している画像・アイコン・favicon・ロゴ・図・書体を、新側で実体をコピーするかを、実装が始まる前に、種類ごとにまとめて決めて `.replace/assets.md` に記録する。
      テンプレートは [`assets/assets-template.md`](assets/assets-template.md)、棚卸し・判断・記録の原本は [`references/static-assets.md`](references/static-assets.md) である。
    - 手順 10 の依存とは別に決める。
      依存は「自前か、どのパッケージか」で、資産は移行元の配信物そのものである。依存の選定の表に「本文フォント」の行があっても、アイコン用の書体や画像を移すかは決まっていない。
      決めないと、各機能の `parity-replace` が、実装の順に 1 つずつ決めることになり、同じ種類の資産に逆向きの判断が付く。
    - 棚卸しの起点は 2 つある。配信物と受領資産の中のファイルと、現行の画面が実際に描いているものである。
      後者は同梱の [`scripts/asset-probe.mjs`](scripts/asset-probe.mjs) で調べる。`img` だけでなく、疑似要素の `content`・`background-image`・`document.fonts` を同じ走査で読む。
      `display: none` の `img` を、「出ないからコピーしない」と決めない。同じ場所を、疑似要素のグリフが描いていることがある。
    - 3 つの選択肢（実体をコピーする／同等物を作る／コピーしない）は、人が決める。
      「本文の書体」と「アイコン用の書体」は、別の行にする。再配布してよいか・出どころ・残る差を、推測で埋めない。
    - 「同等物を作る」を選んだら、残る差を、ユーザーの承認のうえでこの時点で `intentional_diffs.may_change` に宣言する。
      ラスタライズの差は実装で消せないので、宣言が無いと、説明の付かない差として現れる。
      宣言しても、画素の比較で吸収するには `parity-diff` のインスタンス例外が要るので、往復が無くなるわけではない。

## issues モード

`.replace/features.md` のまだ起票していない機能・横断 API リソース・バッチと、`.replace/components.md` のまだ起票していない部品から対象を選び、Issue を起票して、Issue の番号をインベントリに書き戻す。
手順・Issue の種類・本文の構成は [`references/features-issues.md`](references/features-issues.md) にある。
Issue の種類は 6 つある。ゴールデンデータセット／横断 API／機能／バッチの 4 種と、4 種に当てはめられない作業のための「その他 Issue」と、`.replace/components.md` にある共通部品の Issue である。

- `.replace/features.md` が無い（`setup` が済んでいない）場合は、起票せずに止まり、`setup` の実行を促す。
- `.replace/components.md` が無いのは、未完了ではない。共通部品を画面より先に作らない方針では作られないファイルなので、無ければ共通部品の Issue を候補に出さないだけでよい（`setup` の再実行を促さない）。
- 共通部品の Issue の書き戻し先は、`.replace/components.md` の「部品一覧」表の Issue 列である（`.replace/features.md` ではない）。更新は、同じく非破壊にする。
- `.replace/features.md` の更新は非破壊にする。
  テンプレートは、最初に作るときのひな形であって、更新のときの項目の上限ではない。
  変える行と列だけを書き換え、テンプレートに無いヘッダの項目・節・列・行を、書き直しで消さない。
  4 種に当てはまらない Issue は、「その他の Issue（4 種以外）」表に置く（原本は [`references/features-issues.md`](references/features-issues.md)）。
- 起票は `issue-create` スキルに任せる。
  候補・依存関係・各 Issue の本文の下書きを示し、明示的な承認を得てから、1 件ずつ任せる。
  `issue-create` は 1 件ずつ承認を得る設計なので、このモードで先にまとめて承認を得る。
- 同じページに乗る機能は、ページ一覧からまとめて、続けて進める順を提案する。
  着手の前に、slug ごとの再実行の回数・まとめた合計・最後にマスクが外れる全面の比較を示す。実際の依存を逆にしない。数え方は [`references/features-issues.md`](references/features-issues.md) にある。
- 明示的な承認が得られない場合（利用者がいない非対話の実行・応答なし・承認以外の応答）は、起票せずに止まる。`gh issue create` も、`issue-create` に任せることもしない。
  `--autonomous` の実行では、下書きを保留に記録してから終える（上の「自律実行」）。
- 起票したら、インベントリのすべての行と、Issue の受け入れ条件を突き合わせる。
  - どの行を引き受けたかの原本は Issue の本文の受け入れ条件で、Issue 列が埋まっていることはその根拠にならない。
  - 同じ段で、次の 3 つを見る。
    - 母集合（すべての行の slug）と、引き受けた集合（各 Issue の受け入れ条件が引き受けていると読める slug）の差分で、抜けた行を見る。
    - 行が持つ部分（機能の行はページと、新しく実装する API の口と、比べる対象の副作用の出力）の集合の差分で、抜けた部分を見る。
    - 横断 API の fan-out が、使う側の受け入れ条件まで届いているかで、抜けたつながりを見る。
  - 起票の単位は行で、ページ単位の分割は Issue の中のフェーズである。重複して引き受けられた行は、部分ごとの対応を確かめてから 1 つに確定させる。
  - 結果は、各表の「受け入れ条件」列に書き戻す（`未対応` と、空欄＝まだ突き合わせていない、を書き分ける）。
  - 既存の Issue の本文への追記は外向きの副作用なので、承認を得てから行う（原本は [`references/features-issues.md`](references/features-issues.md)）。
- 重複のチェックでは、ページネーションに気をつける（デフォルトの件数で打ち切らない）。

## status モード

自分では状態を持たず、GitHub Issue の状態と、リポジトリ内の成果物から、毎回導く。ブランチをマージした後でも動くようにするためである。手順は [`references/status.md`](references/status.md) にある。

- `.replace/features.md` が無ければ、`setup` をまだ実行していないと報告し、`setup` の実行を案内する。
  その前に、`setup` の自律実行が残した未解決の保留を報告する（[`references/status.md`](references/status.md)）。
- Issue の状態は、features.md に記録された番号ごとに取得する。番号を列挙できない取得では、ページネーションを処理する（指定した件数で打ち切らない）。
- 状態の根拠は、トラッカーへの問い合わせだけである。
  features.md は番号だけを持つ（古い版のテンプレートから来た「状態」列があっても読まない）。
  取得できなかった番号は `判定不能` として示し、open と closed のどちらとしても扱わない。
- 機能ごとに、パリティスイートの有無・強度・データセットの版が古くなっていないか・未検証の領域（`gaps`）を導く。
- 横断 API に変更があった場合の影響の範囲（使う側の機能の一覧）を、fan-out から導く。
- 確かめる軸を足した変更より前に特性化を終えた機能を、「旧手順で閉じた機能」として列挙する（Issue が closed でも、`parity-diff` が収束済みでも出す）。
  導くのは同梱の [`scripts/procedure-staleness-check.mjs`](scripts/procedure-staleness-check.mjs) で、原本は [`references/procedure-changes.md`](references/procedure-changes.md) である。
- 各成果物の未解決の保留（`pending_decisions[]`）を集め、「判断待ち」として報告する（記録の形の原本は [`references/autonomy.md`](references/autonomy.md)）。
- 「その他の Issue（4 種以外）」表の各行は、Issue の状態と、依存の順と、影響の範囲を報告する。
  `.replace/parity/<slug>/` の成果物を持たないので、スイートの強度・ベースライン・フェーズ B・差分は「対象外」として、未着手と区別する。

## evidence モード

確定した API の要求単位の根拠を、`.replace/features.md` の「要求単位の根拠」列に非破壊で書き戻す、ただ 1 つの方法である。手順は [`references/evidence.md`](references/evidence.md) にある。

- 止まる範囲は、口ごとと、実行全体とで分かれる（原本は [`references/evidence.md`](references/evidence.md) の、止まる粒度を書いた節）。
  - 実行全体を止めるのは、前提の検証だけである（features.md が無い、根拠の列が無い、`--endpoint` と `--evidence` の対応が取れない）。
  - 下の 2 つで止まるのは、当たった口だけである。他の口の書き戻しは進め、止めた口と理由を報告に載せる。
    1 つの口のあいまいさで実行全体を捨てると、同じ実行で確定した他の口まで台帳に戻らない。
- 書き戻すのは根拠だけである。
  確定した要求単位が、「新規実装 API」列や横断 API 表の「API」列に書いた口と違っていたら、根拠だけを直して済ませず、その口は書かずに残す。
  口の変更は、Issue の本文・パリティスイート・新側の実装に影響するので、`issues` の突き合わせのやり直しと、スイートの見直しに回す。
- 口は、文字列がすべて一致するもので探す（`GET /api/orders` と `GET /api/orders/:id` のように、一方が他方の部分文字列になる口を取り違えない）。
  候補が 0 件のときも複数件のときも、その口は書かずに残して報告する（あいまいなまま、先に見つかったものを書かない）。
- 昇格の条件は、その口の要求単位を確定したことである。
  読み取りの口は応答への対応づけまで、書き込みの口は要求の組み立てと、ハンドラの受け取りと、トランザクションの境界まで読む。
  起点の問い合わせを読んだだけでは、`実測` に上げない（原本は [`references/features-issues.md`](references/features-issues.md)「API の形は要求単位を読んでから決める」）。
- 確定できなかった口は、`推定` のまま残す。
  「測るまで機能を閉じさせない」ものは、`parity-suite` が `.replace/parity/<slug>/metadata.json` の `unmeasured` に宣言する（原本は `parity-suite` の `references/coverage.md`「未測定を機械可読にする」）。
- 「要求単位の根拠」列を持たない features.md には書き戻さず、止まる。
  列を足すのは、その行の口をすべて埋める作業（`setup` / `issues` の非破壊の更新）である。1 つの口だけを埋めた列は、「列を足しただけ」と区別できない。
- 書き戻しの抜けは、同梱の [`scripts/evidence-gap-check.mjs`](scripts/evidence-gap-check.mjs) が数える。
  数えるのは、未確認のまま、`parity-suite` の `unmeasured` にも宣言されていない口である。`parity-replace` の完了判定が呼ぶ。

  ```bash
  node <skill>/scripts/evidence-gap-check.mjs --features .replace/features.md --slug <slug> \
    --unmeasured .replace/parity/<slug>/metadata.json
  ```

  - 終了コードは次のとおりである。
    - 0: 抜けが無い。
    - 1: 宣言していない未確認の口がある。
    - 2: 入力の不備（列の名前のずれを含む）。
    - 3: 判定できない（その行の表に根拠の列が無い）。
    - 4: 対象外。その slug の行がバッチか「その他の Issue」の表にあると、表の見出しで特定できたときである。口の列も根拠の列も無いというだけでは対象外にせず、3 と判定する。
  - 2・3・4 のどれも、「チェックして 0 件」（exit 0）と読み替えない。3 つとも、口を数えていない。
  - 使う側が 3 を完了の妨げにしないのは、古いインベントリとの互換のためであって、合格の証拠にしたわけではない（[`references/evidence.md`](references/evidence.md)）。
- `parity-suite`（特性化で確定する）と `parity-replace`（実装で確定する）は、このモードに任せる。
  2 つのスキルは、features.md を自分では書かない。書き戻しの方法をここに 1 つだけ持つことで、昇格の条件が 3 つのスキルに分かれて緩くならないようにする。

## 成果物

すべて、対象のプロジェクトの側に置く。成果物のスキーマの原本は、作る側のスキルが定義する。
このスキルは、設定・`survey.md`・`response-headers.json`・`strategy.md`・`features.md`・`dependencies.md`・`assets.md`・`weaknesses.md`・`procedure-changes.md` の原本を定義する（テンプレート: [`assets/`](assets/)）。
下流のスキルの成果物（`.replace/parity/<slug>/`・`.replace/dataset/`・`.replace/bootstrap/` の形式）は、各スキルが定義する。同じ形式を、複数のスキルで重ねて定義しない。

| 成果物 | 場所 | 内容 |
|---|---|---|
| 設定 | `.config/skills/shoji9x9/skills.yml` | 現・新のリポジトリとスタック（`new.stack` は事前に決まった骨格の記録）／現行環境の由来（`current.origin` / `current.received_assets` / `bootstrap_tool_dir`）／実行対象の環境（`targets`。環境ごとの URL・DB（`env_vars` と `seedable`）・ストレージ（`storage`）・認証・禁止操作・起動・`on_diff`）／データセットの実体（`dataset_mode` / `dataset_static_paths`）／ファイルストレージを使うか（`uses_storage`）／起動のラッパー／検証コマンド（`verification_commands` の `full` / `diff` の 2 列）／成果物の保持の方針・保存先・容量の閾値／パリティスイートの配置／意図的差異レジストリ／references |
| 測定レポート | `.replace/survey.md` | セマンティクスの測定値、DB を復元できるか、コードを入手できるか、副作用の棚卸し、既存のテストの評価。すべて実測値（横断の応答ヘッダーは、下の一覧を指すだけ） |
| 横断の応答ヘッダーの一覧 | `.replace/response-headers.json` | 採った応答、ヘッダーごとの分類・値・付く応答・付ける側・持ち主の slug・サーバーの設定を引き受ける slug（形式の原本: [`assets/response-headers-template.json`](assets/response-headers-template.json)。`parity-suite` の `header-normalize.mjs` が読む） |
| 戦略書 | `.replace/strategy.md` | 非対称な設計、パリティスイートの戦略、ゴールデンデータセットの方針、未検証の領域の扱い |
| 機能インベントリ | `.replace/features.md` | 機能の一覧、依存の順、ページ／API／テーブル／副作用の出力、API の「要求単位の根拠」（`実測` / `推定`）、ページ一覧（ページ × 乗る機能）、ページ要素の帰属（要素 × 配置の持ち主の slug）、横断 API の fan-out・参照するテーブル・リソースのグループ、その他の Issue（4 種以外）、slug、Issue の番号（`open` / `closed` は持たない。状態の原本はトラッカー）、受け入れ条件との突き合わせの結果（どの行を引き受けたかの原本は Issue の本文）。更新は非破壊。「要求単位の根拠」列の `推定` → `実測` は、`evidence` モードだけが書く |
| 依存パッケージの決定の記録 | `.replace/dependencies.md` | 部品ごとの決定（`パッケージ採用` / `自前実装` / `該当なし` / `内蔵` / `機能固有` / `未確認` の 6 値）と状態（`有効` / `取り消し済み`）、判断の材料、代わりの候補、採用しなかった理由、理由と引き取り手。このスキルが共通部品を、`parity-replace` / `parity-component` が機能に固有の部品と実装中の追加を、非破壊で追記する |
| 現行の弱点の仕分け | `.replace/weaknesses.md` | 現行のセキュリティ上の弱点ごとの攻撃の流れ、基準の当てはめ、仕分け（直す／引き継ぐ）、宣言（`may_change` / `keep` の文言）、扱う設計の作業、露出を広げた差異。このスキルが `setup` の手順 8 で作り、`parity-suite` / `parity-replace` が見つけた弱点を、仕分けを空欄にして非破壊で追記する。原本は [`references/security.md`](references/security.md) |
| 静的資産の台帳 | `.replace/assets.md` | 資産の種類ごとの方針（実体をコピーする／同等物を作る／コピーしない）、ファイルと出どころ、描き方と使われるページ、再配布してよいか、同等物で残る差と宣言。このスキルが `setup` で作り、`parity-replace` / `parity-component` が台帳に無い資産を方針を空欄にして非破壊で追記する。`parity-replace` は完了判定で、「実体を移す」行を新側の配信物と突き合わせる（`scripts/asset-delivery-check.mjs`）。原本は [`references/static-assets.md`](references/static-assets.md) |
| 手順・観点の変更の台帳 | `.replace/procedure-changes.md` | プロジェクト側で足した確かめる軸（観点の追加）と、それより前に特性化を終えた機能への当て直しの判断（`当て直し済み` / `当てない` / `見直し中`）。軸を足した工程が非破壊で追記する（無ければテンプレートから作る）。原本は [`references/procedure-changes.md`](references/procedure-changes.md) |
| 共通部品インベントリ（画面より先に部品を作る方針のときだけ） | `.replace/components.md` | 部品ごとの slug、インスタンス（ページと論理名）、データへの依存の有無、採否、Issue の番号、受け入れ条件との突き合わせの結果と、先に作らない部品とその理由、部品カタログの実体。`parity-component` が採取の対象をここから読む（`parity-component` はこのファイルを書かない）。更新は非破壊 |
| 自律実行の保留（`--autonomous` の実行だけ） | `.replace/strategy-pending.json` | `setup` / `issues` / `evidence` の実行で、人の判断待ちにした保留（`pending_decisions[]`）と `run.autonomous`。要素ごとの `mode` で、どのモードの保留かを書き分ける（`setup` が済んだかの前提の判定は `mode: setup` だけで絞るので、`evidence` の保留は下流を止めない）。形の原本は [`references/autonomy.md`](references/autonomy.md) |
| Issue | GitHub | 選んだ機能の分（`issues` モード） |

- 追記専用（非破壊の追記）の成果物は、機械可読な一覧を原本にする（[`assets/append-only-manifest.json`](assets/append-only-manifest.json)）。
  - 散文の中にあるかぎり、書き手が読み落としても何も起きない。積み上げた文書を丸ごと書き直しても、今の内容が整合していれば、どのチェックも通る。
    失われるのは過去の決定である（なぜこの差分を許容したのか、いつ誰が承認したのか）。
  - 縮んでいないことのチェックは、同梱の [`scripts/append-only-check.mjs`](scripts/append-only-check.mjs) が git の履歴と突き合わせて行う。コピーせず、スキルの中から実行する。

    ```bash
    node <skill>/scripts/append-only-check.mjs --root . --base <比較元の版>
    ```

  - 各項目の `id` は一覧の中で一意にし、キーパスはルートからの完全なパスで名指しする。
    重複した `id` と、末尾だけのパスは、厳しい方の規則や緩和を、警告なしに外す。
    一覧の項目（突き合わせの単位 `unit` と、原本が更新を定めている箇所を開けるオプション）を足す・直すときの規約は、[`references/append-only.md`](references/append-only.md) にある。
  - `parity-diff` が、機能を閉じる工程（収束の判定）でこれを呼ぶ。
    プロジェクト側の置き場所がデフォルトと違うなら、一覧をプロジェクトにコピーして書き換え、`--manifest` で渡す（スキルの中の原本は書き換えない）。
  - 工程の外で入った変更のために、プロジェクトの pre-commit と CI にも組み込む。
    呼び出し元ごとの比較元の版と、組み込める時期は [`checks.json`](checks.json) にある。
    呼び出し元では、プロジェクトの設定を `--exclude project-config` で外す。すべてのスキルの設定を持つので、他のスキルの設定を直す正当な編集まで止まるからである。

## 姉妹スキルと依存順

| スキル | 役割 |
|---|---|
| `current-environment-bootstrap` | 受領資産から現行のテスト環境（`side: current` の target）を再構築する。`current.origin: received-assets` のときだけ、`setup` が測定の前に任せる |
| `golden-dataset` | 現行と新側に投入する、共通のテストデータの投入ツール（フェーズ A: 現行、フェーズ B: 新側）。すべての機能にまたがる |
| `parity-component` | 共通 UI 部品の見た目の基準の採取・実装・カタログ上の照合。画面より先に部品を作る方針のときだけ、`.replace/components.md` を受けて、機能の着手の前に動く |
| `parity-suite` | パリティスイート（新旧どちらにも当てられる、実行できる合否判定の基準）の構築と、強度の検証 |
| `parity-replace` | 新側の実装の薄い層。ページ単位の分割・新側のマッピングの充填・敵対的レビュー。実装の流れは `issue-start` に任せる |
| `parity-diff` | 決定論的な差分ツール（画素の比較・特性照合・aria の比較）→ LLM のトリアージ |

全体の依存の順は次のとおりである。

1. `replace-strategy`（`setup` の由来の確認）
2. 必要なときだけ `current-environment-bootstrap`
3. `replace-strategy`（測定・戦略・機能インベントリ）
4. `golden-dataset`（フェーズ A）
5. 画面より先に部品を作る方針なら、部品ごとに `parity-component`（`capture` → `build`）
6. 機能ごとに、`parity-suite` → `parity-replace` → `parity-diff`（`parity-diff` は `parity-replace` と往復する）。
   `parity-replace` は、新側のスキーマが確定した後、完了のチェックの前に、`golden-dataset` のフェーズ B を呼ぶ。

共通部品の Issue は、機能の Issue より先にする。横断 API の Issue も、機能の Issue より先にする。

姉妹スキルがインストールされていなくても、このスキル（測定・戦略・起票）は動く。ただし、起票した Issue を進めるには必要になるので、`issues` モードの完了のときに案内する。
例外は `current-environment-bootstrap` である。`current.origin: received-assets` のときは、測定の前提そのものが揃わないので、インストールされていなければ導入の手順を示して止まる（手順 2）。
