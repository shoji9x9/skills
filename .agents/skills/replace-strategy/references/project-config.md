# プロジェクト設定の解決

現・新のリポジトリ／URL・DB 接続・環境・禁止操作・成果物方針・意図的差異レジストリ・references はリポジトリごとに異なるため、次の順で解決する。既定値は埋め込まない。

1. **設定ファイル**: `.config/skills/shoji9x9/skills.yml` に `skills.replace-strategy` があれば、その設定に従う。
2. **リポジトリ探索**: 無ければ `README.md` / `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` から現行アプリの URL・リポジトリ・DB の手がかりを推定する。推定した内容はユーザーに確認してから使う。
3. **解決できなければユーザーに確認**: `setup` モードの対話セットアップがこの確認を先回りして行い、結果を設定ファイルへ記録する。

## 設定ファイル（`.config/skills/shoji9x9/skills.yml`）

`shoji9x9/skills` 配布物がインストール先で参照するプロジェクト設定。**人間が確定させた方針の置き場所**であり、`gh skill update` は skill ディレクトリ外のこのファイルに触れないため設定は保持される。
スキルが書くキーは限られる（下記「キーの書き手とライフサイクル」。作業中に件数が増え続ける台帳はここに置かない）。

**このキーは姉妹スキル（`current-environment-bootstrap` / `golden-dataset` / `parity-suite` / `parity-replace` / `parity-diff`）が直接読む共有契約である。** キー名・構造を変える場合は姉妹スキル側の参照も併せて更新する。

