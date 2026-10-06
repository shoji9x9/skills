# プロジェクト設定の解決

現行と新側のリポジトリと URL、DB 接続、環境、禁止操作、成果物の方針、意図的差異レジストリ、references は、リポジトリごとに違う。
そのため、次の順で解決する。デフォルト値はスキルに埋め込まない。

1. 設定ファイル: `.config/skills/shoji9x9/skills.yml` に `skills.replace-strategy` があれば、その設定に従う。
2. リポジトリの探索: 設定が無ければ、`README.md`・`AGENTS.md`・`CLAUDE.md`・`CONTRIBUTING.md` から、現行アプリの URL・リポジトリ・DB の手がかりを推定する。推定した内容は、ユーザーに確認してから使う。
3. ユーザーへの確認: 解決できなければユーザーに確認する。`setup` モードの対話セットアップは、この確認を先に行い、結果を設定ファイルに記録する。

## 設定ファイル（`.config/skills/shoji9x9/skills.yml`）

`shoji9x9/skills` の配布物が、インストール先で読むプロジェクトの設定である。
このファイルは、人が確定させた方針の置き場所である。`gh skill update` はスキルのディレクトリの外にあるこのファイルに触れないので、設定は更新の後も残る。
スキルが書くキーは限られている（下記「キーの書き手とライフサイクル」）。作業中に件数が増え続ける台帳は、ここに置かない。

このキーは、姉妹スキル（`current-environment-bootstrap`・`golden-dataset`・`parity-suite`・`parity-replace`・`parity-diff`・`parity-component`）が直接読む共通の取り決めである。
キーの名前や構造を変えるときは、姉妹スキル側の参照も一緒に更新する。

```yaml
version: 1
skills:
  replace-strategy:
    current: # 現行アプリ（URL・DB・認証・禁止操作は、targets の side: current が持つ）
      repo: <owner/repo | ローカルパス | none> # コードを入手できるか。無ければ none
      stack: [] # 現行のスタック（バックエンドの言語・フロントのフレームワーク）。測定や対話で分かった値を記録する
      origin: managed # 現行のテスト環境の由来。managed（管理済みの既存環境。デフォルトで、キーが無いときも managed）| received-assets（受領した資産から自社で再構築する。下記「現行環境の由来」）
      received_assets: [] # origin: received-assets のときは必須（1 つ以上のパス）。受領した資産の置き場所。current-environment-bootstrap が棚卸しの入力として読む
      feedback_calls: # 移行元で、利用者に見える副作用を出す呼び出しの一覧（下記「フィードバック呼び出し」）。キーが無い＝未確認（parity-suite が確認して 1 回記録する）
        - id: toast # パターンの id（一意）
          regex: '\bshowMessage\s*\(' # 呼び出しの字面に一致する JavaScript の正規表現（ファイル全体に複数行モードで照合する。^ / $ は行頭・行末）
          kind: toast # 利用者に見える副作用の種類（toast / script / dialog など）
          example: "showMessage('Saved', 'success')" # regex が一致すべき実際の呼び出しの字面（検出されることの確認に使う）
    new: # 新側のアプリ（URL・DB・認証・禁止操作は、targets の side: new が持つ）
      repo: <owner/repo | ローカルパス> # 骨格をスキャフォールド済みのリポジトリ（骨格の選定はスキル群の対象外。下記「新側アーキテクチャ」）
      stack: [] # 新側のスタック（フレームワーク・バックエンドの構成・ORM など）。事前に決まっているものを、setup の対話で記録する（current.stack と対称）
    targets: # 現行と新側の実行対象環境。複数を定義し、各スキルの --target <name> で選ぶ（下記「実行対象環境」）
      - name: current-test # 環境名。小文字の英数字とハイフンで書き、全 target を通して一意にする（--target の指定と成果物のディレクトリ名に使う）
        side: current # current | new。必須（省略したときのデフォルトは無い。無ければ停止する）
        url: <URL> # UI の baseURL。current 側では、測定と特性化の対象環境（本番ではないテスト環境）
        api_url: <URL> # API の baseURL。UI と別の origin のときだけ書く（省略すると url を使う）
        # browser: # 利用者環境で起動したブラウザ（デバッグのポートを開いた Chromium 系）に接続して撮るときだけ書く（下記「実行対象環境」の browser）
        #   cdp_url: http://<利用者環境のホスト>:9222/ # 省略すると、Playwright が起動したブラウザで撮る
        db:
          env_vars: [CURRENT_DB_URL] # この環境の DB の接続情報を持つ環境変数の「名前」。値は書かない。書いた target だけ、スキルが接続を読んでよい（書かない target の DB には、スキルは一切触れない）
          seedable: true # true のときだけ golden-dataset の投入先になる。省略か false なら読み取り専用の接続（接続は読むが、削除と投入はしない）
        storage: # この環境のファイルストレージ（アップロード先・ファイルの出力先）。書かなければ、この target のストレージにスキルは一切触れない（下記「ファイルストレージ」）
          env_vars: [CURRENT_STORAGE_ENDPOINT] # 接続情報を持つ環境変数の「名前」。値は書かない（db と同じ決まり）
          write_scope: [] # 削除・生成してよい範囲（パス、または <bucket>/<prefix>）。空か未定義なら書き込めない
          seedable: false # ゴールデンデータの投入を設定で許すか（デフォルトは許さない）。true でも投入はしない（投入はスコープ外）
          upload_route: direct # direct（アプリサーバを通る multipart）| presigned（ブラウザがストレージに直接 PUT する）| none（アップロードの方法が無い）。省略は未確認で、推測せずに確認する
        auth: # この環境の認証情報。ロールごとに環境変数の「名前」を持つ（認証が要らない環境では省略する。ロールが 1 つならそれだけでよい）
          roles:
            admin:
              user_name_env: CURRENT_ADMIN_USER # ユーザー名を持つ環境変数の名前
              password_env: CURRENT_ADMIN_PASS # パスワードを持つ環境変数の名前。他の要素は <論理名>_env で足せる（例: totp_secret_env）
            approver:
              user_name_env: CURRENT_APPROVER_USER
              password_env: CURRENT_APPROVER_PASS
        forbidden_actions: # この環境で行わない UI / API の操作（db.seedable を通る投入ツールには当てない。空リスト = すべて行ってよい、未定義 = 読み取り専用）
          - データの削除
        default: true # --target を省いたときに使う target。側ごとに 1 つ（同じ側に複数あれば停止する）
      - name: local-dev
        side: new
        url: <URL> # UI の baseURL。開発の前は none でもよい。その場合は、この例の下にある default: true を外す（url: none の target に default を付けない）
        api_url: <URL>
        db:
          env_vars: [NEW_DB_URL]
          seedable: true
        storage:
          env_vars: [NEW_STORAGE_ENDPOINT]
          write_scope: []
          seedable: false
          upload_route: presigned # 現行側とアップロードの方法が違う場合は、保存 path の命名規則の差も含めて、意図的差異レジストリの対象になる（下記「ファイルストレージ」）
        auth:
          roles:
            admin:
              user_name_env: NEW_ADMIN_USER
              password_env: NEW_ADMIN_PASS
        forbidden_actions: []
        pre_commands: [] # start の前に要る環境準備のコマンド（build など）。起動が要るときだけ実行し、失敗したら停止する
        start: <コマンド> # 長く動き続ける起動コマンド（稼働していないときだけ実行する。稼働の判定は check_urls で行う）
        check_urls: [] # 稼働の確認に使う URL（省略すると url だけを使う）
        default: true
      - name: develop # 例: PR のマージの後に自動でデプロイされる環境（実体は開発環境。実データを持つなら seedable を書かず、読み取り専用にする）
        side: new
        url: <URL>
        db:
          env_vars: [DEVELOP_DB_URL] # seedable を書かない＝読み取り専用。バッチの出力の一致の検証などで DB の状態は読むが、削除と投入はしない
        auth:
          roles:
            admin:
              user_name_env: DEVELOP_ADMIN_USER
              password_env: DEVELOP_ADMIN_PASS
        catalog_url: <URL> # 任意（side: new だけ。catalog_url_command と同時には書けない）。部品カタログの baseURL（固定の文字列）。parity-component の build が読み、どちらも無ければ推測せずに停止する
        # catalog_url_command: <コマンド> # catalog_url と同時には書けない。標準出力に URL を 1 行出す（url_command と同じ解決と記録の規則）
        commit_check: <コマンド> # 任意。稼働中の新側のコミットの SHA を標準出力に出す（start を持たない配信型の target で、parity-replace が軽い判定に使う）
        on_diff: <path> # 任意。この target で要対応の差分が出たときの対応手順を書いた Markdown のパス（下記「on_diff」。無ければデフォルトの動作）
      - name: preview # 例: ブランチに連動するプレビュー環境（URL がブランチ名で変わり、固定の文字列で書けない）
        side: new
        url_command: <コマンド> # url と同時には書けない。標準出力に URL を 1 行出す（意味の原本は browser-test。parity 系での解決と記録の規則は下記「URL の引き渡し」）
        auth:
          roles:
            admin:
              user_name_env: PREVIEW_ADMIN_USER
              password_env: PREVIEW_ADMIN_PASS
        forbidden_actions: []
        commit_check: <コマンド>
    secrets:
      wrapper: "" # 任意の起動ラッパー（例: aws-vault exec dev --）。シークレットが要るコマンドの前に付ける
    parity_suite_dir: e2e/ # パリティスイートの置き場所（parity-suite が読む。省略すると e2e/）
    dataset_tool_dir: seed/ # golden-dataset の投入ツールの置き場所（golden-dataset が読む。省略すると seed/）
    bootstrap_tool_dir: bootstrap/ # current-environment-bootstrap の再構築ツールと暫定の起動データの投入ツールの置き場所（省略すると bootstrap/）。current.origin: received-assets のときだけ使う
    dataset_mode: db # ゴールデンデータセットの実体（下記「データセットの実体」）。db（デフォルトで、省略してよい）| static
    dataset_static_paths: [] # dataset_mode: static のときは必須。投入ツールが生成・削除してよいパス（これ以外に書いたら停止する）
    uses_storage: true # アプリがファイルストレージ（オブジェクトストレージ・共有ファイルシステム）を使うか。デフォルトは false で、false か省略なら targets の storage も書かない（下記「ファイルストレージ」）。dataset_mode とは独立した別の軸
    verification_commands: # 検証コマンド（静的解析・単体テスト・統合テストなど。固有のツール名は設定の側に置く）。実行する範囲で 2 列に分ける（下記「検証コマンド」）
      full: # 全体の走査。リポジトリ全体を見るコマンドだけを置く（引数の有無は問わない。全体を走査するかで判断する）。parity-replace の完了判定はこの列で行うので、setup で必ず確定する
        - <コマンド> # 環境の準備・起動・URL の解決は含めない（それらは targets の pre_commands / start / check_urls）。環境に依存しないコードの検証なので、どの target でも同じコマンドを実行する
      diff: # 任意（無ければ省略するか空リスト）。変更したファイルだけを受け取る安い列。実装の反復と、敵対的レビューの前の早い検出にだけ使い、完了判定には使わない
        - <コマンド> {changed_files} # {changed_files} は、実行するスキルが変更したファイルの一覧に展開する
    artifacts:
      retention: latest # 作業ツリーには最新だけを置く。履歴は Git が持つ
      storage: local # local（デフォルトで、コミットしない）| git | git-lfs — 大きなバイナリのデフォルトの保存先
      size_threshold_mb: 50 # 超えたら警告する
      overrides: {} # 機能ごとの上書き（例: order: git-lfs）
    references: # 利用者が選ぶ知識の注入。パスだけを持つ（本文はファイルの側）。setup がすべてのキーを作り、決まらないキーは空の値で残す（下記「references（知識の注入）」）
      architecture: "" # 新側のアプリの骨格の決定記録（レイヤとディレクトリの構成・API の設計方針・ホスティングとリリースの構成・実行基盤と使うマネージドサービス）。事前に決めてあることが前提で、setup は下書きを作らない（parity-replace / parity-component が実装の工程の前に読む。下記「新側アーキテクチャ」）
      coding_conventions: "" # 生成先のリポジトリのコーディング規約（命名・エラー処理・テストの書き方・レビューの観点）。骨格の「上」の書き方で、architecture とは別（parity-replace / parity-component / golden-dataset / parity-suite が生成物を書くときに読む。生成物ごとの読む先は下記「コーディング規約」）
      ui_library: "" # 新しい UI ライブラリの設定と、旧→新の design token の対応づけ（parity-replace / parity-diff / parity-component が読む）
      component_catalog: "" # 部品カタログの取り決め（実体・見本の書き方・URL の決まり方・データの注入方法）。共通部品を画面より先に作る方針のときだけ使う（parity-component の build が読む。下記「部品カタログ」）
      db_semantics: "" # 現行 DB から新 DB への型の対応と意味の差、および移植で踏む方言の差の点検表（parity-replace が実装の前に読み、golden-dataset / parity-suite / parity-diff が比較で読み、current-environment-bootstrap が整備済みのときに復元した項目の突き合わせで読む。下記「DB 意味論」）
      env_setup: "" # 環境変数の用意の仕方（全スキルが、接続の確認に失敗したときの案内先にする）
      dependency_policy: <path | none> # 依存を入れるときの方針（ライセンス・供給網・バンドルサイズの上限など）。方針が無いことをユーザーに確認済みなら none（下記「依存導入の方針」）
      # キーは足せる（下記「references の拡張」の取り決めに従う）
    intentional_diffs: # 意図的差異レジストリ
      keep: [] # 変えない（例: テーブル名、項目名、API のエンドポイント、関数名）
      may_change: [] # 変えてよい（例: ディレクトリ名・ファイル名、HTML の id/name、型の変換に伴う差、静的資産を同等のもので置き換えたときに残る差〈.replace/assets.md の宣言の列と同じ文言〉）
      pending: [] # 保留（測定の結果で決める）。setup では、キーを必ず空リストとして作る（スキルが追記する記録なので、初めは空。キーだけを書いて値を省くと null になり、判定ツールが「配列でない」として失敗する）。設定ファイルの中で唯一、スキルが作業中に追記する記録である（下記「キーの書き手とライフサイクル」）。確認の後に、人が keep / may_change へ移す。**setup 自身が書き出す保留（手順 8 の「保留（測定結果で決める）」）も、このキーに下の 4 キーの形で追記する**（空リストはキーの初めの値の決まりで、setup が何も書かないという決まりではない。added_by: replace-strategy / slug: cross-cutting）
        # 追記する要素は、追記元が分かる形で書く（要素の形の原本は下記「意図的差異レジストリ」の「`pending` 要素の形」）。素の文字列も読めるが、帰属が分からないものとして扱われる
        # - item: <散文の宣言>                 # keep / may_change へ移すときは、この文言を移す（要素を突き合わせる鍵）
        #   slug: <機能 slug | cross-cutting>  # 追記した機能。帰属できるなら slug を書き、1 つの機能に帰属させられないときだけ cross-cutting にする（部品の slug は書かない。parity-component と replace-strategy は必ず cross-cutting）
        #   added_by: <replace-strategy | golden-dataset | parity-suite | parity-replace | parity-component>
        #   added_at: <YYYY-MM-DD>
        #   match: { element: <論理名 | glob>, property: <プロパティ | glob> }  # 任意。特性照合の差分に当てる照合キー（下記「照合キー（`match`）」）
      # keep / may_change の要素も「- item: <散文> ＋ match: {...}」のオブジェクトにできる（照合キーを持たない散文は、理由を添えても差分に当たらない）
      # ↑ 書き手がスキルであることは、設定から出す理由にならない（slug をまたぐので、ここに残る。同じ節の段 1 と段 2 を参照）
      # append-only-check.mjs に同梱の一覧は、keep / may_change / pending を 1 つのグループとして、
      #   要素の単位に展開する（registry_groups。照合キーは item）。棚卸しで人が pending の文言を
      #   keep / may_change へ移すのは通るが、**どの鍵にも無くなった要素は失敗にする**（警告なしに消せない）。
      #   キーごと消しても失敗にする。付随するフィールド（slug / added_by / added_at）は、移動先に無いので単位から外れる。
      #   **一覧をプロジェクトにコピーして --manifest で渡している場合は、コピーにも同じ registry_groups を入れる**
      #   （入っていないと、棚卸しのたびに exit 1 になる）。そのときも **[] を元に戻してはならない**。
      #   元に戻すと、記録した保留が消える。検査の指摘を報告して先へ進み、一覧のコピーを直す。
      #   フロー形式のコンテナ（[...] / {...}）は **1 行で書く**。折り返す場合も、閉じ括弧までを同じキーの
      #   ブロックに収める（読み手が続きの行をつなげるのは、名指しした鍵の値だけ。途中の空行とコメント行は
      #   またぐが、閉じないまま兄弟のキーやリストの要素に出る形と、文書が終わる形は読めない）。読めないと行のまま
      #   突き合わせるので、**要素を足しただけの編集が縮小として判定される**。
      #   そう指摘されたときも **[] を元に戻さず、閉じ括弧を足して閉じ直す**（1 行に畳まない。
      #   component_diffs は要素の行の注記も単位なので、畳むとその単位が消えて失敗にする）。
      #   **比較元（commit 済みの版）に閉じていないコンテナがあると、どう直しても通らない**。
      #   検査はその旨を出すので、表記を直したうえで、内容を人が確かめて通す
      #   （今の版で別の鍵のコンテナも閉じていなければ、そちらは閉じ直す案内として一緒に出る）。
      #   折り返したときの**注記は、鍵の行か閉じる行に置く**。keep / may_change / pending は、要素の行に付いた
      #   行末の注記を単位にしない（移動先に置き場所が無く、ブロック形式でも単位にしていない）ので、
      #   鍵の注記を要素の行に移すと、単位が 1 件減って失敗にする。独立したコメント行は、どちらでも単位に残る。
    component_diffs: [] # コンポーネントの系統差のレジストリ。クラス/トークン × プロパティの単位の系統差 T（旧値→新側で期待される値）。parity-replace がテーマで消せない構造の差をユーザーの確認を経て宣言し、parity-diff が比較の正規化に使う（特性照合にだけ当たる。当てる対象の原本は parity-diff の references/normalize.md）。要素の形の原本はこのファイルで、{ component, property, current, new, reason } である。component は照合キーで、対象の要素の論理名（`*` を含めれば glob）を書く。無いか空の値は、すべてに合うものではなく不一致として扱い、照合に使わない（照合の方法の原本は parity-diff の references/normalize.md）
    # ↑ component_diffs も要素ごとの単位に展開されるので、フロー形式の書き方は intentional_diffs と同じ制約に従う
    #   （1 行で書く。折り返すなら、閉じ括弧までを同じキーのブロックに収める。上の注記を参照）
    # T を当てられない箇所のインスタンス単位の例外は、設定ファイルに置かない（slug スコープの台帳なので .replace/parity/<slug>/component-diff-exceptions.json に置く。スキーマの原本は parity-diff の references/normalize.md）
```

