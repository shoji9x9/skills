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
    current: # 現行アプリ
      repo: <owner/repo | ローカルパス | none> # コードの入手性。無ければ none
      url: <URL> # 測定・特性化の対象環境（本番ではないテスト環境）
      stack: [] # 現行のスタック（バックエンド言語・フロントフレームワーク）。測定・対話で判明した値を記録する
      db:
        env_vars: [CURRENT_DB_URL] # 接続情報を持つ環境変数の「名前」。値は書かない
    new: # 新側アプリ
      repo: <owner/repo | ローカルパス>
      url: <URL | none> # 開発前は none
      db:
        env_vars: [NEW_DB_URL]
    auth: # 認証方式は現・新で異なりうるため側ごとに分ける（parity-suite が読む）
      current:
        env_vars: [CURRENT_APP_USER, CURRENT_APP_PASSWORD] # 現行側の代表ユーザー認証情報の環境変数名（ロール別は名前を増やす）
      new:
        env_vars: [NEW_APP_USER, NEW_APP_PASSWORD] # 新側（開発前は空でよい）
    secrets:
      wrapper: "" # 任意の起動ラッパー（例: aws-vault exec dev --）。シークレットが要るコマンドの前に付ける
    forbidden_actions: # 現行アプリに対して実施しない操作（未定義なら読み取り専用として扱う）
      - データの削除
    parity_suite_dir: e2e/ # パリティスイートの配置（parity-suite が読む。未指定時は e2e/）
    dataset_tool_dir: seed/ # golden-dataset の投入ツールの配置先（golden-dataset が読む。未指定時は seed/）
    static_analysis: # 新側の静的解析・動的解析の起動コマンド（parity-replace が読む。固有のツール名は設定側に置く）
      - <コマンド>
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
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、このスキルが使うキー（`skills.replace-strategy`）だけを書く。指定値は**探索またはユーザー確認で得た実在の値**にする（上の URL・変数名・コマンドは例なので、そのまま盲目コピーしない）。既にあれば欠けたキーだけを該当セクションに追記し、既存のキー・値・コメントは変更しない。値が既にあれば尊重し上書きしない。
- **references は横断的**（1 つを複数スキルが読む）なので、per-skill ではなく `replace-strategy` に集約する。references のファイル自体は人間が書くプロジェクト知識だが、`setup` が DDL・測定結果・技術スタックから下書きを生成し、**人間がレビューして確定する**（特に `db_semantics` は専門的なため）。
- references は知識の注入であって検証の代替ではない。注入された差（例: 現行 DB の空文字と NULL の扱い、collation による並び順）は意図的差異レジストリに落とし込み、実際の検証は `golden-dataset`（フェーズ B の一致検証）・`parity-suite`（API の並び順特性化）が担う。

## シークレットの扱い（スキル群共通のルール）

DB 接続情報もアプリの認証情報も、**スキルは環境変数から読む**。**環境変数をどう用意するかはプロジェクトの責務であり、スキルの外**とする。`.env`・シークレットマネージャのラッパー・CI のシークレットなど、あらゆる方式がこの一点に収束するため、プロバイダ非依存の契約はこれしかない。用意方法は `references.env_setup` のドキュメントに書く。

- **設定ファイルには変数名だけを持ち、値は持たない。** 設定ファイルはコミットされる前提であり、値を書けば事故になる
- **起動ラッパーを任意で受け取る**: `secrets.wrapper` の前置コマンドを、シークレットが要るコマンドの前に付ける。これでシークレットマネージャ系も**スキルが何も知らないまま**動く
- **接続確認を最初に行い、早期に失敗する**（全部やってから繋がらないと分かるのを避けるため）。現行 URL への疎通と、DB の環境変数が設定されていること（値は表示しない。`test -n "$VAR"` 相当の存在確認のみ）を確認する
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
- 下流スキルが実装中に発見した差異は、勝手に判断せずこのレジストリへ追記してユーザーに確認する（`parity-replace` の規約）。コンポーネントライブラリ由来の系統差（クラス／トークン単位の宣言）は `parity-diff` が別キーで定義する。