```yaml
version: 1
skills:
  replace-strategy:
    current: # 現行アプリ（URL・DB・認証・禁止操作は targets の side: current が持つ）
      repo: <owner/repo | ローカルパス | none> # コードの入手性。無ければ none
      stack: [] # 現行のスタック（バックエンド言語・フロントフレームワーク）。測定・対話で判明した値を記録する
      origin: managed # 現行テスト環境の由来。managed（既存の管理済み環境。既定・キー欠落も managed）| received-assets（受領資産から自社で再構築する。下記「現行環境の由来」）
      received_assets: [] # origin: received-assets のとき必須（1 つ以上のパス）。受領資産の置き場所。current-environment-bootstrap が棚卸しの入力に読む
    new: # 新側アプリ（URL・DB・認証・禁止操作は targets の side: new が持つ）
      repo: <owner/repo | ローカルパス> # 骨格がスキャフォールド済みのリポジトリ（骨格の選定はスキル群の対象外。下記「新側アーキテクチャ」）
      stack: [] # 新側のスタック（フレームワーク・バックエンド構成・ORM 等）。事前に決定済みのものを setup の対話で記録する（current.stack と対称）
    targets: # 現・新の実行対象環境。複数定義し、各スキルの --target <name> で選択する（下記「実行対象環境」）
      - name: current-test # 環境名。小文字英数とハイフンで、全 target を通して一意（--target での指定・成果物ディレクトリ名に使う）
        side: current # current | new。必須（省略時の既定は無い。無ければ停止）
        url: <URL> # UI の baseURL。current 側は測定・特性化の対象環境（本番ではないテスト環境）
        api_url: <URL> # API の baseURL。UI と別 origin のときだけ指定する（省略時は url を使う）
        db:
          env_vars: [CURRENT_DB_URL] # この環境の DB 接続情報を持つ環境変数の「名前」。値は書かない。書く＝スキルが接続を読んでよい（書かない target の DB にスキルは一切触れない）
          seedable: true # true のときだけ golden-dataset の投入対象。省略・false は読み取り専用接続（接続は読むが削除・投入をしない）
        storage: # この環境のファイルストレージ（アップロード先・ファイル出力先）。未定義＝この target のストレージにスキルは一切触れない（下記「ファイルストレージ」）
          env_vars: [CURRENT_STORAGE_ENDPOINT] # 接続情報を持つ環境変数の「名前」。値は書かない（db と同じ規律）
          write_scope: [] # 削除・生成してよい範囲（パス、または <bucket>/<prefix>）。空・未定義＝書き込み不可
          seedable: false # ゴールデンデータ投入の設定由来ゲート（既定 deny）。true でも v1 は投入しない（投入の実装は明示的スコープ外）
          upload_route: direct # direct（アプリサーバ経由の multipart）| presigned（ブラウザがストレージへ直接 PUT）| none（アップロード経路なし）。省略＝未確認で、推測せず確認する
        auth: # この環境の認証情報。ロールごとに環境変数の「名前」を持つ（認証不要の環境では省略。単一ロールなら 1 ロールでよい）
          roles:
            admin:
              user_name_env: CURRENT_ADMIN_USER # ユーザー名を持つ環境変数の名前
              password_env: CURRENT_ADMIN_PASS # パスワードを持つ環境変数の名前。他の要素は <論理名>_env で追加できる（例: totp_secret_env）
            approver:
              user_name_env: CURRENT_APPROVER_USER
              password_env: CURRENT_APPROVER_PASS
        forbidden_actions: # この環境で実施しない UI / API 操作（投入ツール〈db.seedable 経由〉には適用しない。空リスト = すべて実施可、未定義 = 読み取り専用）
          - データの削除
        default: true # --target 省略時に使う target。側ごとに 1 つ（同じ側に複数あれば停止）
      - name: local-dev
        side: new
        url: <URL> # UI の baseURL。開発前は none 可——その場合はこの例にある下の default: true を外す（url: none の target に default を付けない）
        api_url: <URL>
        db:
          env_vars: [NEW_DB_URL]
          seedable: true
        storage:
          env_vars: [NEW_STORAGE_ENDPOINT]
          write_scope: []
          seedable: false
          upload_route: presigned # 現側と経路が違う場合、保存 path の命名規則差も含めて意図的差異レジストリの対象（下記「ファイルストレージ」）
        auth:
          roles:
            admin:
              user_name_env: NEW_ADMIN_USER
              password_env: NEW_ADMIN_PASS
        forbidden_actions: []
        pre_commands: [] # start の前提となる環境準備コマンド列（build 等）。起動が必要なときだけ実行し、失敗したら停止する
        start: <コマンド> # 長時間実行する起動コマンド（稼働していないときだけ実行する。稼働判定は check_urls）
        check_urls: [] # 稼働確認に使う URL（省略時は url のみ）
        default: true
      - name: develop # 例: PR マージ後に自動デプロイされる環境（実体は開発環境。実データを持つなら seedable を書かず読み取り専用にする）
        side: new
        url: <URL>
        db:
          env_vars: [DEVELOP_DB_URL] # seedable を書かない＝読み取り専用。バッチの出力一致検証などで DB 状態は読むが、削除・投入はしない
        auth:
          roles:
            admin:
              user_name_env: DEVELOP_ADMIN_USER
              password_env: DEVELOP_ADMIN_PASS
        commit_check: <コマンド> # 任意。稼働中の新側コミット SHA を標準出力に出す（start を持たない配信型 target の軽量経路判定に parity-replace が使う）
        on_diff: <path> # 任意。この target で要対応差分が出たときの対応手順を書いた Markdown のパス（下記「on_diff」。無ければ既定挙動）
      - name: preview # 例: ブランチ連動のプレビュー環境（URL がブランチ名に連動し固定文字列で書けない）
        side: new
        url_command: <コマンド> # url と排他。標準出力に URL を 1 行出す（意味論の正本は browser-test、parity 系での解決・記録規則は下記「URL の引き渡し」）
        auth:
          roles:
            admin:
              user_name_env: PREVIEW_ADMIN_USER
              password_env: PREVIEW_ADMIN_PASS
        forbidden_actions: []
        commit_check: <コマンド>
    secrets:
      wrapper: "" # 任意の起動ラッパー（例: aws-vault exec dev --）。シークレットが要るコマンドの前に付ける
    parity_suite_dir: e2e/ # パリティスイートの配置（parity-suite が読む。未指定時は e2e/）
    dataset_tool_dir: seed/ # golden-dataset の投入ツールの配置先（golden-dataset が読む。未指定時は seed/）
    bootstrap_tool_dir: bootstrap/ # current-environment-bootstrap の再構築ツール・暫定起動データ投入ツールの配置先（未指定時は bootstrap/）。current.origin: received-assets のときだけ使う
    dataset_mode: db # ゴールデンデータセットの実体（下記「データセットの実体」）。db（既定・省略可）| static
    dataset_static_paths: [] # dataset_mode: static のとき必須。投入ツールが生成・削除してよいパス（これ以外へ書いたら停止）
    uses_storage: true # アプリがファイルストレージ（オブジェクトストレージ・共有ファイルシステム）を使うか。既定は false で、false・省略なら targets の storage も書かない（下記「ファイルストレージ」）。dataset_mode と直交する別軸
    verification_commands: # 検証コマンド（静的解析・単体テスト・統合テスト等。固有のツール名は設定側に置く）。走る範囲で 2 列に分ける（下記「検証コマンド」）
      full: # 全体走査。リポジトリ全体を見るコマンドだけを置く（引数の有無は問わない。判別基準は全体を走査するか）。parity-replace の完了判定はこの列で行うため setup で必ず確定する
        - <コマンド> # 環境準備・起動・URL 解決は含めない（それらは targets の pre_commands / start / check_urls）。環境に依存しないコード検証のため、どの target でも同じコマンドを一律に実行する
      diff: # 任意（無ければ省略か空リスト）。変更ファイルだけを受け取る安価な列。実装反復と敵対的レビュー前の早期検出にだけ使い、完了判定には使わない
        - <コマンド> {changed_files} # {changed_files} は実行するスキルが変更ファイル一覧へ展開する
    artifacts:
      retention: latest # ワークツリーは最新のみ。履歴は Git が持つ
      storage: local # local（既定・コミットしない）| git | git-lfs — 大きなバイナリの既定保存先
      size_threshold_mb: 50 # 超過時に警告する
      overrides: {} # 機能ごとの上書き（例: order: git-lfs）
    references: # 利用者が選ぶ知識の注入。パスだけを持つ（本文はファイル側）。setup が全キーを生成し、決まらないキーは空値で残す（下記「references（知識の注入）」）
      architecture: "" # 新側アプリの骨格（レイヤ／ディレクトリ構成・API 設計方針・ホスティング／リリース構成・実行基盤と利用マネージドサービス）の決定記録。事前定義が前提で setup は下書きを作らない（parity-replace が実装工程の前に読む。下記「新側アーキテクチャ」）
      coding_conventions: "" # 生成先リポジトリのコーディング規約（命名・エラー処理・テストの書き方・レビュー観点）。骨格の「上」の書き方であり architecture とは別（parity-replace / golden-dataset / parity-suite が生成物を書くときに読む。生成物ごとの引き先は下記「コーディング規約」）
      ui_library: "" # 新 UI ライブラリ設定と旧→新 design token マッピング（parity-replace / parity-diff が読む）
      db_semantics: "" # 現行 DB → 新 DB の型マッピングと意味論の差、および移植時に踏む方言差の点検表（parity-replace が実装前に読み、golden-dataset / parity-suite / parity-diff が比較で読み、current-environment-bootstrap が整備済みのとき復元項目の突き合わせで読む。下記「DB 意味論」）
      env_setup: "" # 環境変数の用意方法（全スキルが接続確認の失敗時に案内する）
      dependency_policy: <path | none> # 依存導入の方針（ライセンス・供給網・バンドルサイズ上限等）。無いことをユーザーに確認済みなら none（下記「依存導入の方針」）
      # キーは追加できる（下記「references の拡張」の契約に従う）
    intentional_diffs: # 意図的差異レジストリ
      keep: [] # 変えない（例: テーブル名、項目名、API エンドポイント、関数名）
      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名、HTML の id/name、型変換に伴う差異）
      pending: [] # 保留（測定結果で決める）。設定ファイル上で唯一「スキルが作業中に追記する記録」（下記「キーの書き手とライフサイクル」）。確認後に人間が keep / may_change へ移す
      # ↑ 書き手がスキルであることは「設定から出す」理由にはならない（slug 横断のためここに残る。同節の段 1 / 段 2 を参照）
    component_diffs: [] # コンポーネント系統差レジストリ。クラス/トークン×プロパティ単位の系統差 T（旧値→新側で期待される値）。parity-replace がテーマで消せない構造差をユーザー確認の上で宣言し、parity-diff が比較の正規化に使う（特性照合経路にのみ効く。適用対象の正本は parity-diff の references/normalize.md）。要素の形の正本は本ファイル: { component, property, current, new, reason }。component は照合キーで、対象要素の論理名（`*` を含めれば glob）を書く。欠落・空は wildcard ではなく不一致として扱われ照合に使われない（照合方法の正本は parity-diff の references/normalize.md）
    # T が引けない箇所のインスタンス単位例外は設定ファイルに置かない（slug スコープの台帳のため .replace/parity/<slug>/component-diff-exceptions.json へ。スキーマ正本は parity-diff の references/normalize.md）
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、このスキルが使うキー（`skills.replace-strategy`）だけを書く。指定値は**探索またはユーザー確認で得た実在の値**にする（上の URL・変数名・コマンドは例なので、そのまま盲目コピーしない）。既にあれば欠けたキーだけを該当セクションに追記し、既存のキー・値・コメントは変更しない。値が既にあれば尊重し上書きしない。
- references の扱いは下記「references（知識の注入）」を参照する。

## キーの書き手とライフサイクル

**設定ファイルは「人間が確定させた方針」の置き場所である。** スキルが作業中に増やし続ける記録を同じファイル末尾へ追記すると、
PR の diff で「環境設定の変更」と「作業中に見つけた差異の記録」が区別できず、機能ブランチを並行させると衝突する。**本節が書き手区分の正本**で、各スキルの設定キー表はここへ転記しない。

判断は**独立した 2 段**である。混ぜると「書き手がスキルだから設定から出す」という誤った結論になり、`intentional_diffs.pending` の扱いを間違える。

| 段 | 問い | 決めるもの |
|---|---|---|
| 1 | **そのキーが設定ファイルに載るか** | **slug スコープ かつ 作業中に件数が増え続ける台帳なら載せない**（slug 成果物へ。下記 3 番目の箇条） |
| 2 | 載るキーが下表のどちらの区分か | **書き手**（人間が確定させるか、スキルが作業中に追記するか） |

| 区分 | キー | 書き込み |
|---|---|---|
| **人間が確定させる方針** | `current`（`origin` / `received_assets` を含む） / `new` / `targets` / `secrets` / `parity_suite_dir` / `dataset_tool_dir` / `bootstrap_tool_dir` / `dataset_mode` / `dataset_static_paths` / `uses_storage` / `verification_commands` / `artifacts` / `references`（パス型キー） / `intentional_diffs.{keep,may_change}` / `component_diffs` | `setup` の対話、または人間が直接編集する。スキルが代筆する場合も**人間が決めた値を 1 回記録するだけ**（`references.dependency_policy` / `new.stack` / `references.architecture` の確認結果、`current-environment-bootstrap` が引き渡し時に埋める現行 target の `url` と `default: true`〈ユーザー確認済みの実測値を 1 回記録する〉、`component_diffs` のユーザー承認済み宣言〈`parity-replace` / `parity-diff` が非破壊追記〉。`setup` の再実行を待たずに追記する） |
| **スキルが作業中に追記する記録** | `intentional_diffs.pending` | `golden-dataset` / `parity-suite` / `parity-replace` が宣言に無い差異を見つけたとき非破壊追記し、ユーザー確認を経て**人間が** `keep` / `may_change` へ移す。**設定ファイルに残る唯一の作業中記録** |

- **`component_diffs` を設定側に残す根拠**: 要素が `component` × `property` で**slug 横断**に効き、1 回の宣言が（`component` に glob を書けば）全 slug・全インスタンスに効く（`parity-diff` の適用順序 2）。
  slug ごとに分けると同じ宣言が slug 数だけ複製されるため、slug 成果物側へ移さない
- **`intentional_diffs.pending` を設定側に残す根拠**: `keep` / `may_change` と同じ 3 分類の一員で、**昇格が同じキー内での人間の移動作業**である。加えて **slug 横断**のため置くべき slug ディレクトリが無い——
  つまり段 1 の条件（slug スコープ）を満たさないので設定に残る。**書き手がスキルであることは段 1 の判断材料ではない**（それは段 2 で上表の下段に置く理由にしかならない）
- **新しいキーを足すときは段 1 → 段 2 の順で判定する**（載せると決めたものだけを上表のどちらかに置く）。段 1 の除外条件が**作業中に件数が増え続ける slug スコープの台帳**で、これは設定ファイルに置かず**slug 成果物（`.replace/parity/<slug>/`）へ置く**
  （下流スキルの成果物の形式は各スキルが定義する。[`../SKILL.md`](../SKILL.md)「成果物」）。
  実例: `parity-diff` のインスタンス例外は設定キーから `.replace/parity/<slug>/component-diff-exceptions.json` へ移した（下記「移行」）

## 設定ファイルの共有と YAML アンカー

設定ファイルは全スキルが 1 ファイルを共有する（`skills.<スキル名>` でスキルごとのキーに分かれる）。**スキルキーを跨いだ YAML アンカーの共有は認める**——
同じ URL・環境変数名・環境定義を複数スキルへ書き写すと二重管理になるため（例: `skills.replace-strategy.targets` と `skills.browser-test.environments` で同じ環境の定義を共有する）。

ただし**アンカーはファイル単位でしか解決できない**ため、共有は次の制約を課す。**設定ファイルの分割・再配置を提案・実施するときは、先にこの制約を確認する**。

- **分割不可制約**: スキルキーを跨いだアンカー共有がある間は、**設定ファイルをスキルごとのファイルへ分割できない**（alias が解決先を失う）。分割するなら先に共有を解消して各所へ実体を書く
- **アンカーは参照より前に定義されている必要がある。** 「作成・追記は非破壊」に従う追記では、**アンカー定義の位置を動かさない・消さない**（末尾へ足すだけなら安全）
- アンカー定義を持つスキルキーを削除・移動するときは、**参照側を先に実体化する**（削除して初めて壊れることを避ける）
- **値の意味論は参照側のスキーマに従う。** アンカー経由で他スキルのキー由来の値を読むことになるが、定義元スキルの意味論を持ち込まない
  （例: `browser-test` の `auth: none | user` と本ファイルの `auth.roles` は別物。正本はそれぞれの参照側にある）

## references（知識の注入）

利用者が選ぶプロジェクト知識をパスで注入するキー。**横断的**（1 つを複数スキルが読む）なので per-skill ではなく `replace-strategy` に集約する。

- **`setup` はパス型キー（`architecture` / `coding_conventions` / `ui_library` / `db_semantics` / `env_setup`）をキーごと生成する。** この時点でパスが決まらないキーは**空値（`""`）のまま置き**、コメントに「どのスキルがいつ読むか」を残す。
  枠を作るのは**未整備を `setup` 時点で可視化するため**であって、下流を止めなくするためではない——未整備で停止するのは正しい挙動である（キーごと存在しないと、下流のスキルが停止して初めて不足が分かる）
- **`dependency_policy` は空値で生成しない。** このキーだけは**キーの有無そのものが「未確認」を表す三値**であり、空値の枠を置くと下流の「キー欠落＝未確認なら確認する」が二度と発火しない。
  `setup` はユーザーに方針の要否を確認し、**パスか `none` を書く**。確認まで至らなければ**キーごと書かない**（下記「依存導入の方針」）
- **空値の references キーは「未設定の枠」であり、上記「作成・追記は非破壊」の言う既存値ではない。** 実パスが決まった時点で空値を実パスへ埋めるのは上書きに当たらない（非破壊が守るのは**実値**であって空の枠ではない）
- **キー欠落・空値・解決できないパスはいずれも「未整備」**として扱う。**そのキーを前提とする工程は内容を捏造せず、下表の「未整備のときの挙動」に従う**（停止すると書かれた工程だけが停止する。表に無い工程は停止せず、判断材料が無いことを推測で埋めず未確定として記録する）
- references のファイル自体は人間が書くプロジェクト知識だが、`setup` が DDL・測定結果・技術スタックから下書きを生成し、**人間がレビューして確定する**（特に `db_semantics` は専門的なため）。
  **`architecture` だけは下書きを生成しない**——骨格の下書きを作ることは実質スキルが骨格を決めることになるため（下記「新側アーキテクチャ」）
- references は知識の注入であって検証の代替ではない。注入された差（例: 現行 DB の空文字と NULL の扱い、collation による並び順）は意図的差異レジストリに落とし込み、実際の検証は `golden-dataset`（フェーズ B の一致検証）・`parity-suite`（API の並び順特性化）が担う

| キー | 読むスキルと工程 | 未整備のときの挙動 |
|---|---|---|
| `architecture` | `parity-replace` の部品の採否・実装工程（手順 3 以降）、依存を決める全スキルのランタイム制約の判断 | `parity-replace` は部品の採否・実装に入らず**停止する**（骨格を推測すると全機能・全ページに波及し、後戻りが最も高くつく）。ただし新側リポジトリに骨格が既に実装されていれば、**実態から読み取った内容**を下書きとして提示し、ユーザーが確定させてから進める（既存実装の読み取りは記述であって決定ではない）。**依存を決める側**（`parity-suite` / `parity-diff` 等、実装工程を持たないスキル）は**停止しないが、実行基盤の制約を推測で埋めない**——ユーザーに確認してから候補を絞る（[`dependency-selection.md`](dependency-selection.md)「判断材料」の実行基盤の行） |
| `coding_conventions` | 対象プロジェクト側にコードを書く全スキル——`parity-replace` の実装工程と敵対的レビュー、`golden-dataset` の投入ツール生成、`parity-suite` のスイート authoring、`current-environment-bootstrap` の再構築ツール・暫定起動データ投入ツール生成 | **停止しない**（規約を持たないリポジトリもあるため）。ただし**推測で自分の流儀を持ち込まず**、**生成先リポジトリ**（新側とは限らない。下記「コーディング規約」の対応表）の既存コードと基底ドキュメントから読み取れる範囲に従い、整備をユーザーに促す |
| `ui_library` | `parity-replace` の「見た目の系統差を源流で縮める」工程、`parity-diff` の正規化（系統差の判断材料） | `parity-replace` はテーマ寄せに入る前に整備を促す（系統差を源流で縮められず、宣言・未検証が膨らむ）。`parity-diff` は**停止しない**が、判断材料が無いまま「許容」へ寄せない |
| `db_semantics` | **`parity-replace` の実装（手順 4）——クエリ・データアクセスを書く前に移植時の点検表として読む**、`golden-dataset` のフェーズ B（新側への写像・現新一致検証）、`parity-suite` の並び順特性化、`parity-diff` の並び順差の判断、`current-environment-bootstrap` の復元項目の突き合わせ（整備済みのときだけ） | フェーズ B は**停止する**（写像の根拠が無い）。`parity-replace` は**停止しない**が、方言差を推測で埋めず、下記「DB 意味論」の点検項目を現行 DB／新 DB の一次ドキュメントで確認して結果を `porting.md` へ記録し、整備を促す。`parity-suite` / `parity-diff` も**停止しない**（実測で特性化し、整備を促す） |
| `env_setup` | 全スキル。接続確認（現行 URL への疎通・環境変数の存在確認）が失敗したときの案内先 | 案内先が無いだけで停止はしない |
| `dependency_policy` | 依存を決める全スキル（`replace-strategy` / `parity-suite` / `parity-replace` / `parity-diff`） | 三値のため下記「依存導入の方針」に従う（欠落＝未確認としてユーザーに要否を確認して記録する） |

### references の拡張（新しいキーを足すとき）

`references` にはプロジェクト固有の知識を足せるが、**キーを足しただけでは誰も読まない**。上の表に行が無いキーは、下流スキルにとって存在しないのと同じである。
そのため**キーの追加は上表への追記とセットで行う**（片方だけの追加は未完了として扱う）。

- **上表に「読むスキルと工程」「未整備のときの挙動」の行を足す。** 工程は「いつ読むか」が分かる粒度で書く（「実装で読む」ではなく「`parity-replace` の手順 3 以降」）
- **未整備のときの挙動は、停止するか・停止せず整備を促すかを必ず決める。** 決めないと下流が「判断材料が無いまま推測で埋める」に倒れる
- **停止させるのは、推測が全機能・全ページに波及して後戻りが高くつくキーだけにする**（`architecture` / フェーズ B の `db_semantics` がこれに当たる）
- **パス型キーは空値（`""`）で枠を作る。** 三値（キーの有無が「未確認」を意味する）にするのは、「持たない」こと自体が判断を変える場合だけ（現状は `dependency_policy` のみ）
- 追加したキーを読むスキル側にも、そのスキルの「プロジェクト設定の解決」キー表へ行を足す

## 現行環境の由来（`current.origin` / `current.received_assets`）

**測定対象になる現行テスト環境が「既にある」のか「これから建てる」のか**を宣言する。スキル群の全工程は「動いている現行アプリが正解である」ことに立脚するため、
**この 1 つの分岐が、以降のすべての比較が正しい基準の上に乗るかどうかを決める。**

| 値 | 意味 | `setup` の挙動 |
|---|---|---|
| `managed`（既定） | 自社で管理している動作可能なテスト環境がある | 従来どおり。対話セットアップの直後に測定へ進む |
| `received-assets` | 先方から受領した資産だけがあり、比較基準になる環境をこれから自社に再構築する | 測定の前に `current-environment-bootstrap` へ委譲し、**引き渡し完了まで測定へ進まない** |

- **キー欠落は `managed`** として扱う。**キーが無いプロジェクトに `setup` の再実行を要求しない**（本キーの導入前に `setup` を終えたものは、動作可能な現行環境が既にあったからこそ測定を完了できている）
- **`received-assets` は「コードだけ受領した」ことを指すのではない。** 判定の軸は**測定できる環境が動いているか**であり、コードの入手性（`current.repo`）とは別の軸である
  （コードがあっても環境が無ければ `received-assets`、コードが無くても動く環境があれば `managed`）
- **由来を推測で決めない。** 設定に現行アプリの URL を書けることは、その URL に到達できることの証拠ではない。`setup` の手順 2 でユーザーに確認して記録する
- `current.received_assets` は 1 つ以上のパス。受領が複数回に分かれる場合は追記する（`current-environment-bootstrap` が棚卸しで全パスを走査する）
- **再構築の実施は `current-environment-bootstrap` の担当**であり、`replace-strategy` は代行しない。同スキルの成果物（`.replace/bootstrap/`）とツール配置（`bootstrap_tool_dir`）の正本は同スキルにある

## 新側アーキテクチャ（`new.stack` / `references.architecture`）

**新側の骨格——フレームワーク・バックエンド構成・ORM・レイヤ／ディレクトリ構成・API 設計方針・ホスティング／リリース構成・実行基盤と利用マネージドサービス——はスキル群が決めない。**
事前に決定済みである前提に立ち、スキルは確認・記録・参照だけを行う（対象外とする理由は [`../SKILL.md`](../SKILL.md) の「前提」）。

| キー | 形 | 内容 | 書くのは |
|---|---|---|---|
| `new.stack` | 文字列リスト（`current.stack` と対称） | 機械可読な短い列挙（言語・フレームワーク・ORM・**実行ランタイム**等の名前）。依存を決めるスキルが候補パッケージの適合先を判断するのにも使う | `setup` が対話で確認して記録する |
| `references.architecture` | パス（`references` の他のパス型キーと同じ） | 散文の決定記録（レイヤ／ディレクトリ構成・API 設計方針・ホスティング／リリース構成・**実行基盤と利用マネージドサービス**と、それを選んだ制約） | 人間。`setup` は枠だけを生成する |

- **実行基盤（クラウド／オンプレとその上のマネージドサービス）は本キーに含める。** 別キーには切らない——読むスキル・工程・未整備時の挙動が `architecture` と同じで、
  分けると同じ決定が 2 ファイルに散る。別ファイルにしたければ `architecture` の決定記録からリンクする（`on_diff` がスクリプトへリンクするのと同じ形）
- **実行基盤は依存選定の制約でもある。** どのランタイムで動くか（コンテナ／サーバレス／エッジ）で、採れるパッケージが変わる——
  ネイティブバイナリを持つ依存が動かない、ファイルシステムに書けない、Node の標準 API が一部欠ける、といった制約は候補を絞る**前**に効く（判断材料の正本は [`dependency-selection.md`](dependency-selection.md)）

- **`setup` は `references.architecture` の下書きを生成しない。** `ui_library` / `db_semantics` は測定結果・DDL から下書きを作って人間がレビューする運用だが、
  骨格の下書きを作ることは実質スキルが骨格を決めることになるため、ここだけは**枠のみ**とする
- **三値（`dependency_policy` 型）にはしない。** 「方針を持たない」が意味を持つ `dependency_policy` と違い、骨格は必ず何かに決まっているため、空値＝未整備のパス型キーで足りる
- **キーが無いプロジェクトに `setup` の再実行を要求しない**（本キーの導入前に `setup` を終えたもの）。キー欠落は空値と同じ「未整備」として扱い、最初に必要とするスキルが確認する
- **既存実装から読み取った下書きをユーザーが確定させたら、その決定記録のパスを `references.architecture` へ書く**（空値・欠落→実パスは上書きに当たらない。上記「references（知識の注入）」）。
  記録しないと次の実行・次の機能で同じ読み取りとゲートを繰り返す
- **`new.stack` が空・欠落でも停止しない。** 骨格の未整備ゲートは `references.architecture` だけが担う。
  依存の候補が新側スタックと両立するかを判断する必要が出た時点で推測せずユーザーに確認し、確認したスキルが非破壊追記する（`setup` の再実行を待たない）
- 骨格と**部品の採否**（複数機能で使うライブラリ・フォント等）の境界は [`dependency-selection.md`](dependency-selection.md) が定める

## 検証コマンド（`verification_commands`）

静的解析・型検査・テストのコマンド。**固有のツール名はスキル本体に書かず設定側に置く**ため、リポジトリのリント・フォーマッタ・テストランナーがそのまま効く。
**走る範囲で `full`（全体走査）と `diff`（変更ファイルだけ）の 2 列に分ける**（下記「走る範囲」）。

- **環境準備・起動・URL 解決は含めない**（それらは `targets` の `pre_commands` / `start` / `check_urls`）。環境に依存しないコード検証なので、どの target でも同じコマンドを一律に実行する
- **読むのは対象プロジェクト側にコードを生成する全スキル。** ただし**通す列と未設定のときの挙動は用途で分かれる**:

  | スキル | 通す対象 | 通す列 | `full` が未設定のとき |
  |---|---|---|---|
  | `parity-replace` | 新側の実装（＋付随する IaC 差分） | 完了判定（手順 8）は `full`。`diff` は敵対的レビュー前の早期検出（手順 7）だけ | **停止する**（完了判定が「新で green ＋検証コマンド」なので成立しなくなる） |
  | `golden-dataset` | 投入ツール | `full` | 停止せず、`verification.md` に記録して進む |
  | `parity-suite` | スイート・マッピング層・操作アダプタ | `full` | 停止せず、`gaps.md` に記録して進む |
  | `current-environment-bootstrap` | 再構築ツール・暫定起動データ投入ツール | `full` | 停止せず、`verification.md` に記録して進む |

- **停止するのは完了判定に使うスキルだけ**という線引きである（品質担保が目的の側は、検証が無いことを記録すれば足りる）
- **コマンドが対象パスを含んでいるとは限らない**（例: リントの対象が新側アプリのソースだけに絞られていて、投入ツールやスイートを拾わない）。含まれていなければその旨を記録し、**範囲を勝手に広げない**。
  これは**対象パス**の軸であり、次の**走る範囲**の軸とは別物である（対象パスに入っていても、差分限定で走れば変更集合の外は見ない）

### 走る範囲（`full` / `diff`）

**差分限定の検査は「変更したファイル自身の正しさ」しか見ない。** design token・共有定数・設定・参照される側のファイルを**消す・改名する**変更は、
壊れる相手が**変更集合の外**にいるため、差分に固定した検査では原理的に捕まらない
（穴が開くのは**判定が他ファイルに依存する検査**〈型検査・未使用エクスポート検出・参照解決〉である。判定がファイル単位の検査〈整形など〉は差分限定でも結論が変わらない。
ただし**`diff` 列の中身を 1 本ずつこの軸で分類してから前倒しを決めない**——分類を誤ると穴がそのまま残るため、下記の前倒し条件は列の中身によらず一律に適用する）。
2 列に分けるのは、**「検証コマンドが通った」を「全体で通った」と読める状態にする**ためである。

| 列 | 中身 | 使う工程 |
|---|---|---|
| `full`（必須） | リポジトリ全体を走査するコマンド（引数の有無は問わない。`tsc -p tsconfig.json` のように対象を引数で与えても全体を走査するなら `full`） | `parity-replace` の**完了判定（手順 8）は常にこの列**。他スキルの生成物検証もこの列 |
| `diff`（任意） | 変更ファイルだけを受け取るコマンド。`{changed_files}` を置くと**実行するスキルが**変更ファイル一覧へ展開する | 実装反復と敵対的レビュー前の早期検出（`parity-replace` 手順 7）だけ。**完了判定には使わない** |

- **`full` を「フック設定を見て」埋めない。** コミット前フックが同じツールを差分限定で回していることは多く、
  フック設定に変更ファイルが渡っているかだけでは判別できない——**スクリプト側が引数をどう使うか**（判定がファイル単位か、他ファイルを見るか）まで読む。
  読んで判別できないコマンドは `full` に入れず、`setup` で全体走査の起動形をユーザーに確認する
- **差分限定でしか起動できないツールを `full` に混ぜない。** 混ぜると完了判定が差分限定の結果を「全体で通った」と名乗る。
  全体走査の起動形が無いツールは**未検査として `.replace/strategy.md` の「未検証領域の扱い」へ記録**し、`full` に入れたことにしない
- **`diff` が通ったことを `full` を省く理由にしない。** `diff` は安価な早期検出であり、手順 8 では必ず `full` を回す
- **`diff` を回す工程でも、変更集合が次のいずれかを含むなら `full` へ前倒しする**（差分限定では原理的に捕まらないため、レビュー往復の前に安価に落とす）:
  - ファイルの**削除・改名**（`git diff --name-status` / `git status --porcelain` の `D` / `R`）
  - 定義元（design token・共有定数・設定値・型・エクスポート）の**削除・改名**（削除行に定義の宣言が含まれる変更）
- **実行した列を証跡へ記録する。** どちらを回したかが残らないと、後から「全体で通ったのか」を検証できない
- **どちらの列にも「書き換える起動形」を置かない。** 検証コマンドは**判定**であって整形作業ではない。
  auto-fix 付きの起動形（フォーマッタの書き込みモード・リンタの `--fix`）を置くと、**対象を黙って直したうえで必ず成功する**ため、
  ゲートとして機能しない——落ちるべき変更が「通った」として記録され、完了判定が意味を失う。
  差分があれば非ゼロで終わる**チェック形**（`--check` / `--dry-run` 相当）を置く。
  `diff` 列も同じである。むしろこちらは害が二重で、手順 7 は**未コミット差分**をレビュー対象にするため、
  書き換える起動形は**レビューにかける差分そのものを動かす**（レビュー役が見たものと実装役が書いたものがずれる）。
- **チェック形かどうかは起動形の名前ではなく実測で判別する。** `--check` が付いていても書き換えるツール、
  付いていなくても書き換えないツールがある。**1 回通した後に作業ツリーの差分が増えていないこと**を確かめる
  （増えていれば書き換える起動形である）。`setup` で確定する時点と、`full` に新しいコマンドを足す時点で行う
- **`{changed_files}` の展開規則**（`diff` 列を回すスキルが従う。展開はスキルが行うので、設定側はプレースホルダを置くだけでよい）:
  - **対象集合**は、生成物が置かれるリポジトリの**未コミット変更ぜんぶ**——`git diff --name-only`（未ステージ）＋ `git diff --staged --name-only`（ステージ済み）＋
    `git status --porcelain` の `??`（**未追跡**。新規実装ファイルはここにしか出ないため、落とすと新しいコードが 1 行も検査されない）。
    **削除された（`D`）パスは渡さない**（存在しないパスでツールが落ちる。`D` があれば上記のとおり `full` へ前倒しになる）
  - **0 件のときは `diff` 列を回さない。** 引数無しで起動すると、ツールによって「全体走査に化ける」か「対象 0 件で無条件に成功する」かのどちらかになり、**どちらも「差分限定で通った」の証跡にならない**。回さなかったことを証跡へ記録する（0 件を成功に倒さない）
  - パスは**1 つずつ別の引数として**渡す（空白・非 ASCII を含むパスがあるため、区切り文字で連結した 1 つの文字列にしない）

## コーディング規約（`references.coding_conventions`）

本スキル群は**対象プロジェクト側にコードを生成する**——新側の実装（`parity-replace`）・投入ツール（`golden-dataset`）・パリティスイート（`parity-suite`）。
生成された時点からそれはプロジェクトのコードであり、リポジトリの規約から外れていればレビューでも保守でも負債になる。
規約の本文は設定に持たず、**規約ドキュメントのパスを 1 つ持つ**（`references` の他キーと同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

- **`architecture` とは別のキーである。** `architecture` は骨格（どこに何を置くか・どう分けるか）、本キーは骨格の**上**の書き方（命名・エラー処理・型の扱い・テストの書き方・レビュー観点）。
  未整備のときの挙動も違う——骨格は停止し、規約は停止しない
- **規約を引く先は「生成物が置かれるリポジトリ」であって、常に新側とは限らない。** 生成物ごとに次の対応で読む:

  | 生成物 | 置かれる先 | 規約を引くリポジトリ |
  |---|---|---|
  | 新側の実装（`parity-replace`） | `new.repo` | 新側 |
  | 投入ツール（`golden-dataset`、`dataset_tool_dir`） | ツールを置くリポジトリ（フェーズ A は現行側の受け皿を触るため現側になることが多い） | そのリポジトリ |
  | パリティスイート（`parity-suite`、`parity_suite_dir`） | スイートを置くリポジトリ | そのリポジトリ |

  `coding_conventions` に複数リポジトリの規約が要る場合は、規約ドキュメント側でリポジトリごとに節を分ける（キーは 1 つのまま）
- **未整備でも停止しないが、推測で自分の流儀を持ち込まない。** 次の順で解決する:
  1. `coding_conventions` のドキュメント
  2. **生成先リポジトリの基底ドキュメント**（`AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` / `CONTRIBUTING.md`）とリント・フォーマッタ設定
  3. 生成先リポジトリの既存コード（新側なら骨格スキャフォールドが持つ実例）
- **生成先が作業中のリポジトリと違うときは 2・3 を明示的に読みに行く。** `new.repo` が作業中のリポジトリと違う場合、実行中のエージェントに載っている基底ドキュメントは**現側のもの**であり、新側の規約は自動では効かない（逆に、新側リポジトリで作業しながら現側へ投入ツールを置く場合も同じことが起きる）
- **解決できた規約ドキュメントのパスは同キーへ非破壊追記する**（`setup` の再実行を待たない。記録しないと機能ごとに同じ探索を繰り返す）
- **規約と振る舞い保存が衝突したら振る舞い保存を優先し、衝突を記録する。** 規約に合わせた結果として現行と挙動が変わるなら、それは意図的差異であり `intentional_diffs.pending` へ回してユーザー確認へ出す
- **規約に従うことを `verification_commands` の代替にしない**（規約は書き方の指針、検証コマンドは機械的な検査。生成物には両方を通す）
- **規約が機械検査されているかを `setup` で仕分ける。** 規約ドキュメントの項目を、`verification_commands.full` で落ちるものと、落ちない（人のレビューでしか出ない）ものに分け、**未検査の項目を `.replace/strategy.md` の「未検証領域の扱い」へ記録する**。
  未検査のままだと、規約に従ったつもりの箇所が `parity-replace` の敵対的レビューやユーザー指摘で初めて出て、**指摘を受けてから検査を足す**ことになる（機能ごとに繰り返す）。
  リントルール・フォーマッタ設定で表現できる項目は `setup` の時点で整備をユーザーに促し、足した検査は `full` へ載せる。
  **仕分けは「規約に検査があるか」ではなく「その規約を破った入力が `full` で落ちるか」で判定する**（設定ファイルにルール名があっても、対象パスから外れていれば落ちない）

## DB 意味論（`references.db_semantics`）

現行 DB と新 DB は、同じ意味で書いた SQL でも同じ結果を返さない。本キーは**その差を 1 つのドキュメントに集めた注入先**で、役割が 2 つある。

| 役割 | 読む工程 | 内容 |
|---|---|---|
| **移植時の点検表** | `parity-replace` の実装（手順 4）——クエリ・データアクセスを**書く前**に読む | 新旧で結果が変わる構文・既定値と、現行 DB／新 DB それぞれがどうなっているか |
| **差の宣言** | `golden-dataset` のフェーズ B（写像・現新一致検証）、`parity-suite` の並び順特性化、`parity-diff` の並び順差の判断、`current-environment-bootstrap` の復元項目の突き合わせ（整備済みのときだけ） | 現行 → 新の型マッピングと宣言済みの差（比較で「宣言外の差」と区別するための基準） |

- **点検表を実装工程の入力に置く理由は、方言差の手戻りが最も高い層で出るため。** 実装工程の入力になっていないと、
  書く時点では誰も点検表を読まず、方言差は実装後の敵対的レビューで初めて出る。指摘 1 件あたりの手戻りが「読んでから書く」より高くつくうえ、
  **パリティスイートが green のまま残る差もある**（絞り込みの破綻はデータ件数が少ないと現れない）
- **点検表には少なくとも次を挙げる。** 特定の DB 製品名を決め打ちせず、**現行 DB と新 DB それぞれの既定**と、差があるときの扱いを書く。

  | 点検項目 | 何が変わるか |
  |---|---|
  | **NULL の並び順** | `ORDER BY` の既定の NULL 位置が製品で逆になる（昇順で NULLS LAST の製品と NULLS FIRST の製品がある）。並び替え列が nullable なら並びが変わる |
  | **暗黙の型変換と、変換に失敗したときの値** | 文字列と数値・日付を比較したときの変換規則。**変換エラーを既定値へ落とす構文は絞り込みを黙って無効化する**（数値として読めない入力が既定値として比較され、条件が全件に化ける） |
  | **照合順序（collation）** | 大小・全角半角・かなの畳み方。比較・`LIKE`・`ORDER BY`・一意制約のすべてに効く。**片側だけ正規化すると比較が壊れる**（列の型に効かない正規化関数を入力側だけに掛ける等） |
  | **連結における NULL の扱い** | NULL を空文字として連結する製品では、連結して組んだ `LIKE` パターンが全件に当たる。NULL を伝播する製品では結果が NULL になる |
  | **数値・日付の書式のロケール依存** | 小数点・桁区切り・日付書式がセッション設定に依存する製品では、変換関数に書式を渡すだけでは結果が固定されない（明示のロケール指定が要る） |

- **この表は網羅ではない。** 列挙されていない差は点検表からは出てこないため、**点検表を通したことを実測の代替にしない**——
  実際の検証は `golden-dataset`（フェーズ B の一致検証）と `parity-suite`（並び順の特性化）が担う（上記「references（知識の注入）」）
- **点検で見つかった差は、実装で吸収するか意図的差異として宣言するかを 1 件ずつ決める。** 吸収しないと決めた差は
  `intentional_diffs.pending` へ非破壊追記してユーザー確認へ回す（実装者が単独で「許容」に倒さない）
- **`dataset_mode: static` では点検表の対象が静的データ形式になる**（フィールド構成・エンコーディング・日付表記・区切りとエスケープ・ファイル分割）。
  DB 固有の項目は「該当なし」と明記する（空欄にすると未点検と区別できない）
- **`setup` の下書きは上の点検項目を節として立て、現行 DB／新 DB の既定を埋める形にする**（下書きの生成と人間のレビューは上記「references（知識の注入）」）。
  節が無いと、その項目は「差が無い」ではなく「誰も見ていない」になる

## 実行対象環境（`targets`）

現・新の実行対象環境を環境名で複数定義し、各スキル実行時に `--target <name>` で選択する。local-dev / local-production / preview / develop など、同じスイートを当てる環境をここに並べる。

- **エントリ項目の意味論の正本は `browser-test` の `references/project-config.md`**（`url` / `url_command` / `pre_commands` / `start` / `check_urls` / `forbidden_actions` の意味と、
  実行順 `url_command` の解決 → `check_urls` で稼働判定 → 落ちているときだけ `pre_commands` → `start` → 再度 `check_urls`。最初の稼働判定の失敗は起動の合図で、それ以外の失敗は早期停止。ただし `forbidden_actions` の適用範囲は下記のとおり本ファイルが定義する）。
  本ファイルが定義するのは `side`・`api_url`・`db`・`auth`・`commit_check`・側ごとの `default`・選択規則・`on_diff`・parity 系での使い方
  （`auth` は browser-test の `auth: none | user` とは別物。扱いの正本は `parity-suite` の `references/auth.md`）
- **スキーマ不変条件**（各スキルは target 解決時に検証し、違反したら**停止**して設定修正を促す）:
  - `side` は必須（`current` | `new`。省略時の既定は無い——新側環境を追加するときの書き忘れが「正解＝現行」の原則を反転させるため）
  - `default: true` は側ごとに **1 つまで**。同じ側に複数あれば停止する（0 個は可——`--target` 省略時に候補を提示して確認する）
  - `url: none` の target に `default: true` を付けない（省略時の全実行が未開発環境に吸い寄せられるため）
  - 各 target は `url`（未開発は `none`）と `url_command` の**どちらか一方だけ**を持つ（両方あるのも、どちらも無いのも停止する）
  - `url_command` の target には `default: true` を付けてよい（`url: none` と違い実行可能な環境を指すため。解決に失敗すれば実行時に停止する）
  - `name` は小文字英数とハイフンのみで、**全 target を通して一意**（側をまたいだ同名も不可。成果物ディレクトリ名に使うため）
  - `db.seedable: true` の target は `db.env_vars` を持つ（接続先を知らずに投入はできない。`env_vars` 無しの `seedable` は停止する）
  - `dataset_mode: static` なら `dataset_static_paths` が 1 つ以上ある（無ければ書き込み範囲を限定できないため停止する）
  - `storage.seedable: true` の target は `storage.env_vars` と 1 つ以上の `storage.write_scope` を持つ（`db.seedable` と同じ fail-closed。欠ければ停止する）
  - `uses_storage` が `false`・欠落なのに `storage` を持つ target があれば停止する（宣言の矛盾を黙って解釈しない。使うなら `uses_storage: true` を書く）
  - `current.origin: received-assets` なら `current.received_assets` が 1 つ以上ある（受領資産の所在を知らずに再構築はできない。空・欠落は停止する）
  - **`side: current` の target が `url: none` を持てるのは `current.origin: received-assets` かつ再構築が未完了の間だけ**（`current-environment-bootstrap` が引き渡し時に実 URL と `default: true` を埋める）。
    `origin: managed` で `url: none` の current target は停止する——測定対象が無いまま `setup` が測定へ進む
- **`api_url`**: API の baseURL。UI と API が別 origin のときだけ指定し、省略時は `url` を使う（api-resource モードは現行応答を正に同一リクエストを新側へ送るため、UI とは別に選べる必要がある）
- **選択規則の正本は下記「選択規則」節**（各スキルは自分の対象側だけを宣言し、規則の全文はここだけが持つ）
- **`db` / `auth` / `forbidden_actions` は target ごとに定義する**（側の既定・フォールバックは持たない。複数 target で同じ値になる場合も各エントリに書く——共有したければ YAML アンカーを使ってよい。スキルキーを跨いだ共有の可否と制約は上記「設定ファイルの共有と YAML アンカー」）
- **`db` は「接続を知っている」、`db.seedable` は「シードしてよい」——2 段の契約**（`dataset_mode: db` のときの投入先解決の正本。`static` の扱いは下記「データセットの実体」）:

  | `db` の宣言 | 意味 | `golden-dataset` | 読み取り（バッチの出力一致検証など） |
  |---|---|---|---|
  | 未定義 | この target の DB にスキルは**一切触れない** | 投入対象外 | しない |
  | `env_vars` のみ | 読み取り専用接続 | 投入対象外 | する |
  | `env_vars` ＋ `seedable: true` | 投入してよい環境 | 投入対象（フェーズ A は `side: current`、フェーズ B は `side: new` の選択 target） | する |

  - **`seedable` は投入の設定由来ゲート**である。`golden-dataset` は自己申告の「本番でないことの確認ゲート」に加えてこのゲートを通す（安全弁を 2 枚にし、設定ミス・判断ミスの単一障害点を無くすため）。既定は deny——省略・`false` は読み取り専用として扱う
  - 同じ DB を複数 target が共有する場合も target ごとにフェーズ B を実行して記録する（投入ツールは冪等なので再実行は安全）
  - **投入対象外の target**（`db` 未定義／`seedable` なし）では、`parity-diff` はデータセットバージョンの三者整合（phase B との整合）を免除する代わりに
    「ゴールデンデータ未投入のため**データ依存の差分は実装差かデータ差か判別できない＝未検証**」を `diff.md` に明記する（実データを持つ配信型環境などを想定した宣言）
- **`auth` はロール構造**: `roles.<ロール名>` の下に `user_name_env` / `password_env`（値は環境変数の**名前**。他の要素は `<論理名>_env` で追加できる）。
  認可はそれ自体が仕様であり、ロール別の代表ユーザー・storageState の扱いは `parity-suite` の `references/auth.md` が正本。認証不要の環境では `auth` ごと省略する
- **`forbidden_actions` の適用範囲**: 対象は**アプリへの UI / API 操作**であり、`db` 経由の投入ツール（`golden-dataset`）には適用しない
  （投入の安全弁は上記 `db.seedable`〈`static` では `dataset_static_paths`〉と golden-dataset の「本番でないことの確認ゲート」の 2 枚が担う）。**空リストは「すべて実施可」、未定義は「読み取り専用」で意味が異なる**。
  書き込みを許可しない target では、parity 系はスイートの書き込み系スペックを実行せず「未検証」として記録する
- **ノイズ基準値は現側 1 環境の測定値**: `parity-suite` が current 側で測った `noise_baseline` を新側の全 target に流用できるとは限らない（CDN・フォント読み込み等で環境ノイズは変わる）。
  `parity-diff` は新側撮影時に自己ノイズを測って乖離が大きければ停止する（正本: `parity-diff` の `references/capture-new.md`）
- **URL の引き渡し**: 選択した target の UI / API URL は環境変数 `PARITY_CURRENT_UI_URL` / `PARITY_CURRENT_API_URL` / `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決し、
  Playwright の `current` / `new` プロジェクトの baseURL と API request fixture が一貫して使う（配線の正本は `parity-suite`）。
  `url_command` の target はコマンドを実行して得た URL を `PARITY_*_URL` へ解決する（失敗・空出力は停止する。基本意味論〈`url` との排他・停止〉の正本は
  `browser-test`、`PARITY_*_URL` への解決・`"runtime"` 記録は**本節が正本**）。
  **解決はスキル 1 実行につき 1 回**（target 解決時）とし、同一実行内の後続工程（疎通確認・撮影・API 発行）は解決済みの値を再利用する
  （工程ごとに再実行しない——実行中に解決先が変わると、疎通確認した環境と撮影・発行先の環境が乖離するため）。
  **解決した URL は成果物・ログへ書かず**、成果物（`metadata.json` / `replace-metadata.json` 等）の記録フィールドのうち **`url_command` で解決した値が入る箇所**に `"runtime"` を記録する
  （`api_url` は従来どおり任意の固定値で、固定値で指定していればその値を記録してよい。`api_url` を省略して解決後の UI URL を使う場合のみ `"runtime"` になる）。
  利用側スキルは `"runtime"` の箇所を記録値ではなく target 名から設定を引いて**再解決する**（別のスキル実行では改めて 1 回解決する）