references の扱いは、下記「references（知識の注入）」に従う。

### 作成・追記は非破壊

ファイルが無ければ、`.config/skills/shoji9x9/` ごと作り、このスキルが使うキー（`skills.replace-strategy`）だけを書く。
書く値は、探索かユーザーへの確認で得た実在の値にする。上の URL・変数名・コマンドは例なので、そのままコピーしない。
ファイルが既にあれば、欠けたキーだけを該当する節に追記し、既にあるキー・値・コメントは変えない。値が既にあれば、それを尊重して上書きしない。

## キーの書き手とライフサイクル

設定ファイルは、人が確定させた方針の置き場所である。
スキルが作業中に増やし続ける記録を同じファイルの末尾に追記すると、PR の差分で「環境の設定の変更」と「作業中に見つけた差の記録」を区別できない。
機能のブランチを並行させると、衝突も起きる。
書き手の区分の原本はこの節で、各スキルの設定キーの表は、ここに転記しない。

判断は、独立した 2 つの段で行う。
2 つを混ぜると、「書き手がスキルだから設定から出す」という誤った結論になり、`intentional_diffs.pending` の扱いを間違える。

| 段 | 問い | 決めるもの |
|---|---|---|
| 1 | そのキーが設定ファイルに載るか | slug スコープで、かつ作業中に件数が増え続ける台帳なら載せない（slug の成果物に置く。下記の 3 つ目の箇条） |
| 2 | 載るキーが下の表のどちらの区分か | 書き手（人が確定させるか、スキルが作業中に追記するか） |

| 区分 | キー | 書き込み |
|---|---|---|
| 人が確定させる方針 | `current`（`origin`・`received_assets`・`feedback_calls` を含む）・`new`・`targets`・`secrets`・`parity_suite_dir`・`dataset_tool_dir`・`bootstrap_tool_dir`・`dataset_mode`・`dataset_static_paths`・`uses_storage`・`verification_commands`・`artifacts`・`references`（パス型のキー）・`intentional_diffs.{keep,may_change}`・`component_diffs` | `setup` の対話で書くか、人が直接編集する。スキルが代わりに書く場合も、人が決めた値を 1 回記録するだけである。該当するのは次のものである。`references.dependency_policy`・`new.stack`・`references.architecture`・`current.feedback_calls` の確認の結果。`current-environment-bootstrap` が引き渡しのときに埋める現行 target の `url` と `default: true`（ユーザーが確認した実測値を 1 回記録する）。`component_diffs` のユーザーが承認した宣言（`parity-replace`・`parity-diff` が非破壊で追記する）。静的資産で `同等物を作る` を選んだときの、`intentional_diffs.may_change` へのユーザーが承認した宣言（`replace-strategy` の `setup`・`parity-replace`・`parity-component` が非破壊で追記する。原本は [`static-assets.md`](static-assets.md)）。どれも `setup` の再実行を待たずに追記する |
| スキルが作業中に追記する記録 | `intentional_diffs.pending` | 宣言に無い差を見つけたスキルが、追記元が分かる形で非破壊で追記する（要素の形は下記「意図的差異レジストリ」の「`pending` 要素の形」）。追記するのは `replace-strategy`（`setup` の手順 8 で「保留（測定結果で決める）」にした項目）と、`golden-dataset`・`parity-suite`・`parity-replace`・`parity-component` である。ユーザーの確認を経て、人が `keep` / `may_change` へ移す。設定ファイルに残る唯一の作業中の記録である。移す時期は下記「`pending` の棚卸し」で決まっていて、機能を閉じる工程（`parity-diff` の収束の判定）が棚卸しを求める |

- `component_diffs` を設定の側に残す根拠: 要素は `component` × `property` の単位で、slug をまたいで当たる。
  1 回の宣言が、`component` に glob を書けばすべての slug とインスタンスに当たる（`parity-diff` の適用の順序の 2）。
  slug ごとに分けると、同じ宣言を slug の数だけ複製することになるので、slug の成果物の側へは移さない。
- `intentional_diffs.pending` を設定の側に残す根拠: `keep` / `may_change` と同じ 3 分類の 1 つで、確定させる作業は同じキーの中で人が移すことである。
  さらに slug をまたぐので、置くべき slug のディレクトリが無い。
  つまり段 1 の条件（slug スコープ）を満たさないので、設定に残る。
  書き手がスキルであることは、段 1 の判断の材料にならない。それは段 2 で、上の表の下の段に置く理由になるだけである。
- 新しいキーを足すときは、段 1、段 2 の順で判定する（載せると決めたものだけを、上の表のどちらかに置く）。
  段 1 で除くのは、作業中に件数が増え続ける slug スコープの台帳である。これは設定ファイルに置かず、slug の成果物（`.replace/parity/<slug>/`）に置く
  （下流のスキルの成果物の形式は、各スキルが定める。[`../SKILL.md`](../SKILL.md)「成果物」）。
  例として、`parity-diff` のインスタンス単位の例外は、設定のキーから `.replace/parity/<slug>/component-diff-exceptions.json` へ移した（下記「移行」）。

## 設定ファイルの共有と YAML アンカー

設定ファイルは、すべてのスキルが 1 つのファイルを共有する（`skills.<スキル名>` で、スキルごとのキーに分かれる）。
スキルのキーをまたいで YAML のアンカーを共有することは認める。
同じ URL・環境変数名・環境の定義を複数のスキルに書き写すと、二重に管理することになるからである
（例: `skills.replace-strategy.targets` と `skills.browser-test.environments` で、同じ環境の定義を共有する）。

ただし、アンカーはファイルの中でしか解決できない。そのため、共有には次の制約がある。
設定ファイルの分割や置き場所の変更を提案・実施するときは、先にこの制約を確かめる。

- スキルのキーをまたいでアンカーを共有している間は、設定ファイルをスキルごとのファイルに分割できない（alias の解決先が無くなる）。
  分割するなら、先に共有をやめて、それぞれの場所に実体を書く。
- アンカーは、参照より前に定義しておく必要がある。
  「作成・追記は非破壊」に従って追記するときは、アンカーを定義した位置を動かしたり消したりしない（末尾に足すだけなら安全である）。
- アンカーの定義を持つスキルのキーを削除・移動するときは、先に参照する側を実体にする（削除して初めて動かなくなることを避ける）。
- 値の意味は、参照する側のスキーマに従う。
  アンカーを通して他のスキルのキーの値を読むことになるが、定義した側のスキルの意味を持ち込まない
  （例: `browser-test` の `auth: none | user` と、このファイルの `auth.roles` は別のものである。原本はそれぞれ参照する側にある）。

## references（知識の注入）

利用者が選ぶプロジェクトの知識を、パスで注入するキーである。
1 つのキーを複数のスキルが読むので、スキルごとに持たず、`replace-strategy` に集める。

- `setup` は、パス型のキー（`architecture`・`coding_conventions`・`ui_library`・`db_semantics`・`env_setup`）をキーごと作る。
  その時点でパスが決まらないキーは、空の値（`""`）のまま置き、どのスキルがいつ読むかをコメントに残す。
  枠を作るのは、整備されていないことを `setup` の時点で見えるようにするためである。下流が止まらないようにするためではない。
  整備されていなければ止まるのは、正しい動作である（キーごと無いと、下流のスキルが止まって初めて足りないことが分かる）。
- `component_catalog` は、共通部品を画面より先に作る方針を採ったときだけ作る。
  その方針を採らないプロジェクトは `parity-component` を使わないので、枠を置いても読む人がいない
  （読む人のいない空の枠は、埋めるべきかどうかの判断を増やすだけである）。
- `dependency_policy` は空の値で作らない。
  このキーだけは、キーの有無が「未確認」を表す三値である。空の値の枠を置くと、下流の「キーが無い＝未確認なら確認する」が二度と起きない。
  `setup` は、方針が要るかをユーザーに確認し、パスか `none` を書く。確認まで進まなければ、キーごと書かない（下記「依存導入の方針」）。
