# プロジェクト設定の解決

現・新のリポジトリ／URL・DB 接続・環境・禁止操作・成果物方針・意図的差異レジストリ・references はリポジトリごとに異なるため、次の順で解決する。既定値は埋め込まない。

1. **設定ファイル**: `.config/skills/shoji9x9/skills.yml` に `skills.replace-strategy` があれば、その設定に従う。
2. **リポジトリ探索**: 無ければ `README.md` / `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` から現行アプリの URL・リポジトリ・DB の手がかりを推定する。推定した内容はユーザーに確認してから使う。
3. **解決できなければユーザーに確認**: `setup` モードの対話セットアップがこの確認を先回りして行い、結果を設定ファイルへ記録する。

## 設定ファイル（`.config/skills/shoji9x9/skills.yml`）

`shoji9x9/skills` 配布物がインストール先で参照するプロジェクト設定。人手で編集でき、`gh skill update` は skill ディレクトリ外のこのファイルに触れないため設定は保持される。

**このキーは姉妹スキル（`golden-dataset` / `parity-suite` / `parity-replace` / `parity-diff`）が直接読む共有契約である。** キー名・構造を変える場合は姉妹スキル側の参照も併せて更新する。

```yaml
version: 1
skills:
  replace-strategy:
    current: # 現行アプリ（URL・DB・認証・禁止操作は targets の side: current が持つ）
      repo: <owner/repo | ローカルパス | none> # コードの入手性。無ければ none
      stack: [] # 現行のスタック（バックエンド言語・フロントフレームワーク）。測定・対話で判明した値を記録する
    new: # 新側アプリ（URL・DB・認証・禁止操作は targets の side: new が持つ）
      repo: <owner/repo | ローカルパス>
    targets: # 現・新の実行対象環境。複数定義し、各スキルの --target <name> で選択する（下記「実行対象環境」）
      - name: current-test # 環境名。小文字英数とハイフンで、全 target を通して一意（--target での指定・成果物ディレクトリ名に使う）
        side: current # current | new。必須（省略時の既定は無い。無ければ停止）
        url: <URL> # UI の baseURL。current 側は測定・特性化の対象環境（本番ではないテスト環境）
        api_url: <URL> # API の baseURL。UI と別 origin のときだけ指定する（省略時は url を使う）
        db:
          env_vars: [CURRENT_DB_URL] # この環境の DB 接続情報を持つ環境変数の「名前」。値は書かない。書く＝スキルが接続を読んでよい（書かない target の DB にスキルは一切触れない）
          seedable: true # true のときだけ golden-dataset の投入対象。省略・false は読み取り専用接続（接続は読むが削除・投入をしない）
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
        auth:
          roles:
            admin:
              user_name_env: NEW_ADMIN_USER
              password_env: NEW_ADMIN_PASS
        forbidden_actions: []
        pre_commands: [] # テスト前に順に実行するコマンド列（build 等）。失敗したら停止する
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
    dataset_mode: db # ゴールデンデータセットの実体（下記「データセットの実体」）。db（既定・省略可）| static
    dataset_static_paths: [] # dataset_mode: static のとき必須。投入ツールが生成・削除してよいパス（これ以外へ書いたら停止）
    verification_commands: # 完了前に実行する検証コマンド列（静的解析・単体テスト・統合テスト等。parity-replace が読む。固有のツール名は設定側に置く）
      - <コマンド> # 環境準備・起動・URL 解決は含めない（それらは targets の pre_commands / start / check_urls）。環境に依存しないコード検証のため、どの target でも同じ列を一律に実行する
    artifacts:
      retention: latest # ワークツリーは最新のみ。履歴は Git が持つ
      storage: local # local（既定・コミットしない）| git | git-lfs — 大きなバイナリの既定保存先
      size_threshold_mb: 50 # 超過時に警告する
      overrides: {} # 機能ごとの上書き（例: order: git-lfs）
    references: # 利用者が選ぶ知識の注入。パスだけを持つ（本文はファイル側）
      ui_library: <path> # 新 UI ライブラリ設定と旧→新 design token マッピング（parity-replace / parity-diff が読む）
      db_semantics: <path> # 現行 DB → 新 DB の型マッピングと意味論の差（golden-dataset / parity-suite が読む）
      env_setup: <path> # 環境変数の用意方法（全スキル）
      # キーは追加できる
    intentional_diffs: # 意図的差異レジストリ
      keep: [] # 変えない（例: テーブル名、項目名、API エンドポイント、関数名）
      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名、HTML の id/name、型変換に伴う差異）
      pending: [] # 保留（測定結果で決める）
    component_diffs: [] # コンポーネント系統差レジストリ。クラス/トークン×プロパティ単位の系統差 T（旧値→新側で期待される値）。parity-replace がテーマで消せない構造差をユーザー確認の上で宣言し、parity-diff が比較の正規化に使う（インスタンス単位の例外は component_diff_exceptions へ）。要素の形の正本は本ファイル: { component, property, current, new, reason }
    component_diff_exceptions: [] # T が引けない箇所のインスタンス単位例外。宣言者は parity-diff（ユーザー承認の上で追記）。スキーマ正本は parity-diff の references/normalize.md。要素の形は { slug, page, element, state, viewport, property, current, new, reason }
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、このスキルが使うキー（`skills.replace-strategy`）だけを書く。指定値は**探索またはユーザー確認で得た実在の値**にする（上の URL・変数名・コマンドは例なので、そのまま盲目コピーしない）。既にあれば欠けたキーだけを該当セクションに追記し、既存のキー・値・コメントは変更しない。値が既にあれば尊重し上書きしない。
- **references は横断的**（1 つを複数スキルが読む）なので、per-skill ではなく `replace-strategy` に集約する。references のファイル自体は人間が書くプロジェクト知識だが、`setup` が DDL・測定結果・技術スタックから下書きを生成し、**人間がレビューして確定する**（特に `db_semantics` は専門的なため）。
- references は知識の注入であって検証の代替ではない。注入された差（例: 現行 DB の空文字と NULL の扱い、collation による並び順）は意図的差異レジストリに落とし込み、実際の検証は `golden-dataset`（フェーズ B の一致検証）・`parity-suite`（API の並び順特性化）が担う。

## 実行対象環境（`targets`）

現・新の実行対象環境を環境名で複数定義し、各スキル実行時に `--target <name>` で選択する。local-dev / local-production / preview / develop など、同じスイートを当てる環境をここに並べる。

- **エントリ項目の意味論の正本は `browser-test` の `references/project-config.md`**（`url` / `url_command` / `pre_commands` / `start` / `check_urls` / `forbidden_actions` の意味と、
  実行順 `url_command` の解決 → `pre_commands` → `start` → `check_urls`・失敗時の早期停止。ただし `forbidden_actions` の適用範囲は下記のとおり本ファイルが定義する）。
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
- **`api_url`**: API の baseURL。UI と API が別 origin のときだけ指定し、省略時は `url` を使う（api-resource モードは現行応答を正に同一リクエストを新側へ送るため、UI とは別に選べる必要がある）
- **選択規則**: 各スキルは自分が対象とする側の target だけを候補にする——`parity-suite`・`golden-dataset`（フェーズ A）は `side: current`、`parity-replace` / `parity-diff`・`golden-dataset`（フェーズ B）は
  `side: new`（`side` は設定の値であり、スキルの引数ではない）。`--target` 省略時はその側で `default: true` の target を使い、無ければ候補を提示してユーザーに確認する。存在しない名前・側違いの名前は停止する（勝手に読み替えない）
- **`db` / `auth` / `forbidden_actions` は target ごとに定義する**（側の既定・フォールバックは持たない。複数 target で同じ値になる場合も各エントリに書く——共有したければ YAML アンカーを使ってよい）
- **`db` は「接続を知っている」、`db.seedable` は「シードしてよい」——2 段の契約**（`dataset_mode: db` のときの投入先解決の正本。`static` の扱いは下記「データセットの実体」）:

  | `db` の宣言 | 意味 | `golden-dataset` | 読み取り（バッチの出力一致検証など） |
  |---|---|---|---|
  | 未定義 | この target の DB にスキルは**一切触れない** | 投入対象外 | しない |
  | `env_vars` のみ | 読み取り専用接続 | 投入対象外 | する |
  | `env_vars` ＋ `seedable: true` | 投入してよい環境 | 投入対象（フェーズ A は `side: current`、フェーズ B は `side: new` の選択 target） | する |

  - **`seedable` は投入の設定由来ゲート**である。`golden-dataset` は自己申告の「本番でないことの確認ゲート」に加えてこのゲートを通す（安全弁を 2 枚にし、設定ミス・判断ミスの単一障害点を無くすため）。既定は deny——省略・`false` は読み取り専用として扱う
  - 同じ DB を複数 target が共有する場合も target ごとにフェーズ B を実行して記録する（投入ツールは冪等なので再実行は安全）
  - **投入対象外の target**（`db` 未定義／`seedable` なし）では、`parity-diff` はデータセットバージョンの三者一致を免除する代わりに
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

### `on_diff`（要対応差分が出たときの対応）

環境ごとに「差分を見つけた後にどう動くか」は運用次第で異なり、手順の自由度が高い（先行環境での再テスト・commit と push・デプロイ反映待ち・Issue 起票など）。
そのため構造化キーでは持たず、**対応手順を書いた Markdown ファイルのパスを 1 つ持つ**（`references` と同じ「知識の注入」の形。ファイルはプロジェクトが書く）。

- **省略時の既定挙動**: `parity-diff` は `diff.md` を差し戻し入力に同じ target の `parity-replace` へ渡し、`parity-replace` は修正して対象 target で再テストする
- ドキュメントには、この target で再テストする前に green を確認すべき環境、修正の反映手順（commit・push・デプロイ）、反映完了の確認方法、
  修正ループを回さず Issue を起票して停止する運用（マージ後デプロイ環境等）などを自由に書く
- **挙動を厳密にしたい手順は、ドキュメントからスクリプトへリンクし、スキルにそれを実行させる**（決定論的にしたい部分はスクリプトが担い、ドキュメントは手順の骨格と分岐を持つ）
- 解釈するのは `parity-replace`（修正後の再テスト・反映）と `parity-diff`（差し戻すか・起票するか）。従ったドキュメントのパスを成果物（`replace-metadata.json` / `diff-metadata.json`）に記録する。
  `side: current` の target に書かれた `on_diff` は読まれない（現側は修正対象ではないため。書いても無視される）
- **ガードレール**（on_diff ドキュメントの指示より優先する。順に）:
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

## 移行（旧キーからの更新）

旧スキーマ（単一 URL・側ごとの DB／認証・単一リストの禁止操作・`static_analysis`）からは次の対応で移行する。**スキルは旧キーをフォールバックとして読まない**——旧キーを見つけたら、この移行手順を示して停止する。

**検出対象の旧キー一覧**（各スキルはこの一覧を参照して検出する。`current:` ブロック自体は新スキーマにも存在する〈`repo` / `stack`〉ため、ブロック単位ではなく**キー単位**で検出する）:
`current.url` / `new.url` / `current.db` / `new.db` / `auth.current` / `auth.new` / `forbidden_actions`（**`skills.replace-strategy` 直下**の単一リスト。`targets[].forbidden_actions` は新スキーマの正規キーであり検出対象ではない）/ `static_analysis`

| 旧 | 新 |
|---|---|
| `current.url` | `targets` に `side: current` のエントリを作り `url` へ（`default: true` を付ける） |
| `new.url` | `targets` に `side: new` のエントリを作り `url` へ（値が `none` の場合は `url: none` のまま移すが、**`default: true` は付けない**——動く target ができた時点で付ける） |
| `current.db` / `new.db` | 対応する側の各 target の `db.env_vars` へ（DB を**読んでよい環境にだけ**書く。書かない target の DB にはスキルは触れない）。**投入してよい環境にはさらに `db.seedable: true` を足す**（下記） |
| `auth.current` / `auth.new` | 対応する側の各 target の `auth.roles.<ロール名>.{user_name_env,password_env}` へ。旧フラットリストのどの変数がユーザー名／パスワードかは**名前から推測せずユーザーに確認**する。旧 `auth.new` が空リストだった場合は `auth` を省略のまま移行せず、`setup` で新側の認証情報を確認して埋める |
| `forbidden_actions`（単一リスト） | `side: current` の target の `forbidden_actions` へ。**新側 target には `forbidden_actions: []` を明示的に置く**（空リスト＝すべて実施可。未定義＝読み取り専用とは意味が異なる） |
| `static_analysis` | `verification_commands` へ（コマンド列は変更不要。環境準備・起動が混ざっていたら target の `pre_commands` / `start` へ移す） |
| 成果物レイアウト: `.replace/parity/<slug>/` 直下の `replace-metadata.json` / `diff.md` / `diff-metadata.json` / `baseline-new/` | `.replace/parity/<slug>/new/<target>/` へ移動する。`<target>` は旧 `new.url` から移行で作った `side: new` の target 名。移動後、`replace-metadata.json` の `new` に `target: <その名前>` を追記する |

- **target 名は一度決めたら変えない。** 現側 target 名の変更はベースライン陳腐化（全 slug の再取得）、新側 target 名の変更は `new/<target>/` 配下の証跡との不一致を生む。移行時は環境の役割が分かる名前（例: `current-test` / `local-dev`）を付ける

### `db.env_vars` の意味変更（`seedable` の明示要求）

`targets` スキーマ導入時は `db.env_vars` の存在が「接続を知っている」と「シードしてよい」を兼ねていたが、現在は `db.seedable: true` が投入対象の条件である（上記「`db` は『接続を知っている』…」）。キー名は変わらないため機械的には検出できない。

- `db.env_vars` を持つが `seedable` の無い target を投入先に選ぶと、`golden-dataset` は**投入せず停止する**（fail-closed）。投入してよい環境なら `seedable: true` を足し、読み取り専用のままでよければ投入先を変える
- 投入対象外になった target は `parity-diff` の三者一致免除対象になる（`diff.md` の未検証領域にデータ依存差分が積まれる）ため、**意図せず読み取り専用へ落ちていないか**を移行時に確認する

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
  宣言者は `parity-replace`（テーマで消せない構造差をユーザー確認の上で宣言）、利用者は `parity-diff`（比較の正規化に使う）。T が引けないインスタンス単位の例外は `component_diff_exceptions` キーで扱い、宣言者は `parity-diff`（ユーザー承認の上で追記）。