- **成果物は新側だけ環境別**: `parity-replace` / `parity-diff` の成果物は `.replace/parity/<slug>/new/<target>/` に分離し、環境を切り替えても green 証跡・差分メタデータ・新側ベースラインを上書きしない
  （レイアウトの正本は各生産スキル）。現側は 1 環境で、`parity-suite` が `metadata.json` に選択した target 名を記録する（現側 target の変更はベースライン陳腐化として扱う）

### 選択規則（対象 target の決め方）

**本節が選択規則の正本**。各スキルは「自分がどちらの側を候補にするか」だけを自分のドキュメントで宣言し、下記の規則そのものは転記せず本節を参照する
（安全弁を含む規則が複数ファイルに散ると、正本の改訂が転記へ伝播せず乖離するため）。

- **候補は自分が対象とする側の target だけ**にする。どちらの側かは各スキルが定義する（`side` は設定の値であり、スキルの引数ではない）
- **`--target` 省略時**はその側で `default: true` の target を使う。無ければ候補を提示してユーザーに確認する（勝手に 1 つ選ばない）
- **スキルが追加の候補条件を持つ場合**（例: `golden-dataset` の `db.seedable: true`）、選ばれた `default` がその条件を満たさなくても
  **代わりの target を勝手に選ばない**。当該スキルの規定（停止するか、ユーザーに設定修正・別 target の指定を促すか）に従う