- 空の値の references のキーは、未設定の枠である。上の「作成・追記は非破壊」の言う既にある値には当たらない。
  実際のパスが決まった時点で、空の値を実際のパスで埋めるのは、上書きに当たらない（非破壊で守るのは実際の値で、空の枠ではない）。
- キーが無い、空の値、解決できないパスは、どれも「整備されていない」として扱う。
  そのキーを前提にする工程は、内容をでっち上げず、下の表の「整備されていないときの動作」に従う。
  止まるのは、止まると書いた工程だけである。表に無い工程は止まらず、判断の材料が無いことを推測で埋めずに、未確定として記録する。
- references のファイルそのものは、人が書くプロジェクトの知識である。ただし、`setup` が DDL・測定の結果・技術スタックから下書きを作り、人がレビューして確定させる（特に `db_semantics` は専門的なため）。
  `architecture` だけは下書きを作らない。骨格の下書きを作ることは、実質的にスキルが骨格を決めることになるからである（下記「新側アーキテクチャ」）。
- references は知識の注入であって、検証の代わりではない。
  注入した差（例: 現行 DB の空文字と NULL の扱い、collation による並び順）は意図的差異レジストリに書き、実際の検証は `golden-dataset`（フェーズ B の一致の検証）と `parity-suite`（API の並び順の特性化）が行う。

| キー | 読むスキルと工程 | 整備されていないときの動作 |
|---|---|---|
| `architecture` | `parity-replace` の部品の採否と実装の工程（手順 3 以降）。`parity-component` の `build`（前提の検証。共通部品の実装先が骨格の上に載るため）。依存を決めるすべてのスキルの、ランタイムの制約の判断 | `parity-replace` と `parity-component` は、部品の採否と実装に入らずに止まる（骨格を推測すると全機能・全ページに影響し、後戻りが最も高くつく）。ただし、新側のリポジトリに骨格が既に実装されていれば、実態から読み取った内容を下書きとして示し、ユーザーが確定させてから進む（既にある実装を読み取るのは記述であって、決定ではない）。依存を決める側（`parity-suite`・`parity-diff` など、実装の工程を持たないスキル）は止まらないが、実行基盤の制約を推測で埋めない。ユーザーに確認してから候補を絞る（[`dependency-selection.md`](dependency-selection.md)「判断材料」の実行基盤の行） |
| `coding_conventions` | 対象のプロジェクトの側にコードを書くすべてのスキル。`parity-replace` の実装の工程と敵対的レビュー、`parity-component` の `build`（部品の実装と見本）、`golden-dataset` の投入ツールの生成、`parity-suite` のスイートの作成、`current-environment-bootstrap` の再構築ツールと暫定の起動データの投入ツールの生成 | 止まらない（規約を持たないリポジトリもあるため）。ただし、自分の流儀を推測で持ち込まない。生成先のリポジトリ（新側とは限らない。下記「コーディング規約」の対応表）の既にあるコードと基底ドキュメントから読み取れる範囲に従い、整備をユーザーに促す |
| `ui_library` | `parity-replace` の手順 6「見た目の系統差を源流で縮める」、`parity-diff` の正規化（系統差の判断の材料）、`parity-component` の `build`（同じテーマの調整を部品に対して行う） | `parity-replace` と `parity-component` は、テーマの調整に入る前に整備を促す（系統差を上流で縮められず、宣言と未検証が増える）。`parity-diff` は止まらないが、判断の材料が無いまま「許容」と判定しない |
| `component_catalog` | `parity-component` の `build`（見本を置く前と、カタログを採取する前に読む） | `parity-component` は `build` に入らずに止まる（カタログの実体・URL の決まり方・データの注入方法を推測で決めると、別のカタログに移した時点で、見本と採取のスペックの両方を書き直すことになる）。`capture` は読まないので止まらない。下記「部品カタログ」 |
| `db_semantics` | `parity-replace` の実装（手順 4。クエリとデータアクセスを書く前に、移植の点検表として読む）、`golden-dataset` のフェーズ B（新側への変換と、現行と新側の一致の検証）、`parity-suite` の並び順の特性化、`parity-diff` の並び順の差の判断、`current-environment-bootstrap` の復元した項目の突き合わせ（整備済みのときだけ） | フェーズ B は止まる（変換の根拠が無い）。`parity-replace` は止まらないが、方言の差を推測で埋めない。下記「DB 意味論」の点検項目を、現行 DB と新 DB の一次ドキュメントで確かめ、結果を `porting.md` に記録し、整備を促す。`parity-suite` と `parity-diff` も止まらない（実測で特性化し、整備を促す） |
| `env_setup` | すべてのスキル。接続の確認（現行 URL への疎通と、環境変数があるかの確認）に失敗したときの案内先 | 案内先が無いだけで、止まらない |
| `dependency_policy` | 依存を決めるすべてのスキル（`replace-strategy`・`parity-suite`・`parity-replace`・`parity-diff`・`parity-component`） | 三値なので、下記「依存導入の方針」に従う（キーが無い＝未確認として、方針が要るかをユーザーに確認して記録する） |

### references の拡張（新しいキーを足すとき）

`references` にはプロジェクト固有の知識を足せるが、キーを足しただけでは誰も読まない。
上の表に行が無いキーは、下流のスキルにとって存在しないのと同じである。
そのため、キーを足すときは、上の表への追記と一緒に行う（片方だけを足したら、未完了として扱う）。

- 上の表に、「読むスキルと工程」と「整備されていないときの動作」の行を足す。
  工程は、いつ読むかが分かる細かさで書く（「実装で読む」ではなく「`parity-replace` の手順 3 以降」）。
- 整備されていないときの動作では、止まるか、止まらずに整備を促すかを必ず決める。
  決めないと、下流は判断の材料が無いまま推測で埋めることになる。
- 止めるのは、推測が全機能・全ページに影響して後戻りが高くつくキーだけにする（`architecture` と、フェーズ B の `db_semantics` がこれに当たる）。
- パス型のキーは、空の値（`""`）で枠を作る。
  三値（キーの有無が「未確認」を意味する）にするのは、方針を持たないこと自体が判断を変える場合だけである（`dependency_policy` がこれに当たる）。
- 足したキーを読むスキルの側にも、そのスキルの「プロジェクト設定の解決」のキーの表に行を足す。

## 現行環境の由来（`current.origin` / `current.received_assets`）

測定の対象になる現行のテスト環境が、既にあるのか、これから建てるのかを宣言する。
スキル群のすべての工程は、動いている現行アプリが正解であることを前提にしている。
そのため、この 1 つの分岐で、以降のすべての比較が正しい基準の上に乗るかどうかが決まる。

| 値 | 意味 | `setup` の動作 |
|---|---|---|
| `managed`（デフォルト） | 自社で管理している、動くテスト環境がある | 対話セットアップのすぐ後に、測定へ進む |
| `received-assets` | 先方から受け取った資産だけがあり、比較の基準になる環境をこれから自社に再構築する | 測定の前に `current-environment-bootstrap` に任せ、引き渡しが終わるまで測定へ進まない |

- キーが無ければ `managed` として扱う。キーが無いプロジェクトに、`setup` の再実行を求めない
  （このキーを入れる前に `setup` を終えたプロジェクトは、動く現行環境が既にあったから測定を終えられている）。
- `received-assets` は、コードだけを受け取ったことを指すのではない。
  判定の軸は、測定できる環境が動いているかであり、コードを入手できるか（`current.repo`）とは別の軸である
  （コードがあっても環境が無ければ `received-assets`、コードが無くても動く環境があれば `managed`）。
- 由来を推測で決めない。設定に現行アプリの URL を書けることは、その URL に届くことの証拠にならない。`setup` の手順 2 でユーザーに確認して記録する。
- `current.received_assets` は 1 つ以上のパスである。受け取りが複数回に分かれる場合は追記する（`current-environment-bootstrap` が、棚卸しですべてのパスを走査する）。
- 再構築するのは `current-environment-bootstrap` で、`replace-strategy` は代わりにしない。
  そのスキルの成果物（`.replace/bootstrap/`）とツールの置き場所（`bootstrap_tool_dir`）の原本は、`current-environment-bootstrap` にある。

## フィードバック呼び出し（`current.feedback_calls`）

移行元のプラットフォームで、利用者に見える副作用（トースト、画面を直接触るスクリプト、ダイアログの開閉など）を出す呼び出しの一覧である。
`parity-suite` が移行元のソースを走査し、操作の反応の網羅表と突き合わせて、反応の欄の作り忘れを機械的に見つけるために読む（使い方の原本は `parity-suite` の `references/coverage.md`「操作の反応」）。

- 要素は次の 4 つである。スキルは固定の名前を持たない。名前はプラットフォームで決まるので、ここで宣言する。
  - `id`: 一意な id。
  - `regex`: 呼び出しの字面に一致する JavaScript の正規表現。ファイル全体に複数行モードで照合し、^ / $ は行頭・行末に一致する。
  - `kind`: 副作用の種類。
  - `example`: `regex` が一致すべき実際の呼び出しの字面。一致しないパターンは照合で失敗にする。一致しないと、走査が 0 件だったことと、呼び出しが無いことを区別できないからである。
- キーが無ければ未確認である。
  `parity-suite` が移行元のソースから候補を挙げてユーザーに確認し、確定した値を 1 回記録する（人が確定させる方針）。
  空リストは、フィードバックを出す呼び出しが無いと確認済みという意味で、突き合わせは行わない。
- 移行元のソースを入手できない（`current.repo: none`）なら、記録しない。`parity-suite` は、突き合わせを省いたことを成果物に残す。

## 新側アーキテクチャ（`new.stack` / `references.architecture`）

新側の骨格は、スキル群が決めない。
骨格とは、フレームワーク、バックエンドの構成、ORM、レイヤとディレクトリの構成、API の設計方針、ホスティングとリリースの構成、実行基盤と使うマネージドサービスである。
事前に決まっていることを前提に、スキルは確認・記録・参照だけを行う（対象外にする理由は [`../SKILL.md`](../SKILL.md) の「前提」）。

| キー | 形 | 内容 | 書くのは |
|---|---|---|---|
| `new.stack` | 文字列のリスト（`current.stack` と対称） | 機械で読める短い列挙（言語・フレームワーク・ORM・実行ランタイムなどの名前）。依存を決めるスキルが、候補のパッケージが合うかを判断するのにも使う | `setup` が対話で確認して記録する |
| `references.architecture` | パス（`references` の他のパス型のキーと同じ） | 散文の決定記録（レイヤとディレクトリの構成、API の設計方針、ホスティングとリリースの構成、実行基盤と使うマネージドサービスと、それを選んだ制約） | 人。`setup` は枠だけを作る |

- 実行基盤（クラウドかオンプレか、その上のマネージドサービス）は、このキーに含める。
  別のキーには分けない。読むスキル・工程・整備されていないときの動作が `architecture` と同じで、分けると同じ決定が 2 つのファイルに散るからである。
  別のファイルにしたければ、`architecture` の決定記録からリンクする（`on_diff` がスクリプトへリンクするのと同じ形）。
- 実行基盤は、依存を選ぶときの制約でもある。
  どのランタイムで動くか（コンテナ、サーバレス、エッジ）で、採れるパッケージが変わる。
  次の制約は、候補を絞る前に当たる（判断の材料の原本は [`dependency-selection.md`](dependency-selection.md)）。
  - ネイティブのバイナリを持つ依存が動かない
  - ファイルシステムに書けない
  - Node の標準 API の一部が無い
- `setup` は `references.architecture` の下書きを作らない。
  `ui_library` と `db_semantics` は、測定の結果や DDL から下書きを作って人がレビューする。しかし、骨格の下書きを作ることは実質的にスキルが骨格を決めることになるので、ここだけは枠だけにする。
- 三値（`dependency_policy` の型）にはしない。
  方針を持たないことに意味がある `dependency_policy` と違い、骨格は必ず何かに決まっているので、空の値＝整備されていないパス型のキーで足りる。
- キーが無いプロジェクトに、`setup` の再実行を求めない（このキーを入れる前に `setup` を終えたもの）。
  キーが無いことは空の値と同じ「整備されていない」として扱い、最初に必要とするスキルが確認する。
- 既にある実装から読み取った下書きをユーザーが確定させたら、その決定記録のパスを `references.architecture` に書く
  （空の値や無いキーを実際のパスにするのは、上書きに当たらない。上記「references（知識の注入）」）。
  記録しないと、次の実行や次の機能で、同じ読み取りと確認をくり返す。
- `new.stack` が空か無くても止まらない。骨格が整備されていないことで止めるのは、`references.architecture` だけである。
  依存の候補が新側のスタックと合うかを判断する必要が出た時点で、推測せずにユーザーに確認し、確認したスキルが非破壊で追記する（`setup` の再実行を待たない）。
- 骨格と部品の採否（複数の機能で使うライブラリ・フォントなど）の境界は、[`dependency-selection.md`](dependency-selection.md) が定める。

## 検証コマンド（`verification_commands`）

静的解析・型検査・テストのコマンドである。
固有のツール名はスキル本体に書かず、設定の側に置く。そうすれば、リポジトリのリンター・フォーマッタ・テストランナーをそのまま使える。
実行する範囲で、`full`（全体の走査）と `diff`（変更したファイルだけ）の 2 列に分ける（下記「実行する範囲」）。