- **存在しない名前・側違いの名前は停止する**（勝手に読み替えない。設定に無い環境を「あるもの」として実行しないため）

### `on_diff`（要対応差分が出たときの対応）

環境ごとに「差分を見つけた後にどう動くか」は運用次第で異なり、手順の自由度が高い（先行環境での再テスト・commit と push・デプロイ反映待ち・Issue 起票など）。
そのため構造化キーでは持たず、**対応手順を書いた Markdown ファイルのパスを 1 つ持つ**（`references` と同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

- **省略時の既定挙動**: `parity-diff` は `diff.md` を差し戻し入力に同じ target の `parity-replace` へ渡し、`parity-replace` は修正して対象 target で再テストする
- ドキュメントには、この target で再テストする前に green を確認すべき環境、修正の反映手順（commit・push・デプロイ）、反映完了の確認方法、
  修正ループを回さず Issue を起票して停止する運用（マージ後デプロイ環境等）などを自由に書く
- **挙動を厳密にしたい手順は、ドキュメントからスクリプトへリンクし、スキルにそれを実行させる**（決定論的にしたい部分はスクリプトが担い、ドキュメントは手順の骨格と分岐を持つ）
- 解釈するのは `parity-replace`（修正後の再テスト・反映）と `parity-diff`（差し戻すか・起票するか）。従ったドキュメントのパスを成果物（`replace-metadata.json` / `diff-metadata.json`）に記録する。
  `side: current` の target に書かれた `on_diff` は読まれない（現側は修正対象ではないため。書いても無視される）
- **ガードレール**（on_diff ドキュメントの指示より優先する。順に）。**本節が一覧の正本**で、解釈するスキル（`parity-replace` / `parity-diff`）は転記せずここを参照する。
  **`on_diff` に従う前にこの一覧を読み、自スキルに関係する項目をすべて適用する**（「自分には関係なさそう」で読み飛ばさない）:
  - 各スキルの禁止事項・シークレット規律。特に**現行アプリ（current 側）への変更・操作を指示されても実行しない**（対象 target だけでなく**すべての target** の `forbidden_actions` を尊重する）
  - コード変更を伴う修正は、ドキュメントに commit・push の指示があっても**敵対的レビューを先に通す**（レビュー省略の経路にしない）
  - Issue 起票の指示は `issue-create` へ委譲する（`gh` で直接起票しない）
  - ドキュメントが参照する target 名は `targets` に実在することを実行前に検証し、無ければ停止する
  - `on_diff` のパスが解決できない（ファイルが無い）場合は設定不整合として**停止**する（既定挙動へフォールバックしない——安全弁ごと消えるため）

例（preview 用の on_diff ドキュメント）:

```markdown
# preview で要対応差分が出たとき
1. 修正後、local-dev と local-production で再テストして green を確認する
2. 修正を commit して push する（preview は push で自動デプロイされる）
3. `scripts/wait-preview-deploy.sh` で反映完了を待つ
4. preview で再テストする
```