- 環境の準備・起動・URL の解決は含めない（それらは `targets` の `pre_commands`・`start`・`check_urls`）。環境に依存しないコードの検証なので、どの target でも同じコマンドを実行する。
- 読むのは、対象のプロジェクトの側にコードを生成するすべてのスキルである。ただし、通す列と、未設定のときの動作は、用途で分かれる。

  | スキル | 通す対象 | 通す列 | `full` が未設定のとき |
  |---|---|---|---|
  | `parity-replace` | 新側の実装（と、付随する IaC の差分） | 完了判定（手順 8）は `full`。`diff` は、敵対的レビューの前の早い検出（手順 7）だけ | 止まる（完了判定が「新側で green ＋検証コマンド」なので、成り立たなくなる） |
  | `golden-dataset` | 投入ツール | `full` | 止まらず、`verification.md` に記録して進む |
  | `parity-suite` | スイート・マッピング層・操作アダプタ | `full` | 止まらず、`gaps.md` に記録して進む |
  | `current-environment-bootstrap` | 再構築ツールと暫定の起動データの投入ツール | `full` | 止まらず、`verification.md` に記録して進む |

- 止まるのは、完了判定に使うスキルだけである。品質を保つことが目的の側は、検証が無いことを記録すれば足りる。
- コマンドが対象のパスを含んでいるとは限らない（例: リントの対象が新側のアプリのソースだけに絞られていて、投入ツールやスイートを含まない）。
  含まれていなければ、そのことを記録し、範囲を勝手に広げない。
  これは対象のパスの軸で、次の「実行する範囲」の軸とは別である（対象のパスに入っていても、差分に限って実行すれば、変更の集合の外は見ない）。

### 実行する範囲（`full` / `diff`）

差分に限った検査は、変更したファイル自身の正しさしか見ない。
design token・共有の定数・設定・参照される側のファイルを消したり名前を変えたりする変更は、影響を受ける側が変更の集合の外にある。そのため、差分に限った検査では原理的に検出できない。
検出できないのは、判定が他のファイルに依存する検査（型検査、使われていないエクスポートの検出、参照の解決）である。判定がファイル単位の検査（整形など）は、差分に限っても結論が変わらない。
ただし、`diff` 列の中身を 1 つずつこの軸で分類してから、前倒しするかを決めない。分類を誤ると検出できない範囲がそのまま残るので、下の前倒しの条件は、列の中身に関わらず同じように当てる。
2 列に分けるのは、「検証コマンドが通った」を「全体で通った」と読めるようにするためである。

| 列 | 中身 | 使う工程 |
|---|---|---|
| `full`（必須） | リポジトリ全体を走査するコマンド（引数の有無は問わない。`tsc -p tsconfig.json` のように対象を引数で渡しても、全体を走査するなら `full`） | `parity-replace` の完了判定（手順 8）は、常にこの列で行う。他のスキルの生成物の検証もこの列 |
| `diff`（任意） | 変更したファイルだけを受け取るコマンド。`{changed_files}` を置くと、実行するスキルが変更したファイルの一覧に展開する | 実装の反復と、敵対的レビューの前の早い検出（`parity-replace` の手順 7）だけ。完了判定には使わない |

- `full` を、フックの設定を見て埋めない。
  コミットの前のフックが、同じツールを差分に限って実行していることは多い。フックの設定で変更したファイルが渡っているかを見ても、判別できない。
  スクリプトの側が引数をどう使うか（判定がファイル単位か、他のファイルを見るか）まで読む。
  読んでも判別できないコマンドは `full` に入れず、`setup` で全体を走査する起動の形をユーザーに確認する。
- 差分に限ってしか起動できないツールを、`full` に混ぜない。混ぜると、差分に限った結果を、完了判定が「全体で通った」と報告することになる。
  全体を走査する起動の形が無いツールは、未検査として `.replace/strategy.md` の「未検証領域の扱い」に記録し、`full` に入れたことにしない。
- `diff` が通ったことを、`full` を省く理由にしない。`diff` は安い早期の検出で、手順 8 では必ず `full` を実行する。
- `diff` を実行する工程でも、変更の集合が次のどれかを含むなら、`full` に前倒しする。差分に限っては原理的に検出できないので、レビューの往復の前に安く見つける。
  - ファイルの削除・名前の変更（`git diff --name-status` や `git status --porcelain` の `D`・`R`）。
  - 定義元（design token・共有の定数・設定値・型・エクスポート）の削除・名前の変更（削除した行に定義の宣言が含まれる変更）。
  - 共有された定義に、変更の集合の外にある利用側が満たさなくなるものを足す変更。
    型・スキーマ・インターフェースへの必須のプロパティや必須の要素の追加、網羅的に扱う共用体や列挙への分岐の追加などである
    （その型のリテラルを書いている別のディレクトリや別のパッケージが、変更の集合に入らないまま、プロパティが足りずに型検査で失敗する）。
- 前倒しの条件を、操作の名前（削除・名前の変更・追加）で覚えない。判断は仕組みで行い、その変更が変更の集合の外にあるファイルの判定を変えるかを見る。
  変えるなら前倒しする。差分に限ると検出できないのは判定が他のファイルに依存する検査（型検査、使われていないエクスポートの検出、参照の解決）で、操作の名前はその仕組みの例にすぎない。
  利用側のテストが緑であることを、前倒しが要らない根拠にしない。
  スタブに足りないプロパティが `undefined` になり、応答の形を `toStrictEqual` で固定した assertion が古い形を通すなど、テストは型が足りないことを見ないことがある。
- 実行した列を、証跡に記録する。どちらを実行したかが残らないと、後から「全体で通ったのか」を確かめられない。
- どちらの列にも、ファイルを書き換える起動の形を置かない。検証コマンドは判定であって、整形の作業ではない。
  自動で直す起動の形（フォーマッタの書き込みモード、リンターの `--fix`）を置くと、対象を警告なしに直したうえで必ず成功する。そのため、チェックとして機能しない。
  失敗すべき変更が「通った」として記録され、完了判定が意味を失う。
  差分があれば 0 以外で終わるチェックの形（`--check` や `--dry-run` に当たるもの）を置く。
  `diff` 列も同じで、こちらは害が 2 つある。手順 7 はコミットしていない差分をレビューの対象にするので、書き換える起動の形は、レビューにかける差分そのものを変えてしまう（レビューの役が見たものと、実装の役が書いたものがずれる）。
- チェックの形かどうかは、起動の形の名前ではなく、実測で判別する。
  `--check` が付いていても書き換えるツールも、付いていなくても書き換えないツールもある。
  1 回通した後に、作業ツリーの差分が増えていないことを確かめる（増えていれば、書き換える起動の形である）。`setup` で確定させる時点と、`full` に新しいコマンドを足す時点で行う。
- `{changed_files}` の展開の規則（`diff` 列を実行するスキルが従う。展開はスキルが行うので、設定の側はプレースホルダを置くだけでよい）。
  - 対象の集合は、生成物を置くリポジトリのコミットしていない変更のすべてである。
    `git diff --name-only`（ステージしていないもの）、`git diff --staged --name-only`（ステージ済みのもの）、`git status --porcelain` の `??`（追跡していないもの）を合わせる。
    新しく作った実装のファイルは追跡していないものにしか出ないので、これを外すと新しいコードが 1 行も検査されない。
    削除した（`D`）パスは渡さない（存在しないパスで、ツールが失敗する。`D` があれば、上のとおり `full` に前倒しになる）。
  - 0 件のときは、`diff` 列を実行しない。
    引数なしで起動すると、ツールによって、全体の走査になるか、対象が 0 件で必ず成功するかのどちらかになる。どちらも「差分に限って通った」の証跡にならない。
    実行しなかったことを証跡に記録する（0 件を成功として扱わない）。
  - パスは 1 つずつ別の引数として渡す。空白や ASCII 以外の文字を含むパスがあるので、区切り文字でつないだ 1 つの文字列にしない。

### 必須 CI との整合

`full` は、人が思い出した検査の一覧ではなく、生成物を受け入れる対象のブランチの必須 CI から導く。
status check の context だけを見ると、ruleset が workflow そのものを必須にする `workflows` rule を見落とす。そのため、次の順に実測してから確定する。

1. 生成先のリポジトリと対象のブランチを確定し、そのブランチに有効な repository / organization の ruleset と、classic の branch protection の両方を読む。
   ruleset はブランチに当たる rule を取得する API で、classic protection は branch protection の API で読む
   （[GitHub REST: Get rules for a branch](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)、
   [GitHub REST: Get branch protection](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection)）。片方が 404 でも「必須チェックが無い」と判定せず、もう片方を確かめる。
   rules の API はページングの対象なので、`gh api --paginate` ですべてのページを取得する。デフォルトのページの結果だけを全件として扱わない。ページの取得が途中で失敗した場合も、必須 CI を取得できないものとして確定しない。
   返された ruleset の rule は、type で先に絞らず、すべてを棚卸しする。現行の API の `required_status_checks` に加えて、`workflows` の `parameters.workflows[]` が指す必須の workflow や、`code_scanning` など自動の検査を強制する rule も対象にする。
   必須の workflow は、`repository_id` から定義元のリポジトリを解決し、`path` と、指定されていれば `ref` / `sha` の版を読む。これから追加されるものを含め、CI・workflow・検査を強制しうる未知の rule type を分類しないまま無視せず、意味を公式の仕様で確かめられるまで確定しない。
2. 必須の status check の context は、文字列から job を推測せず、対象のブランチに向けた実在の PR や commit で作られた check run の `name` と照合し、check run の workflow / job へたどる。
   同じ名前の job が複数の workflow にある、matrix などで実行時に名前が展開される、まだ check run が作られていない、など一意に対応できない状態では確定しない。
   GitHub も、required status checks では job の名前をすべての workflow で一意にするよう求めている
   （[GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)）。
   ruleset の必須の workflow は、workflow のファイル全体を対象にする。そのうえで、job の `steps[].run` だけでなく、package の script、リポジトリの中のラッパー、reusable workflow や action の呼び先までたどる。
   workflow の `jobs.<job_id>.name` と `jobs.<job_id>.uses` の構造は、
   [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) を根拠にする。
3. 各検査を、環境に依存しない全体の走査として手元で実行できるもの、CI に固有で `full` の対象外にするもの、対応が分からないものに分ける。
   対象外のもの（例: デプロイの資格情報が要る検査）は、理由を `.replace/strategy.md` の「必須 CI と `full` の整合」に残す。対応が分からないものや、説明の無い差が 1 件でもあれば、`full` を確定しない。

勧めるのは、リポジトリの中に全体の検証をまとめた書き換えないコマンドを 1 つ置き、必須 CI の job と `verification_commands.full` の両方が、その同じコマンドを呼ぶ形である。
検査の一覧の原本がコマンドの側だけになるので、検査を足すたびに `full` の列を手で合わせる必要がない。

CI を複数の必須の job に分けるなど、1 つにまとめられない場合は、必須 CI の種別・context または workflow の参照 → workflow の job → 手元で実行するコマンド → `full` の対応表を、戦略書に記録する。
さらに、必須の rule・context・workflow・job の実行内容と `full` のどれかが変わったのに対応表を更新しなければ 0 以外で終わる、決定論的なずれの検査をプロジェクトの側に置き、その検査自体を必須 CI に含める。
`setup` のときに 1 回だけ目で突き合わせても、後日の CI の変更は検出できない。そのため、ずれの検査が無い状態を「整合済み」にしない。

必須 CI が 0 件なら、空の集合と一致することを品質の保証として扱わない。
必須 CI を整備するか、必須にできない理由と `full` を代わりのチェックとして扱う方針をユーザーが決める。後者なら、「必須 CI との整合」ではなく代わりのチェックであることを戦略書に記録する。

## コーディング規約（`references.coding_conventions`）

このスキル群は、対象のプロジェクトの側にコードを生成する。
生成するのは、新側の実装（`parity-replace`）、共通部品の実装と見本（`parity-component`）、投入ツール（`golden-dataset`）、パリティスイート（`parity-suite`）である。
生成した時点から、それはプロジェクトのコードである。リポジトリの規約から外れていれば、レビューでも保守でも負債になる。
規約の本文は設定に持たず、規約のドキュメントのパスを 1 つ持つ（`references` の他のキーと同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

- `architecture` とは別のキーである。
  `architecture` は骨格（どこに何を置くか、どう分けるか）で、このキーは骨格の上の書き方（命名・エラー処理・型の扱い・テストの書き方・レビューの観点）である。
  整備されていないときの動作も違い、骨格は止まり、規約は止まらない。
- 規約を読む先は、生成物を置くリポジトリであって、常に新側とは限らない。生成物ごとに、次の対応で読む。

  | 生成物 | 置く先 | 規約を読むリポジトリ |
  |---|---|---|
  | 新側の実装（`parity-replace`） | `new.repo` | 新側 |
  | 共通部品の実装と見本（`parity-component` の `build`） | `new.repo`（見本は、カタログの取り決めが定める置き場所。`references.component_catalog` を読む） | 新側 |
  | 投入ツール（`golden-dataset`、`dataset_tool_dir`） | ツールを置くリポジトリ（フェーズ A は現行側の受け皿を触るので、現行側になることが多い） | そのリポジトリ |
  | パリティスイート（`parity-suite`、`parity_suite_dir`） | スイートを置くリポジトリ | そのリポジトリ |

  `coding_conventions` に複数のリポジトリの規約が要る場合は、規約のドキュメントの側で、リポジトリごとに節を分ける（キーは 1 つのまま）。