## データセットの実体（`dataset_mode` / `dataset_static_paths`）

ゴールデンデータセットの実体が **DB にあるか、リポジトリ内の静的データにあるか**を宣言する。`golden-dataset` の投入先解決と、`parity-suite` / `parity-diff` の照合条件がここで分岐する。

| `dataset_mode` | データの実体 | フェーズ A の「投入」 | 投入の設定由来ゲート |
|---|---|---|---|
| `db`（既定・省略可） | 各 target の DB | `db.seedable: true` の `side: current` target へ削除 → 投入 | `db.seedable: true` |
| `static` | リポジトリ内の静的データ（JSON / Markdown / フィクスチャ等） | `dataset_static_paths` 配下へ投入ツールが**生成** | `dataset_static_paths`（配下以外へ書いたら停止） |

- **`static` では投入先 target に `db` を要求しない。** DB を持たない静的サイト等でもフェーズ A が成立し、`parity-suite` の「データ不足」差し戻し → フェーズ A 再実行（`version` +1 → ベースライン再取得）のループが回る
- **`dataset_static_paths` は投入ツールの書き込み範囲そのもの**である。生成・削除はこの配下だけに限り、外へ書こうとしたら停止する（`db` 側の `seedable` に対応する安全弁）
- `static` でも冪等・決定論・`version` 運用・フェーズ A / B の分割は `db` と同じ。フェーズ B は同じ論理データを**新側の静的データ形式へ写像して生成**し、投入先 target で現新一致を検証する
- **`dataset_mode` はプロジェクト単位で現・新の両側に適用する。** 片側だけ実体が異なる構成（現行は静的・新側は DB 等）は本契約では表現できない。
  そう判明したら（例: フェーズ B で新側の受け皿が宣言と違う実体だった）`golden-dataset` は片側だけ進めず、停止してユーザーに確認する