- 整備されていなくても止まらないが、自分の流儀を推測で持ち込まない。次の順で解決する。
  1. `coding_conventions` のドキュメント
  2. 生成先のリポジトリの基底ドキュメント（`AGENTS.md`・`CLAUDE.md`・`.github/copilot-instructions.md`・`CONTRIBUTING.md`）と、リンター・フォーマッタの設定
  3. 生成先のリポジトリの既にあるコード（新側なら、骨格のスキャフォールドが持つ実例）
- 生成先が作業中のリポジトリと違うときは、2 と 3 を明示的に読みに行く。
  `new.repo` が作業中のリポジトリと違う場合、実行中のエージェントに読み込まれている基底ドキュメントは現行側のもので、新側の規約は自動では反映されない。
  逆に、新側のリポジトリで作業しながら現行側に投入ツールを置く場合も、同じことが起きる。
- 解決できた規約のドキュメントのパスは、このキーに非破壊で追記する（`setup` の再実行を待たない。記録しないと、機能ごとに同じ探索をくり返す）。
- 規約と振る舞いの保存がぶつかったら、振る舞いの保存を優先し、ぶつかったことを記録する。
  規約に合わせた結果として現行と動作が変わるなら、それは意図的差異なので、`intentional_diffs.pending` に回してユーザーの確認に出す。
- 規約に従うことを、`verification_commands` の代わりにしない（規約は書き方の指針で、検証コマンドは機械の検査である。生成物には両方を通す）。
- 規約が機械で検査されているかを、`setup` で仕分ける。
  規約のドキュメントの項目を、`verification_commands.full` で失敗になるものと、失敗にならない（人のレビューでしか出ない）ものに分け、検査されていない項目を `.replace/strategy.md` の「未検証領域の扱い」に記録する。
  検査されていないままだと、規約に従ったつもりの箇所が、`parity-replace` の敵対的レビューやユーザーの指摘で初めて出る。そうなると、指摘を受けてから検査を足すことになる（しかも機能ごとにくり返す）。
  リントのルールやフォーマッタの設定で表せる項目は、`setup` の時点で整備をユーザーに促し、足した検査は `full` に載せる。
  仕分けは、規約に検査があるかではなく、その規約を破った入力が `full` で失敗するかで判定する（設定ファイルにルールの名前があっても、対象のパスから外れていれば失敗しない）。

## DB 意味論（`references.db_semantics`）

現行 DB と新 DB は、同じ意味で書いた SQL でも同じ結果を返さない。
このキーは、その差を 1 つのドキュメントに集めた注入先で、役割が 2 つある。

| 役割 | 読む工程 | 内容 |
|---|---|---|
| 移植のときの点検表 | `parity-replace` の実装（手順 4）。クエリとデータアクセスを書く前に読む | 新旧で結果が変わる構文やデフォルト値と、現行 DB と新 DB それぞれがどうなっているか |
| 差の宣言 | `golden-dataset` のフェーズ B（変換と、現行と新側の一致の検証）、`parity-suite` の並び順の特性化、`parity-diff` の並び順の差の判断、`current-environment-bootstrap` の復元した項目の突き合わせ（整備済みのときだけ） | 現行から新側への型の対応と、宣言済みの差（比較で「宣言の外の差」と区別するための基準） |

- 点検表を実装の工程の入力にするのは、方言の差の手戻りが、最も高くつく層で出るからである。
  実装の工程の入力になっていないと、書く時点では誰も点検表を読まず、方言の差は実装の後の敵対的レビューで初めて出る。
  指摘 1 件あたりの手戻りが「読んでから書く」より高くつくうえ、パリティスイートが green のまま残る差もある（絞り込みの不具合は、データの件数が少ないと出ない）。
- 点検表には、少なくとも次のものを挙げる。特定の DB の製品名を決め打ちせず、現行 DB と新 DB それぞれのデフォルトと、差があるときの扱いを書く。

  | 点検項目 | 何が変わるか |
  |---|---|
  | NULL の並び順 | `ORDER BY` のデフォルトの NULL の位置が、製品によって逆になる（昇順で NULLS LAST の製品と、NULLS FIRST の製品がある）。並び替える列が nullable なら、並びが変わる |
  | 暗黙の型変換と、変換に失敗したときの値 | 文字列と数値・日付を比べたときの変換の規則。変換のエラーをデフォルト値にする構文は、絞り込みを警告なしに無効にする（数値として読めない入力がデフォルト値として比べられ、条件が全件に当たる） |
  | 照合順序（collation） | 大文字と小文字、全角と半角、かなの扱い。比較・`LIKE`・`ORDER BY`・一意制約のすべてに影響する。片側だけを正規化すると、比較が成り立たなくなる（列の型に効果の無い正規化の関数を、入力の側だけに掛けるなど） |
  | 連結での NULL の扱い | NULL を空文字として連結する製品では、連結して組んだ `LIKE` のパターンが全件に当たる。NULL を伝える製品では、結果が NULL になる |
  | 数値と日付の書式のロケールへの依存 | 小数点・桁の区切り・日付の書式がセッションの設定に依存する製品では、変換の関数に書式を渡すだけでは結果が固定されない（ロケールを明示する必要がある） |

- この表は網羅ではない。挙げていない差は点検表からは出てこないので、点検表を通したことを実測の代わりにしない。
  実際の検証は、`golden-dataset`（フェーズ B の一致の検証）と `parity-suite`（並び順の特性化）が行う（上記「references（知識の注入）」）。
- 点検で見つけた差は、実装で吸収するか、意図的差異として宣言するかを 1 件ずつ決める。
  吸収しないと決めた差は、`intentional_diffs.pending` に非破壊で追記して、ユーザーの確認に回す（実装する人が 1 人で「許容」と判定しない）。
- `dataset_mode: static` では、点検表の対象が静的なデータの形式になる（フィールドの構成、エンコーディング、日付の表記、区切りとエスケープ、ファイルの分け方）。
  DB に固有の項目は「該当なし」と明記する（空欄にすると、点検していないことと区別できない）。
- `setup` の下書きでは、上の点検項目を節として立て、現行 DB と新 DB のデフォルトを埋める形にする（下書きの作成と人のレビューは、上記「references（知識の注入）」）。
  節が無いと、その項目は「差が無い」ではなく「誰も見ていない」になる。

## 実行対象環境（`targets`）

現行と新側の実行対象環境を、環境名で複数定義し、各スキルの実行のときに `--target <name>` で選ぶ。
local-dev・local-production・preview・develop など、同じスイートを当てる環境をここに並べる。

- 各項目の意味の原本は、`browser-test` の `references/project-config.md` である。
  そこで定義するのは、`url`・`url_command`・`pre_commands`・`start`・`check_urls`・`forbidden_actions` の意味と、実行の順序である。
  順序は、`url_command` の解決 → `check_urls` で稼働を判定 → 止まっているときだけ `pre_commands` → `start` → もう一度 `check_urls` である。最初の稼働の判定の失敗は起動の合図で、それ以外の失敗では早く止まる。
  ただし、`forbidden_actions` の当てる範囲は、下記のとおりこのファイルが定義する。
  このファイルが定義するのは、`side`・`api_url`・`browser`・`catalog_url` / `catalog_url_command`・`db`・`auth`・`commit_check`・側ごとの `default`・選択規則・`on_diff`・parity 系での使い方である。
  `auth` は、browser-test の `auth: none | user` とは別のものである。扱いの原本は `parity-suite` の `references/auth.md` である。
- 各 target の値には次の条件（スキーマ不変条件）がある。各スキルは target を解決するときに確かめ、満たさなければ止まって、設定を直すよう促す。
  - `side` は必須である（`current` か `new`）。省略したときのデフォルトは無い。新側の環境を足すときに書き忘れると、「正解は現行」という原則が逆になるからである。
  - `default: true` は、側ごとに 1 つまでにする。同じ側に複数あれば止まる。0 個はよい。そのときは、`--target` を省くと候補を示して確認する。
  - `url: none` の target に `default: true` を付けない（省略したときのすべての実行が、開発していない環境に向かうため）。
  - 各 target は、`url`（開発していなければ `none`）と `url_command` のどちらか一方だけを持つ（両方あるときも、どちらも無いときも止まる）。
  - `url_command` の target には、`default: true` を付けてよい（`url: none` と違い、実行できる環境を指すため。解決に失敗すれば、実行のときに止まる）。
  - `name` は小文字の英数字とハイフンだけで、すべての target を通して一意にする（側をまたいだ同じ名前も不可。成果物のディレクトリ名に使うため）。
  - `db.seedable: true` の target は `db.env_vars` を持つ（接続先を知らずに投入はできない。`env_vars` の無い `seedable` は止まる）。
  - `dataset_mode: static` なら、`dataset_static_paths` が 1 つ以上ある（無ければ書き込む範囲を限れないので止まる）。
  - `storage.seedable: true` の target は、`storage.env_vars` と 1 つ以上の `storage.write_scope` を持つ（`db.seedable` と同じく、判定できないときは失敗にする。欠けていれば止まる）。
  - `uses_storage` が `false` か無いのに、`storage` を持つ target があれば止まる（宣言の食い違いを、警告なしに解釈しない。使うなら `uses_storage: true` を書く）。
  - `current.origin: received-assets` なら、`current.received_assets` が 1 つ以上ある（受け取った資産の場所を知らずに再構築はできない。空か無いときは止まる）。
  - `catalog_url` / `catalog_url_command` を持てるのは、`side: new` の target だけである（現行側に部品カタログは無い。`side: current` に付いていれば止まる。現行から採るべき基準を、カタログから採る誤りになるからである）。
  - `catalog_url` と `catalog_url_command` は、どちらか一方だけにする（両方あれば止まる。`url` / `url_command` と同じく、同時には書けない）。
  - `side: current` の target が `url: none` を持てるのは、`current.origin: received-assets` で、再構築が終わっていない間だけである。
    `current-environment-bootstrap` が、引き渡しのときに実際の URL と `default: true` を埋める。
    `origin: managed` で `url: none` の current の target があれば止まる。測定の対象が無いまま、`setup` が測定に進むことになるからである。
- `api_url` は API の baseURL である。UI と API が別の origin のときだけ書き、省略すると `url` を使う
  （api-resource モードは現行の応答を正として同じリクエストを新側に送るので、UI とは別に選べる必要がある）。
- `browser.cdp_url` は、利用者環境で起動したブラウザ（デバッグのポートを開いた Chromium 系）に `connectOverCDP` で接続するときの接続先である。
  撮影とスイートの実行を、Playwright が起動したブラウザではなく、そのブラウザで行う。
  値は `http://<host>:<port>/` か `ws://…/devtools/browser/…` である（出典: <https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp>）。
  - 採取の環境と利用者環境の OS が違う（コンテナで実行し、利用者は Windows など）ときに、スイートを実行する環境を移さずに、描画だけを利用者環境で行うために使う。省略すると、Playwright がブラウザを起動する。
  - 値は環境変数 `PARITY_CURRENT_CDP_URL` / `PARITY_NEW_CDP_URL` に解決して、Playwright の共通のフィクスチャに渡す。
    設定の原本は `parity-suite` の `references/locator-mapping.md`「利用者環境のブラウザへ接続する」である。
  - 現行と新側で比べる組は、両方の側に同じ宣言が要る。片側だけを利用者環境で撮ると、環境の差がそのまま差分に出る。
    `parity-suite` は撮影に使ったブラウザを `metadata.json` の `capture_conditions.browser` に残し、`parity-diff` は、選んだ新側の target の宣言がそれと合わなければ、撮影せずに止まる
    （設定の段階では、どの target どうしを比べるかが決まらないので、照合しない）。
- 選択規則の原本は、下記の「選択規則」の節である（各スキルは自分の対象の側だけを宣言し、規則の全文はここだけが持つ）。
- `db`・`auth`・`forbidden_actions` は、target ごとに定義する。
  側ごとのデフォルトや代わりの値は持たない。複数の target で同じ値になる場合も、各エントリに書く。共有したければ YAML のアンカーを使ってよい（スキルのキーをまたいだ共有の可否と制約は、上記「設定ファイルの共有と YAML アンカー」）。
- `auth` はロールの構造である。`roles.<ロール名>` の下に `user_name_env` と `password_env` を置く（値は環境変数の名前。他の要素は `<論理名>_env` で足せる）。
  認可はそれ自体が仕様で、ロールごとの代表のユーザーと storageState の扱いの原本は、`parity-suite` の `references/auth.md` である。認証が要らない環境では、`auth` ごと省略する。
- ノイズの基準値は、現行側の 1 つの環境で測った値である。
  `parity-suite` が current 側で測った `noise_baseline` を、新側のすべての target に使えるとは限らない（CDN やフォントの読み込みなどで、環境のノイズは変わる）。
  `parity-diff` は新側の撮影のときに自分のノイズを測り、ずれが大きければ止まる（原本: `parity-diff` の `references/capture-new.md`）。
- 成果物は、新側だけを環境ごとに分ける。
  `parity-replace` と `parity-diff` の成果物は `.replace/parity/<slug>/new/<target>/` に分け、環境を切り替えても、green の証跡・差分のメタデータ・新側のベースラインを上書きしない（レイアウトの原本は、成果物を作る各スキル）。
  現行側は 1 つの環境で、`parity-suite` が `metadata.json` に選んだ target 名を記録する（現行側の target を変えたら、ベースラインが古くなったものとして扱う）。

### `db` と `db.seedable`