## ファイルストレージ（`uses_storage` / `targets[].storage`）

アップロードされたファイル・アプリが生成したファイルの置き場所（オブジェクトストレージ・共有ファイルシステム）を宣言する。

**`dataset_mode` とは直交する軸である。** `dataset_mode` が答えるのは「ゴールデンデータの実体が DB かリポジトリ内の静的データか」であり、
ストレージ利用の有無はそれと独立に 4 通り（DB あり×ストレージあり／なし、DB なし×ストレージあり／なし）ある。**`dataset_mode` に第 3 の値を足して表現しない。**

| キー | 階層 | 内容 |
|---|---|---|
| `uses_storage` | トップレベル（環境非依存） | アプリがストレージを使うか。既定 `false`。アプリの構造はプロジェクト単位の事実で環境では変わらない |
| `targets[].storage` | target ごと | その環境の接続（`env_vars`）・書き込み範囲（`write_scope`）・投入ゲート（`seedable`）・アップロード経路（`upload_route`） |

- **保持階層の規則**: **環境ごとに変わる値は target 側、リポジトリ相対で環境に依らない値はトップレベル**に置く。
  `dataset_static_paths` がトップレベルなのはリポジトリ内のパスで環境に依らないため、`db` / `storage` が target 側なのは接続先・バケットが環境ごとに違うためである
  （非対称に見えるが軸は 1 つ。新しいキーを足すときもこの軸で置き場所を決める）
- **3 段の契約**（`db` と同じ形。既定は deny）:

  | `storage` の宣言 | 意味 | 読み取り（出力ファイルの捕捉・保存結果の確認） | ゴールデンデータ投入 |
  |---|---|---|---|
  | 未定義 | この target のストレージにスキルは**一切触れない** | しない | しない |
  | `env_vars` のみ | 読み取り専用接続 | する | しない |
  | `env_vars` ＋ `write_scope` ＋ `seedable: true` | 書き込みを許可した環境 | する | **v1 では行わない**（下記） |

- **ストレージ実体へのゴールデンデータ投入は本スキル群の v1 スコープ外。** `storage.seedable: true` でも `golden-dataset` は投入せず、
  ストレージ実体に依存する検証は `gaps.md` に「ストレージ投入はスコープ外＝未検証」として**必ず記録する**（確認済みにしない）。
  理由は「スキルがセットアップも検証もできないものを選択肢として出さない」線引き（下記「成果物の保存先」と同じ）——投入はプロバイダ固有の SDK・認証・バケット構成に踏み込むため。
  **それでもキーを先に切るのは、宣言があることで「ストレージがあるのに未検証」を可視化するため**（`references` の空値の枠と同じ考え方）
- **`write_scope` は書き込み範囲の上限宣言**である。v1 でも、テストが生成物を消す・作る操作を持つ場合の適用範囲はこの配下に限る（外へ出たら停止する）
- **アップロード経路（`upload_route`）で検証対象が変わる**:

  | 値 | 経路 | 検証への影響 |
  |---|---|---|
  | `direct` | ブラウザ → アプリサーバ（multipart） | アップロード要求がアプリの API に現れる。API 特性化・record/replay の対象になる |
  | `presigned` | ブラウザ → ストレージへ直接 PUT（署名 URL 等） | **アプリサーバを通らないため API 特性化・record/replay の対象が変わる**（アプリ側に現れるのは署名発行 API だけ）。署名の有効期限・CORS・テスト環境からストレージへの到達性が前提になる |
  | `none` | アップロード経路を持たない | ファイル入力の特性化は対象外 |

  - **省略は「未確認」**として扱う。推測で `direct` と決めず、アップロードの特性化に入る前にユーザーへ確認して記録する
  - **現側と新側で `upload_route` が変わると、保存ファイル名（path）の命名規則も変わりうる**。これは意図的差異レジストリ（`intentional_diffs`）の対象であり、宣言が無いまま「許容」にしない
- **キーが無いプロジェクトに `setup` の再実行を要求しない**（本キーの導入前に `setup` を終えたもの）。`uses_storage` の欠落は `false`、`targets[].storage` の欠落は未宣言として扱う。
  ただし `uses_storage: true` なのに `storage` を宣言した target が 1 つも無い場合は、ストレージ依存の検証を**すべて未検証**として `gaps.md` に記録する（停止はしない）
- ファイルの取得経路・形式別の扱い・アップロード操作・解析ツールの正本は [`file-io.md`](file-io.md)、対応範囲の一覧は [`scope.md`](scope.md)（ここへ転記しない）

## 依存導入の方針（`references.dependency_policy`）

パッケージ導入の可否を縛る土台（ライセンス拒否リスト・供給網ポリシー・バンドルサイズ上限・公開からの経過日数による採用遅延・依存レビューの自動化）は、**持つリポジトリと持たないリポジトリがある**。
そのため方針の本文は設定に持たず、**方針ドキュメントのパスを 1 つ持つ**（`references` の他キーと同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

| 値 | 意味 | スキルの挙動 |
|---|---|---|
| パス | その方針に従う | 依存を決めるとき方針ドキュメントを読み、照らした結果を `.replace/dependencies.md` に記録する |
| `none` | 方針を持たないことをユーザーに確認済み | 方針照合は行わず、判断材料の確認と記録だけを行う（再確認しない） |
| キーが無い | 未確認 | 依存を決める前にユーザーへ方針の要否を確認し、結果をこのキーへ記録する（確認手順の正本は [`dependency-selection.md`](dependency-selection.md) の「土台の有無を前提にしない」） |

- **`none` と欠落を同一視しない**（「確認したうえで方針なし」と「まだ聞いていない」は別）
- **この 3 値の意味論は本節が正本。他ファイルへ転記しない**（参照側は要約と本節名だけを置く）
- 記録するのは確認したスキル（`setup` 完了後に本キーが要ると分かった場合も、`setup` の再実行を待たずに追記する）
- スキルは既定の拒否リスト・閾値・待機日数を持ち込まない。判断材料・工程の正本は [`dependency-selection.md`](dependency-selection.md)

## 移行（旧キーからの更新）

旧スキーマ（単一 URL・側ごとの DB／認証・単一リストの禁止操作・`static_analysis`・設定側のインスタンス例外）からは次の対応で移行する。**スキルは旧キーをフォールバックとして読まない**——旧キーを見つけたら、この移行手順を示して停止する。

**検出対象の旧キー一覧**（各スキルはこの一覧を参照して検出する。`current:` ブロック自体は新スキーマにも存在する〈`repo` / `stack`〉ため、ブロック単位ではなく**キー単位**で検出する）:
`current.url` / `new.url` / `current.db` / `new.db` / `auth.current` / `auth.new` / `static_analysis` /
`forbidden_actions`（**`skills.replace-strategy` 直下**の単一リスト。`targets[].forbidden_actions` は新スキーマの正規キーであり検出対象ではない）/
`component_diff_exceptions`（**`skills.replace-strategy` 直下**。slug 成果物へ移した。`component_diffs` は新スキーマの正規キーであり検出対象ではない）

**キー名が変わらない移行**（一覧では検出できないため**値の形で検出する**）: `verification_commands` の値がリスト（下記「`verification_commands` の形の変更」）／`db.env_vars` を持つが `seedable` の無い target（下記「`db.env_vars` の意味変更」）。
**これらには上記の「旧キーなら一律停止」を当てない**——停止するかは各サブ節が用途ごとに定める（例: `verification_commands` がリストのとき、`parity-replace` は停止し、品質担保が目的の側は記録して進む）。

| 旧 | 新 |
|---|---|
| `current.url` | `targets` に `side: current` のエントリを作り `url` へ（`default: true` を付ける） |
| `new.url` | `targets` に `side: new` のエントリを作り `url` へ（値が `none` の場合は `url: none` のまま移すが、**`default: true` は付けない**——動く target ができた時点で付ける） |
| `current.db` / `new.db` | 対応する側の各 target の `db.env_vars` へ（DB を**読んでよい環境にだけ**書く。書かない target の DB にはスキルは触れない）。**投入してよい環境にはさらに `db.seedable: true` を足す**（下記） |
| `auth.current` / `auth.new` | 対応する側の各 target の `auth.roles.<ロール名>.{user_name_env,password_env}` へ。旧フラットリストのどの変数がユーザー名／パスワードかは**名前から推測せずユーザーに確認**する。旧 `auth.new` が空リストだった場合は `auth` を省略のまま移行せず、`setup` で新側の認証情報を確認して埋める |
| `forbidden_actions`（単一リスト） | `side: current` の target の `forbidden_actions` へ。**新側 target には `forbidden_actions: []` を明示的に置く**（空リスト＝すべて実施可。未定義＝読み取り専用とは意味が異なる） |
| `static_analysis` | `verification_commands.full` へ（環境準備・起動が混ざっていたら target の `pre_commands` / `start` へ移す）。**移す前に各コマンドが全体走査かを確かめる**——差分限定のものは `full` に入れず `diff` へ置き、全体走査の起動形を `setup` で確認する（上記「走る範囲」） |
| `component_diff_exceptions`（設定側の単一リスト） | 要素の `slug` ごとに `.replace/parity/<slug>/component-diff-exceptions.json` へ分割する。**同一原因の要素は `reason` の複製を畳んで `component_diff_exception_causes[]` に 1 件立て**、各インスタンスは `reason` を捨てて `cause` で参照する（インスタンス件数は減らさない）。原因調査の経緯（YAML コメント等に溜まっているもの）は同ディレクトリの `component-diff-exceptions.md` の原因の節へ移し、`causes[].evidence` にその節を指させる。移行後、設定側のキーは削除する。スキーマの正本は `parity-diff` の `references/normalize.md`、2 ファイルの様式は同スキルの `assets/component-diff-exceptions-template.{json,md}` |
| 成果物レイアウト: `.replace/parity/<slug>/` 直下の `replace-metadata.json` / `diff.md` / `diff-metadata.json` / `baseline-new/` | `.replace/parity/<slug>/new/<target>/` へ移動する。`<target>` は旧 `new.url` から移行で作った `side: new` の target 名。移動後、`replace-metadata.json` の `new` に `target: <その名前>` を追記する |

- **target 名は一度決めたら変えない。** 現側 target 名の変更はベースライン陳腐化（全 slug の再取得）、新側 target 名の変更は `new/<target>/` 配下の証跡との不一致を生む。移行時は環境の役割が分かる名前（例: `current-test` / `local-dev`）を付ける

### `db.env_vars` の意味変更（`seedable` の明示要求）

`targets` スキーマ導入時は `db.env_vars` の存在が「接続を知っている」と「シードしてよい」を兼ねていたが、現在は `db.seedable: true` が投入対象の条件である（上記「`db` は『接続を知っている』…」）。キー名は変わらないため機械的には検出できない。

- `db.env_vars` を持つが `seedable` の無い target を投入先に選ぶと、`golden-dataset` は**投入せず停止する**（fail-closed）。投入してよい環境なら `seedable: true` を足し、読み取り専用のままでよければ投入先を変える
- 投入対象外になった target は `parity-diff` の三者整合（phase B との整合）免除対象になる（`diff.md` の未検証領域にデータ依存差分が積まれる）ため、**意図せず読み取り専用へ落ちていないか**を移行時に確認する

### `verification_commands` の形の変更（`full` / `diff` の 2 列化）

導入時は単一のコマンド列だったが、現在は**走る範囲**で `full` / `diff` の 2 列に分ける（上記「走る範囲」）。キー名は変わらないため、**値がリストか（旧）マップか（新）で検出する**。

| 旧 | 新 |
|---|---|
| `verification_commands:` の値がコマンドのリスト | `verification_commands.full` / `verification_commands.diff` のマップへ。**リストの中身を機械的に `full` へ移さない**——各コマンドが全体走査かを確かめ（起動形とスクリプトの引数の扱いを読む）、差分限定のものは `diff` へ振り分ける |

- **リスト形式は「走る範囲が未宣言」として扱う。** 完了判定に使う `parity-replace` は `full` が未設定のときと同じく**停止**し、確定を促す（未宣言を「全体」に倒すと、差分限定の結果が「全体で通った」と名乗る——この形の変更はその事故を塞ぐためのもの）。
  品質担保が目的の側（`golden-dataset` / `parity-suite` / `current-environment-bootstrap`）は停止せず、リスト形式であること（範囲未宣言）を成果物に記録して進む

## シークレットの扱い（スキル群共通のルール）

DB 接続情報もアプリの認証情報も、**スキルは環境変数から読む**。**環境変数をどう用意するかはプロジェクトの責務であり、スキルの外**とする。`.env`・シークレットマネージャのラッパー・CI のシークレットなど、あらゆる方式がこの一点に収束するため、プロバイダ非依存の契約はこれしかない。用意方法は `references.env_setup` のドキュメントに書く。

- **設定ファイルには変数名だけを持ち、値は持たない。** 設定ファイルはコミットされる前提であり、値を書けば事故になる
- **起動ラッパーを任意で受け取る**: `secrets.wrapper` の前置コマンドを、シークレットが要るコマンドの前に付ける。これでシークレットマネージャ系も**スキルが何も知らないまま**動く
- **接続確認を最初に行い、早期に失敗する**（全部やってから繋がらないと分かるのを避けるため）。現行 URL への疎通と、DB の環境変数が設定されていること（値は表示しない。`test -n "$VAR"` 相当の存在確認のみ）を確認する。
  失敗したら `references.env_setup` のドキュメント（あれば）を案内する
- **値をログ・標準出力・成果物に出さない**。**ユーザーが値を提示してきた場合も復唱しない**（コマンド例・説明文はプレースホルダ・環境変数名で置き換える。エコーバックも漏洩経路である）
- **プロバイダ固有の取得手順は対象外**（スキルがセットアップも検証もできないものを選択肢として出さない。成果物の保存先と同じ線引き）

## 成果物の保存先（`artifacts`）

- 選択肢は**スキルがセットアップと検証をできるものに限る**: `local`（既定・コミットしない）／`git`（容量増を警告する）／`git-lfs`（`git lfs` の導入確認と `.gitattributes` の設定まで面倒を見る）。
- **それ以外の外部保管は対象外**とし、選ぶ場合はユーザーがプロビジョニングと転送を行い、スキルは `metadata.json` にポインタを記録するのみで**検証しないことを明示する**。
- テキスト成果物（computed style・aria スナップショット・メタデータ・強度レポート・gaps）は**選択の余地なく Git**。小さく差分が読め、PR でレビューできるため。この設定が対象にするのは**スクリーンショット等の大きなバイナリ**だけ。
- ここで決めるのは既定値であり、`artifacts.overrides.<slug>` で**機能ごとに上書きできる**（`git-lfs` も `.gitattributes` がパス指定できるため機能単位で成立する）。上書きは `parity-suite` が受け取り、実際に選ばれた保存先を `metadata.json` に記録する。

## 意図的差異レジストリ（`intentional_diffs`）

「変えない（`keep`）」「変えてよい（`may_change`）」「保留（`pending`。測定結果で決める）」の 3 分類。カテゴリの例: テーブル名、項目名、API エンドポイント、フロント URL、リクエスト／ボディ構造、コンポーネント配置、ページ構成、ディレクトリ・ファイル名、関数名、変数名、ヘッダー、UI コンポーネント、型変換に伴う差異、リント起因の修正、HTML の id/name。

- **具体的な中身はプロジェクトごとに異なるため設定ファイルで管理し、スキルは分類の枠組みと運用ルールだけを持つ。**
- `keep` はレビュー可能性を買うための規律である（テーブル名・項目名・API・関数名を保つことで、`parity-replace` の旧新 diff レビューが成立する）。
- 下流スキルが実装中に発見した差異は、勝手に判断せずこのレジストリへ追記してユーザーに確認する（`parity-replace` の規約）。コンポーネントライブラリ由来の系統差（クラス／トークン単位の宣言）は `component_diffs` キーで扱う。
  宣言者は `parity-replace`（テーマで消せない構造差をユーザー確認の上で宣言）、利用者は `parity-diff`（比較の正規化に使う）。
  T が引けないインスタンス単位の例外は**設定ファイルではなく** `.replace/parity/<slug>/component-diff-exceptions.json` で扱い、宣言者は `parity-diff`（ユーザー承認の上で追記。スキーマ正本は同スキルの `references/normalize.md`）。
- **`pending` だけは書き手がスキル**である（`keep` / `may_change` は人間）。区分の正本は上記「キーの書き手とライフサイクル」。