`db` は接続を知っていること、`db.seedable` はシードしてよいことを表す。この 2 段の取り決めが、`dataset_mode: db` のときの投入先の解決の原本である（`static` の扱いは下記「データセットの実体」）。

| `db` の宣言 | 意味 | `golden-dataset` | 読み取り（バッチの出力の一致の検証など） |
|---|---|---|---|
| 未定義 | この target の DB に、スキルは一切触れない | 投入しない | しない |
| `env_vars` だけ | 読み取り専用の接続 | 投入しない | する |
| `env_vars` ＋ `seedable: true` | 投入してよい環境 | 投入する（フェーズ A は `side: current`、フェーズ B は `side: new` の選んだ target） | する |

- `seedable` は、投入を設定で許すかのチェックである。
  `golden-dataset` は、本番でないことを自分で確かめるチェックに加えて、このチェックを通す。安全のための確認を 2 つにして、設定の誤りや判断の誤りの 1 か所だけで事故にならないようにするためである。
  デフォルトでは許さない。省略か `false` は、読み取り専用として扱う。
- 同じ DB を複数の target が共有する場合も、target ごとにフェーズ B を実行して記録する（投入ツールは冪等なので、再実行は安全である）。
- 投入しない target（`db` が未定義か、`seedable` が無い）では、`parity-diff` はデータセットバージョンの三者整合（フェーズ B との整合）を免除する。
  その代わりに、「ゴールデンデータを投入していないので、データに依存する差分は、実装の差かデータの差かを判別できない＝未検証」と `diff.md` に明記する（実データを持つ配信型の環境などを想定した宣言である）。

### `forbidden_actions` の適用範囲

対象は、アプリへの UI / API の操作である。`db` を通る投入ツール（`golden-dataset`）には当てない
（投入の安全のための確認は、上記の `db.seedable`〈`static` では `dataset_static_paths`〉と、golden-dataset の本番でないことを確かめるチェックの 2 つが行う）。
空リストは「すべて行ってよい」、未定義は「読み取り専用」で、意味が違う。
書き込みを許していない target では、parity 系はスイートの書き込みのスペックを実行せず、「未検証」として記録する。

### URL の引き渡し

選んだ target の UI と API の URL は、環境変数 `PARITY_CURRENT_UI_URL`・`PARITY_CURRENT_API_URL`・`PARITY_NEW_UI_URL`・`PARITY_NEW_API_URL` に解決する。
Playwright の `current` / `new` プロジェクトの baseURL と、API の request fixture が、それを一貫して使う（設定の原本は `parity-suite`）。

- `url_command` の target は、コマンドを実行して得た URL を `PARITY_*_URL` に解決する。失敗したときと、出力が空のときは止まる。
  基本の意味（`url` と同時に書けないこと、止まること）の原本は `browser-test` で、`PARITY_*_URL` への解決と `"runtime"` の記録の原本はこの節である。
- 解決は、スキルの 1 回の実行につき 1 回（target を解決するとき）にする。同じ実行の中の後の工程（疎通の確認・撮影・API の発行）は、解決した値を使い回す。
  工程ごとに実行し直すと、実行中に解決先が変わったとき、疎通を確かめた環境と、撮影や発行の先の環境がずれるからである。
- 解決した URL は、成果物やログに書かない。
  成果物（`metadata.json`・`replace-metadata.json` など）の記録のフィールドのうち、`url_command` で解決した値が入る箇所には `"runtime"` を記録する。
  `api_url` は任意の固定の値で、固定の値で指定していれば、その値を記録してよい。`api_url` を省略して、解決した後の UI の URL を使う場合だけ `"runtime"` になる。
- 読む側のスキルは、`"runtime"` の箇所を記録された値として使わず、target 名から設定を読んで解決し直す（別のスキルの実行では、改めて 1 回解決する）。

### 選択規則（対象 target の決め方）

選択規則の原本はこの節である。
各スキルは、どちらの側を候補にするかだけを自分のドキュメントで宣言し、下の規則は転記せずにこの節を参照する
（安全のための確認を含む規則が複数のファイルに散ると、原本を改めても転記に伝わらずに食い違うからである）。

- 候補は、自分が対象にする側の target だけにする。どちらの側かは、各スキルが定義する（`side` は設定の値で、スキルの引数ではない）。
- `--target` を省いたときは、その側で `default: true` の target を使う。無ければ候補を示してユーザーに確認する（勝手に 1 つを選ばない）。
- スキルが追加の候補の条件を持つ場合（例: `golden-dataset` の `db.seedable: true`）、選ばれた `default` がその条件を満たさなくても、代わりの target を勝手に選ばない。
  そのスキルの決まり（止まるか、設定の修正や別の target の指定をユーザーに促すか）に従う。
- 存在しない名前と、側が違う名前は止まる（勝手に読み替えない。設定に無い環境を、あるものとして実行しないため）。

### `on_diff`（要対応差分が出たときの対応）

差分を見つけた後にどう動くかは環境ごとに運用で違い、手順の自由度が高い。
たとえば、先に別の環境で再テストする・commit して push する・デプロイの反映を待つ・Issue を起票するといった違いがある。
そのため、構造化したキーでは持たず、対応手順を書いた Markdown のファイルのパスを 1 つ持つ（`references` と同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

- 省略したときのデフォルトの動作: `parity-diff` は `diff.md` を差し戻しの入力として、同じ target の `parity-replace` に渡す。`parity-replace` は直して、対象の target で再テストする。
- ドキュメントには次のようなことを自由に書く。
  この target で再テストする前に green を確かめるべき環境、修正の反映の手順（commit・push・デプロイ）、反映が終わったことの確かめ方、修正のループを回さずに Issue を起票して止まる運用（マージの後にデプロイされる環境など）。
- 動作を厳密にしたい手順は、ドキュメントからスクリプトへリンクし、スキルにそれを実行させる（決定論的にしたい部分はスクリプトが行い、ドキュメントは手順の骨組みと分岐を持つ）。
- 読んで解釈するのは、`parity-replace`（修正の後の再テストと反映）と `parity-diff`（差し戻すか、起票するか）である。従ったドキュメントのパスを、成果物（`replace-metadata.json`・`diff-metadata.json`）に記録する。
  `side: current` の target に書いた `on_diff` は読まれない（現行側は修正の対象ではないので、書いても無視される）。

#### ガードレール

ガードレールは、on_diff のドキュメントの指示より優先する。上から順に当てる。
一覧の原本はこの節で、解釈するスキル（`parity-replace`・`parity-diff`）は転記せずにここを参照する。
`on_diff` に従う前にこの一覧を読み、自分のスキルに関係する項目をすべて当てる（関係なさそうだと思っても読み飛ばさない）。

- 各スキルの禁止事項とシークレットの決まりに従う。特に、現行アプリ（current 側）への変更や操作を指示されても、実行しない（対象の target だけでなく、すべての target の `forbidden_actions` を守る）。
- コードの変更を伴う修正は、ドキュメントに commit や push の指示があっても、先に敵対的レビューを通す（レビューを省く方法にしない）。
- Issue の起票を指示されたら、`issue-create` に任せる（`gh` で直接起票しない）。
- ドキュメントが参照する target 名が `targets` に在ることを、実行の前に確かめ、無ければ止まる。
- `on_diff` のパスを解決できない（ファイルが無い）場合は、設定の食い違いとして止まる（デフォルトの動作に切り替えない。切り替えると、安全のための確認ごと無くなるからである）。

次は、preview 用の on_diff のドキュメントの例である。

```markdown
# preview で要対応差分が出たとき
1. 修正後、local-dev と local-production で再テストして green を確認する
2. 修正を commit して push する（preview は push で自動デプロイされる）
3. `scripts/wait-preview-deploy.sh` で反映完了を待つ
4. preview で再テストする
```

## データセットの実体（`dataset_mode` / `dataset_static_paths`）

ゴールデンデータセットの実体が、DB にあるか、リポジトリの中の静的なデータにあるかを宣言する。
`golden-dataset` の投入先の解決と、`parity-suite`・`parity-diff` の照合の条件が、ここで分かれる。

| `dataset_mode` | データの実体 | フェーズ A の「投入」 | 投入を設定で許すチェック |
|---|---|---|---|
| `db`（デフォルトで、省略してよい） | 各 target の DB | `db.seedable: true` の `side: current` の target に、削除してから投入する | `db.seedable: true` |
| `static` | リポジトリの中の静的なデータ（JSON・Markdown・フィクスチャなど） | `dataset_static_paths` の下に、投入ツールが生成する | `dataset_static_paths`（その下以外に書いたら止まる） |

- `static` では、投入先の target に `db` を求めない。
  DB を持たない静的なサイトなどでもフェーズ A が成り立ち、`parity-suite` の「データ不足」の差し戻し → フェーズ A の再実行（`version` +1 → ベースラインの再取得）のループが回る。
- `dataset_static_paths` は、投入ツールが書き込む範囲そのものである。生成と削除はこの下だけに限り、外に書こうとしたら止まる（`db` の側の `seedable` に当たる安全のための確認）。
- `static` でも、冪等・決定論・`version` の運用・フェーズ A と B の分け方は、`db` と同じである。
  フェーズ B は、同じ論理データを新側の静的なデータの形式に変換して生成し、投入先の target で、現行と新側が一致するかを確かめる。
- `dataset_mode` は、プロジェクトの単位で、現行と新側の両方に当てる。
  片側だけ実体が違う構成（現行は静的、新側は DB など）は、この取り決めでは表せない。
  そうだと分かったら（例: フェーズ B で、新側の受け皿が宣言と違う実体だった）、`golden-dataset` は片側だけを進めず、止まってユーザーに確認する。

## ファイルストレージ（`uses_storage` / `targets[].storage`）

アップロードされたファイルと、アプリが生成したファイルの置き場所（オブジェクトストレージ・共有ファイルシステム）を宣言する。

`dataset_mode` とは独立した軸である。
`dataset_mode` が答えるのは、ゴールデンデータの実体が DB か、リポジトリの中の静的なデータかである。
ストレージを使うかどうかはそれと独立で、4 通り（DB あり×ストレージあり/なし、DB なし×ストレージあり/なし）ある。
`dataset_mode` に 3 つ目の値を足して表さない。

| キー | 階層 | 内容 |
|---|---|---|
| `uses_storage` | トップレベル（環境に依存しない） | アプリがストレージを使うか。デフォルトは `false`。アプリの構造はプロジェクトの単位の事実で、環境では変わらない |
| `targets[].storage` | target ごと | その環境の接続（`env_vars`）、書き込む範囲（`write_scope`）、投入を許すか（`seedable`）、アップロードの方法（`upload_route`） |

- 値をどの階層に置くかの規則: 環境ごとに変わる値は target の側に、リポジトリからの相対で環境に依らない値はトップレベルに置く。
  `dataset_static_paths` がトップレベルなのは、リポジトリの中のパスで環境に依らないからである。`db` と `storage` が target の側なのは、接続先やバケットが環境ごとに違うからである
  （非対称に見えるが、軸は 1 つである。新しいキーを足すときも、この軸で置き場所を決める）。
- 次の 3 段の取り決めがある（`db` と同じ形。デフォルトでは許さない）。

  | `storage` の宣言 | 意味 | 読み取り（出力したファイルの捕捉・保存の結果の確認） | ゴールデンデータの投入 |
  |---|---|---|---|
  | 未定義 | この target のストレージに、スキルは一切触れない | しない | しない |
  | `env_vars` だけ | 読み取り専用の接続 | する | しない |
  | `env_vars` ＋ `write_scope` ＋ `seedable: true` | 書き込みを許した環境 | する | 行わない（下記） |

- ストレージの実体へのゴールデンデータの投入は、このスキル群のスコープの外である。
  `storage.seedable: true` でも、`golden-dataset` は投入しない。ストレージの実体に依存する検証は、`gaps.md` に「ストレージへの投入はスコープ外＝未検証」として必ず記録する（確認済みにしない）。
  理由は、スキルがセットアップも検証もできないものを選択肢として出さない、という線引きである（下記「成果物の保存先」と同じ）。投入は、プロバイダに固有の SDK・認証・バケットの構成に踏み込むことになる。
  それでもキーを先に用意するのは、宣言があることで「ストレージがあるのに未検証」を見えるようにするためである（`references` の空の値の枠と同じ考え方）。
- `write_scope` は、書き込む範囲の上限の宣言である。投入はしないが、テストが生成物を消したり作ったりする操作を持つ場合も、その範囲はこの下に限る（外に出たら止まる）。
- アップロードの方法（`upload_route`）で、検証の対象が変わる。

  | 値 | 方法 | 検証への影響 |
  |---|---|---|
  | `direct` | ブラウザ → アプリサーバ（multipart） | アップロードの要求が、アプリの API に現れる。API の特性化と record/replay の対象になる |
  | `presigned` | ブラウザ → ストレージに直接 PUT（署名付き URL など） | アプリサーバを通らないので、API の特性化と record/replay の対象が変わる（アプリの側に現れるのは、署名を発行する API だけ）。署名の有効期限、CORS、テスト環境からストレージに届くことが前提になる |
  | `none` | アップロードの方法を持たない | ファイル入力の特性化は対象外 |

  - 省略は「未確認」として扱う。推測で `direct` と決めず、アップロードの特性化に入る前に、ユーザーに確認して記録する。
  - 現行側と新側で `upload_route` が変わると、保存するファイルの名前（path）の命名規則も変わることがある。これは意図的差異レジストリ（`intentional_diffs`）の対象で、宣言が無いまま「許容」にしない。
- キーが無いプロジェクトに、`setup` の再実行を求めない（このキーを入れる前に `setup` を終えたもの）。
  `uses_storage` が無ければ `false`、`targets[].storage` が無ければ未宣言として扱う。
  ただし、`uses_storage: true` なのに `storage` を宣言した target が 1 つも無い場合は、ストレージに依存する検証をすべて未検証として `gaps.md` に記録する（止まらない）。
- ファイルの取得の方法、形式ごとの扱い、アップロードの操作、解析のツールの原本は [`file-io.md`](file-io.md)、対応する範囲の一覧は [`scope.md`](scope.md) である（ここには転記しない）。

## 部品カタログ（`references.component_catalog` / `targets[].catalog_url` / `targets[].catalog_url_command`）

共通の UI 部品を画面より先に作る方針を採ったときだけ使う。
部品を単体で、状態ごとに描画する場所の宣言で、実体はプロジェクトが選ぶ（スキルは固定しない）。

- `references.component_catalog` は、カタログの取り決めのドキュメントのパスである。実体、見本の書き方、URL の決まり方、データの注入方法を書く。
  カタログが満たすべき取り決めの原本は、`parity-component` の `references/catalog.md` で、ここには転記しない。
  取り決めは、1 インスタンス × 1 状態を 1 つの固定の URL で開けること、Playwright で届いて論理名で開けること、静的なデータを注入できること、アニメーションを無効にできること（動きのある部品は無効にせずにも開けること）、描画が外部のサービスに依存しないことである。
- `targets[].catalog_url` と `targets[].catalog_url_command` は、カタログの baseURL である。`side: new` の target にだけ置く（現行側にカタログは無い）。
  固定の文字列とコマンドは、別のキーに分ける（`url` / `url_command` と同じ形）。
  同じスカラーに両方を入れると、値を開くのか実行するのかを読み手が決められない。ポートが実行ごとに変わる環境で、URL として開いてしまうことも、固定の URL をコマンドとして実行してしまうこともある。
  両方を書けば止まる。
  `catalog_url_command` の解決と記録の規則は、`url_command` と同じである（上記「URL の引き渡し」。解決に失敗したときと出力が空のときは止まり、解決した値は成果物に書かずに `"runtime"` を記録する）。
- 取り決めのドキュメントと baseURL のどちらかが宣言されていなければ、`parity-component` の `build` は止まる。スキルが、カタログの実体を選ぶことも、URL を推測することもしない。
- この 2 つは、組で意味を持つ。取り決めのドキュメントだけがあって baseURL が無ければ、採取する先が決まらない。baseURL だけがあっても、見本の置き方と URL の組み立て方が決まらない。

## 依存導入の方針（`references.dependency_policy`）

パッケージを入れてよいかを決める方針は、持つリポジトリと持たないリポジトリがある。
方針の例は、ライセンスの拒否リスト、供給網の方針、バンドルサイズの上限、公開からの経過日数による採用の遅らせ方、依存のレビューの自動化である。
そのため、方針の本文は設定に持たず、方針のドキュメントのパスを 1 つ持つ（`references` の他のキーと同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

| 値 | 意味 | スキルの動作 |
|---|---|---|
| パス | その方針に従う | 依存を決めるときに方針のドキュメントを読み、照らした結果を `.replace/dependencies.md` に記録する |
| `none` | 方針を持たないことを、ユーザーに確認済み | 方針との照合は行わず、判断の材料の確認と記録だけを行う（もう一度は確認しない） |
| キーが無い | 未確認 | 依存を決める前に、方針が要るかをユーザーに確認し、結果をこのキーに記録する（確認の手順の原本は [`dependency-selection.md`](dependency-selection.md) の「方針の有無を前提にしない」） |

- `none` と、キーが無いことを同じに扱わない（「確認したうえで方針は無い」と「まだ聞いていない」は別である）。
- この 3 つの値の意味の原本はこの節で、他のファイルには転記しない（参照する側には、要約とこの節の名前だけを置く）。
- 記録するのは、確認したスキルである（`setup` の後にこのキーが要ると分かった場合も、`setup` の再実行を待たずに追記する）。
- スキルは、デフォルトの拒否リスト・しきい値・待つ日数を持ち込まない。判断の材料と工程の原本は [`dependency-selection.md`](dependency-selection.md) である。

## 移行（旧キーからの更新）

古いスキーマ（URL が 1 つ、側ごとの DB と認証、禁止操作が 1 つのリスト、`static_analysis`、設定の側のインスタンス単位の例外）からは、次の対応で移行する。
スキルは、古いキーを代わりの値として読まない。古いキーを見つけたら、この移行の手順を示して止まる。

検出する古いキーの一覧は次のとおりである（各スキルはこの一覧を見て検出する）。
`current:` のブロックそのものは新しいスキーマにもある（`repo`・`stack`）ので、ブロックではなくキーの単位で検出する。

- `current.url`・`new.url`・`current.db`・`new.db`・`auth.current`・`auth.new`・`static_analysis`
- `forbidden_actions`（`skills.replace-strategy` の直下の、1 つのリスト。`targets[].forbidden_actions` は新しいスキーマの正しいキーで、検出の対象ではない）
- `component_diff_exceptions`（`skills.replace-strategy` の直下。slug の成果物に移した。`component_diffs` は新しいスキーマの正しいキーで、検出の対象ではない）

キーの名前が変わらない移行は、一覧では検出できないので、値の形で検出する。

- `verification_commands` の値がリストである（下記「`verification_commands` の形の変更」）。
- `db.env_vars` を持つが `seedable` の無い target がある（下記「`db.env_vars` の意味変更」）。
- `intentional_diffs.pending` の要素が素の文字列である（下記「`intentional_diffs.pending` の要素の形の変更」）。

これらには、上の「古いキーなら必ず止まる」を当てない。
止まるかどうかは、各サブ節が用途ごとに決める（例: `verification_commands` がリストのとき、`parity-replace` は止まり、品質を保つことが目的の側は記録して進む）。

| 旧 | 新 |
|---|---|
| `current.url` | `targets` に `side: current` のエントリを作り、`url` に移す（`default: true` を付ける） |
| `new.url` | `targets` に `side: new` のエントリを作り、`url` に移す（値が `none` なら `url: none` のまま移すが、`default: true` は付けない。動く target ができた時点で付ける） |
| `current.db` / `new.db` | 対応する側の各 target の `db.env_vars` に移す（DB を読んでよい環境にだけ書く。書かない target の DB には、スキルは触れない）。投入してよい環境には、さらに `db.seedable: true` を足す（下記） |
| `auth.current` / `auth.new` | 対応する側の各 target の `auth.roles.<ロール名>.{user_name_env,password_env}` に移す。古い平らなリストのどの変数がユーザー名かパスワードかは、名前から推測せず、ユーザーに確認する。古い `auth.new` が空リストだった場合は、`auth` を省いたまま移さず、`setup` で新側の認証情報を確認して埋める |
| `forbidden_actions`（1 つのリスト） | `side: current` の target の `forbidden_actions` に移す。新側の target には、`forbidden_actions: []` を明示的に置く（空リスト＝すべて行ってよい。未定義＝読み取り専用とは意味が違う） |
| `static_analysis` | `verification_commands.full` に移す（環境の準備や起動が含まれていたら、target の `pre_commands` / `start` に移す）。移す前に、各コマンドが全体を走査するかを確かめる。差分に限るものは `full` に入れずに `diff` に置き、全体を走査する起動の形を `setup` で確認する（上記「実行する範囲」） |
| `component_diff_exceptions`（設定の側の 1 つのリスト） | 要素の `slug` ごとに、`.replace/parity/<slug>/component-diff-exceptions.json` に分ける。同じ原因の要素は、`reason` の重複をまとめて `component_diff_exception_causes[]` に 1 件立て、各インスタンスは `reason` を捨てて `cause` で参照する（インスタンスの件数は減らさない）。原因の調べた経緯（YAML のコメントなどに溜まっているもの）は、同じディレクトリの `component-diff-exceptions.md` の原因の節に移し、`causes[].evidence` にその節を指させる。移行の後、設定の側のキーは削除する。スキーマの原本は `parity-diff` の `references/normalize.md`、2 つのファイルの様式は `parity-diff` の `assets/component-diff-exceptions-template.{json,md}` |
| 成果物のレイアウト: `.replace/parity/<slug>/` の直下の `replace-metadata.json`・`diff.md`・`diff-metadata.json`・`baseline-new/` | `.replace/parity/<slug>/new/<target>/` に移す。`<target>` は、古い `new.url` から移行で作った `side: new` の target 名である。移した後、`replace-metadata.json` の `new` に `target: <その名前>` を追記する |

- target 名は、一度決めたら変えない。
  現行側の target 名を変えるとベースラインが古くなり（すべての slug をもう一度採取する）、新側の target 名を変えると `new/<target>/` の下の証跡と合わなくなる。
  移行のときは、環境の役割が分かる名前（例: `current-test`・`local-dev`）を付ける。

### `intentional_diffs.pending` の要素の形の変更（追記元の明示要求）

`pending` の要素は、散文の文字列から、追記元を持つオブジェクト（`item`・`slug`・`added_by`・`added_at`。下記「`pending` 要素の形」）に変わった。

- 素の文字列の要素で止まることはしない（読める）。ただし帰属が分からないものとして扱われ、`parity-diff` の棚卸しでは、どの機能でも示される。
  帰属を持つ要素は、自分の機能の棚卸しで閉じられる。帰属が分からない要素は、閉じる担当が決まらないので毎回出てくる。これが移行を促す。
- 移行は、棚卸しの場で行う（一括の変換を先に実行しない）。
  示された要素を `keep` / `may_change` へ移すか、持ち越すなら、そのときに追記元が分かる形に書き換える。
  `added_by` や `added_at` を後から復元できないなら、`unknown` と書く。推測したスキル名や日付で埋めない。
  キーごと省くと、判定ツールが形式の誤りとして失敗にする。書き換えるなら、4 つのキーをすべて埋める。
- `keep` / `may_change` の要素は散文の文字列のままでよく、この移行の対象ではない（照合キー `match` を持つオブジェクトにするのは任意である。下記「照合キー（`match`）」）。

### `db.env_vars` の意味変更（`seedable` の明示要求）

`targets` のスキーマを入れたときは、`db.env_vars` があることが、「接続を知っている」と「シードしてよい」の両方を表していた。
今は、`db.seedable: true` が投入先の条件である（上記「`db` と `db.seedable`」）。キーの名前は変わらないので、機械的には検出できない。

- `db.env_vars` を持つが `seedable` の無い target を投入先に選ぶと、`golden-dataset` は投入せずに止まる（判定できないときは失敗にする）。
  投入してよい環境なら `seedable: true` を足し、読み取り専用のままでよければ投入先を変える。
- 投入しない target になると、`parity-diff` の三者整合（フェーズ B との整合）を免除する対象になる（`diff.md` の未検証の領域に、データに依存する差分が積まれる）。
  そのため、意図せず読み取り専用になっていないかを、移行のときに確かめる。

### `verification_commands` の形の変更（`full` / `diff` の 2 列化）

入れたときは 1 つのコマンドの列だったが、今は実行する範囲で `full` と `diff` の 2 列に分ける（上記「実行する範囲」）。
キーの名前は変わらないので、値がリスト（旧）かマップ（新）かで検出する。

| 旧 | 新 |
|---|---|
| `verification_commands:` の値がコマンドのリスト | `verification_commands.full` / `verification_commands.diff` のマップに移す。リストの中身を、機械的に `full` に移さない。各コマンドが全体を走査するかを確かめ（起動の形と、スクリプトの引数の扱いを読む）、差分に限るものは `diff` に分ける |

- リストの形は、「実行する範囲が宣言されていない」として扱う。
  完了判定に使う `parity-replace` は、`full` が未設定のときと同じく止まり、確定を促す（宣言されていないものを「全体」として扱うと、差分に限った結果が「全体で通った」と報告される）。
  品質を保つことが目的の側（`golden-dataset`・`parity-suite`・`current-environment-bootstrap`）は止まらず、リストの形であること（範囲が宣言されていないこと）を成果物に記録して進む。

## シークレットの扱い（スキル群共通のルール）

DB の接続情報もアプリの認証情報も、スキルは環境変数から読む。
環境変数をどう用意するかはプロジェクトの責任で、スキルの外にある。
`.env`、シークレットマネージャのラッパー、CI のシークレットなど、どの方式もこの 1 点に行き着くので、プロバイダに依存しない取り決めはこれしかない。
用意の仕方は、`references.env_setup` のドキュメントに書く。

- 設定ファイルには変数の名前だけを持ち、値は持たない。設定ファイルはコミットされる前提なので、値を書けば事故になる。
- 起動のラッパーを任意で受け取る。`secrets.wrapper` のコマンドを、シークレットが要るコマンドの前に付ける。そうすれば、シークレットマネージャを使う方式でも、スキルが何も知らないまま動く。
- 接続の確認を最初に行い、早く失敗する（全部を行ってからつながらないと分かるのを避けるため）。
  現行 URL に疎通できることと、DB の環境変数が設定されていること（値は表示しない。`test -n "$VAR"` に当たる、あるかどうかの確認だけ）を確かめる。
  失敗したら、`references.env_setup` のドキュメントを（あれば）案内する。
- 値をログ・標準出力・成果物に出さない。ユーザーが値を示してきた場合も、くり返さない（コマンドの例や説明の文は、プレースホルダと環境変数の名前で置き換える。そのまま返すことも、値が外に出る方法になる）。
- プロバイダに固有の取得の手順は対象外である（スキルがセットアップも検証もできないものを、選択肢として出さない。成果物の保存先と同じ線引き）。

## 成果物の保存先（`artifacts`）

- 選択肢は、スキルがセットアップと検証をできるものに限る。
  `local`（デフォルトで、コミットしない）、`git`（容量が増えることを警告する）、`git-lfs`（`git lfs` が入っていることの確認と、`.gitattributes` の設定まで面倒を見る）の 3 つである。
- それ以外の外部の保管は対象外である。選ぶ場合は、ユーザーが用意して転送し、スキルは `metadata.json` にポインタを記録するだけで、検証しないことを明示する。
- テキストの成果物（computed style・aria のスナップショット・メタデータ・強度のレポート・gaps）は、選ぶ余地なく Git に置く。小さく、差分が読め、PR でレビューできるからである。
  この設定の対象は、スクリーンショットなどの大きなバイナリだけである。
- ここで決めるのはデフォルトの値で、`artifacts.overrides.<slug>` で機能ごとに上書きできる（`.gitattributes` はパスを指定できるので、`git-lfs` も機能の単位で成り立つ）。
  上書きは `parity-suite` が受け取り、実際に選ばれた保存先を `metadata.json` に記録する。
- `retention` は版についての設定で、同じ版の 2 回目の採取（ノイズの測定のため）には当てない。
  ノイズの基準値と新側の自分のノイズを測るための 2 回目の採取物は、基準値を記録したら削除する一時的な作業物として扱う。
  `storage` の選択にも、コミットの対象（テキストは Git）にも入れない（手順の原本は `parity-suite` の `references/baseline.md`、新側は `parity-diff` の `references/capture-new.md`）。

## 意図的差異レジストリ（`intentional_diffs`）

「変えない（`keep`）」「変えてよい（`may_change`）」「保留（`pending`。測定の結果で決める）」の 3 つに分ける。
分類の例は、テーブル名、項目名、API のエンドポイント、フロントの URL、リクエストとボディの構造、コンポーネントの配置、ページの構成、ディレクトリ名とファイル名、関数名、変数名、ヘッダー、UI のコンポーネント、型の変換に伴う差、リントによる修正、HTML の id/name である。

- 具体的な中身はプロジェクトごとに違うので、設定ファイルで管理する。スキルが持つのは、分類の枠組みと運用のルールだけである。
- `keep` は、レビューできる状態を保つための決まりである（テーブル名・項目名・API・関数名を保つことで、`parity-replace` の旧と新の差分のレビューが成り立つ）。
- 下流のスキルが実装中に見つけた差は、勝手に判断せず、このレジストリに追記してユーザーに確認する（`parity-replace` の決まり）。
  コンポーネントのライブラリによる系統差（クラスやトークンの単位の宣言）は、`component_diffs` のキーで扱う。
  宣言するのは `parity-replace`（テーマで消せない構造の差を、ユーザーの確認を経て宣言する）で、使うのは `parity-diff`（比較の正規化に使う）である。
  T を当てられないインスタンス単位の例外は、設定ファイルではなく `.replace/parity/<slug>/component-diff-exceptions.json` で扱う。宣言するのは `parity-diff` である（ユーザーの承認を経て追記する。スキーマの原本は `parity-diff` の `references/normalize.md`）。
- `pending` だけは、書き手がスキルである。
  `keep` / `may_change` は人が書く。静的資産で `同等物を作る` を選んだときの `may_change` の宣言は、人が承認した文言をスキルが 1 回記録するだけである。区分の原本は、上記「キーの書き手とライフサイクル」。

### `pending` 要素の形

要素は、どの機能が追記したかが読める形で書く。
帰属が無いと、機能を閉じるときに「この機能が積んだ保留」を挙げられず、判断待ちが機能をまたいで積み上がっても気づけない（`pending` を確定させる工程が無かったときに、実際にそうなった）。

| キー | 必須 | 値 |
|---|---|---|
| `item` | 必須 | 散文の宣言。要素を突き合わせる鍵である（棚卸しと、追記専用の検査が読む。差分との照合キーは `match`）。`keep` / `may_change` へ移すときは、この文言を移す。文言を変えて移すなら、棚卸しの記録の `promoted_as` に移した後の文言を書く（原本は `parity-diff` の `references/convergence.md`「`intentional_diffs.pending` の棚卸し」） |
| `slug` | 必須 | 追記した機能の slug（`.replace/features.md` にあるもの。自分で番号を振らない）。帰属できるなら、必ず slug を書く。`cross-cutting` は、1 つの機能に帰属させられないときだけ使う（複数の機能を対象にした実行で、どの機能にも固有でない差や、機能のスコープを持たない工程）。帰属できるものを `cross-cutting` にすると、閉じる担当が決まらず、毎回の棚卸しに出続ける。機能の slug 以外の名前空間の slug を書かない（部品の slug は、下の箇条を参照） |
| `added_by` | 必須 | 追記したスキルの名前（`replace-strategy`・`golden-dataset`・`parity-suite`・`parity-replace`・`parity-component`）。古い形式から移行して復元できないものだけ `unknown`。この一覧に無い名前を書いても、書き手が分かっているのに `unknown` と書いても、帰属が分からないものとして扱われる |
| `added_at` | 必須 | 追記した日（`YYYY-MM-DD`）。古い形式から移行して復元できないものだけ `unknown`（推測した日付を書かない） |
| `match` | 任意 | 特性照合の差分に当てる照合キー（下記「照合キー（`match`）」）。`keep` / `may_change` へ移すときは、`item` と一緒に移す |

- `slug` は、機能のインベントリに実在するものだけを書く。
  綴りの違う slug や、番号を振り直した slug は、担当する機能が現れない。そのため、`pending-triage-check.mjs` が `.replace/features.md` と突き合わせて、帰属が分からないものとして扱う（すべての機能の棚卸しの対象になる）。
- 帰属を信用できるのは、`added_by` を読めるときだけである。
  `added_by` が無い、`unknown`、または未知のスキル名の要素は、`slug` がどの名前空間のものかを確かめられない。そのため、`pending-triage-check.mjs` が、帰属が分からないものとして、すべての機能の棚卸しの対象にする
  （`cross-cutting` は、書き手に関係なくすべての機能の対象なので、ここには当たらない）。
  古い形式からの移行で `added_by: unknown` を書いた要素は、どの機能の棚卸しにも出続けるので、早めに `keep` / `may_change` へ移すか、書き手を復元する。
- `parity-component` の追記は、必ず `slug: cross-cutting` にする。
  部品は複数の機能にまたがるので、機能に帰属させられない。部品の slug（`.replace/components.md`）は、機能の slug（`.replace/features.md`）と別の名前空間である。
  部品の slug を書くと、どの機能の収束の判定でも「別の機能に帰属する要素」として対象外になり、形の不備も `warn:` で済むので、永久に棚卸しされない。
  `pending-triage-check.mjs` はこの取り違えを検出し、帰属が分からないものとして、すべての機能の棚卸しの対象にする。
- `replace-strategy` の追記も、必ず `slug: cross-cutting` にする。
  意図的差異レジストリを作るのは `setup` の手順 8 で、機能の slug を振るのは手順 9 なので、追記の時点で書ける機能の slug がまだ無い（順序の根拠は `SKILL.md` の `setup` の手順）。
  番号を振った後に機能に帰属させられると分かっても、`cross-cutting` のまま、人が `keep` / `may_change` へ移す。
  帰属の書き換えは既にある値の変更なので、追記専用の検査に当たる。`cross-cutting` は書き手に関係なくすべての機能の棚卸しの対象なので、帰属を直さなくても見落としは起きない。
- `cross-cutting` は予約語である。機能の slug に使わない（使うと、横断の追記と機能の追記を区別できなくなる）。
- 素の文字列の要素も読める（この形式より前に書かれたもの）。
  ただし、帰属が分からないものとして扱い、`slug` に関係なく、どの機能の棚卸しでも示す。
  警告なしに対象外にすると、いちばん古くから積んでいる保留だけが、誰の目にも触れなくなる。
- `keep` / `may_change` の要素は、散文の文字列か、`item` ＋ `match` のオブジェクトである（人が確定させた方針なので、追記元〈`slug`・`added_by`・`added_at`〉を追う必要がない）。
  `pending` から移すときは、`item` の文言（と、あれば `match`）だけを移す。

### 照合キー（`match`）

散文の宣言は、照合キーにならない。
理由・測定の対象・決めた人を添えた文は、`parity-diff` の正規化（`diff-normalize.mjs`）で、差分の論理名とプロパティに一度も当たらない。
特性照合の差分（計算後のスタイル・相対の幾何）に当てる宣言は、要素を `item`（人が読む散文）と `match`（照合キー）のオブジェクトにする。

```yaml
may_change:
  - item: "見出しの border-style: 現行 none・新側 solid。幅は両側 0px で描かれない"
    match: { element: heading, property: border-*-style }
```

- `match` は、`element`（論理名。`*` で glob）と `property`（`*` で glob）が必須で、`page`・`state`・`viewport` が任意である。
  欠けたキーや未知のキーは「どれにでも合う」ではなく、その宣言を照合に使わない。
- 照合の規則と警告の読み方の原本は、`parity-diff` の `references/normalize.md`「意図的差異の照合キー（`match`）」である（ここには転記しない）。
- `match` を書き足すのは、宣言の変更ではない（追記専用の検査〈`append-only-check.mjs`〉も、棚卸しの検査〈`pending-triage-check.mjs`〉も、`item` で要素を突き合わせる）。

### `pending` の棚卸し

機能を閉じる工程が、棚卸しを求める。
追記だけを定めて確定の時期を定めないと、機能の完了の条件は保留の件数を見ないので、保留が残ったまま機能が閉じられ、判断待ちが機能をまたいで積み上がる。
手順と、収束の条件への組み込みの原本は、`parity-diff` の `references/convergence.md`「`intentional_diffs.pending` の棚卸し」である。

- 棚卸しの対象は、次のすべてである（他の機能に帰属する `pending` は対象外）。
  - その機能に帰属する `pending`（`slug` が一致するもの）
  - 横断の `pending`（`slug: cross-cutting`。閉じる工程を持たないので、毎回示す）
  - 帰属が分からない `pending`（素の文字列か、`slug` が無いもの）
- 各件を人に示し、`keep` / `may_change` へ移すか、持ち越す理由を記録する（理由を記録すれば通れるので、機能をずっと止めることはない）。
- 件数を成果物に残す（`.replace/parity/<slug>/new/<target>/diff-metadata.json` の `intentional_diffs_pending`）。積んでいることには、件数で気づく。

### 同じ種類の前例を突き合わせる

レジストリはすべての機能で 1 つだが、判断は機能ごとに下る。
後の機能で「現行に合わせる」と決めても、前の機能で同じ種類の差を「意図的差異」にした判断は、誰も見直さない（逆も同じである）。
後の機能が前の機能のテストの形をまねると、前の判断の浅さまで引き継ぐ。
そこで、同じ種類の差について判断するたびに、前例を探して突き合わせる。

- 契機: 差を意図的差異として確定するとき（`pending` から `keep` / `may_change` へ移すとき、`parity-diff` のトリアージで「許容」を承認するとき）と、
  意図的差異にできる種類の差を「現行に合わせる」（`parity-diff` の分類で要対応）と決めたときの両方である。
- 探し方: 差の種類を表す語を検索語にして、`keep` / `may_change` / `pending` のすべての要素と、すべての機能の `.replace/parity/<slug>/new/<target>/diff.md` の分類を探す。
  検索語は、プロパティ名（`border-style` など）、要素の役割（見出し・ボタン）、状態や軸（0 件の表示・送っている間）、URL と状態の持ち方である。
- 検出されることの確認: 同じ検索語・同じ範囲で、今回判断する差そのものの記録（棚卸しで移す `pending` の要素、または自分の機能の `diff.md` の該当の行）が当たることを確かめる。
  当たらなければ、検索語か範囲（パス・glob・レジストリのキー）が誤っているので、「前例なし」とせずに探し直す。当たった自分自身は、前例から除く。
- 記録: 判断した差ごとに、`diff.md` の根拠に前例を書く（棚卸しで移す `pending` は、`diff.md` の棚卸しの内訳に書く）。当たった宣言か他の機能の差分、または `なし（検索語: <語>, <語>）` である。
  検索語と、検出されることの確認で当たった記録の無い「前例なし」は書かない（`なし（検索語: <語>, <語>／自身: <当たった記録>）` と書く。探したのか、何も見ていない検索だったのかを区別できないからである）。
- 食い違ったら（前例が逆の判断なら）、どちらかを見直すか、違ってよい理由を書く。どれにするかは利用者に確かめる（判断の材料として、両方の差と前例の根拠を並べる）。
  - 前の機能の判断を見直すなら、前の機能に当て直す作業として、`.replace/procedure-changes.md` に行を足して追う（台帳と判断の語の原本は [`procedure-changes.md`](procedure-changes.md)。
    レジストリの宣言を消すのは人である。`keep` / `may_change` は人が書くキーだからである）。
  - 今回の判断を前例に合わせるなら、分類をやり直す。
  - 違ってよいなら、その理由を 2 か所に書く。今回の `diff.md` の根拠と、意図的差異にした側の宣言の文言である（次に探した人が、同じ食い違いで止まらないように）。
