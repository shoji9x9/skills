# プロジェクト設定の解決

環境（名前・URL・認証・既定・禁止操作）・ローカル起動方法はリポジトリごとに異なるため、次の順で解決する。既定値は埋め込まない。

**呼び出し元スキルから環境を渡された場合はこの解決を行わない**: 他スキル（`parity-suite` / `parity-replace` / `parity-diff` 等）が解決済みの環境を渡して本スキルを起動したときは、
設定ファイルの参照・リポジトリ探索・ユーザー確認をいずれも行わず、渡された環境をそのまま使う（`skills.browser-test.environments` との対応付けもしない）。

- **受け渡しの形は `{url, pre_commands, start, check_urls, forbidden_actions}` の 5 キーのみ**（意味論は下記「環境エントリの実行順」と同じ）。渡されなかったキーは省略時の扱いに従う
  （`forbidden_actions` の未定義＝読み取り専用も同じ）。**未知のキーは無視する**（呼び出し元が独自キーを持っていても解釈しない）
- **`auth` は渡さない。** 認証は呼び出し元が済ませてから渡すか、ユーザーがログインを実施する（本スキルから見れば `auth: user` 相当）
- 本スキルの環境エントリと `replace-strategy` の `targets` は `auth` の型が異なる（本スキルは `none | user`、`replace-strategy` はロール構造）ため、**エントリを相互にコピーしない**

1. **設定ファイル**: `.config/skills/shoji9x9/skills.yml` に `skills.browser-test` があれば、その設定に従う。
2. **リポジトリ探索**: 無ければ `package.json` の scripts（`dev` / `start`）、dev サーバ設定（`vite.config` / `next.config` 等の port）、`README.md` / `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` の起動手順・環境一覧から推定する。推定した内容（URL・起動コマンド・認証）はユーザーに確認してから使う。
3. **解決できなければユーザーに確認**: 環境 URL・起動方法・認証の有無・環境ごとの禁止操作（`forbidden_actions`）を確認する。確認後、「`.config/skills/shoji9x9/skills.yml` の `skills.browser-test` に記録すれば次回以降その設定を参照する」旨を伝え、了承を得たら下記要領で非破壊に追記する。

## 設定ファイル（`.config/skills/shoji9x9/skills.yml`）

`shoji9x9/skills` 配布物がインストール先で参照するプロジェクト設定。人手で編集でき、`gh skill update` は skill ディレクトリ外のこのファイルに触れないため設定は保持される。

```yaml
version: 1
skills:
  browser-test:
    environments:
      - name: local # 環境名（ユーザーへの提示に使う）
        url: http://localhost:5173
        auth: none # none | user（user = ユーザーがログインを実施）
        pre_commands: [] # 任意。テスト前に順に実行するコマンド列（build 等）。失敗したら停止する
        start: pnpm run dev # ローカル起動コマンド（稼働していないとき提示する）
        check_urls: # 稼働確認に使う URL（省略時は url のみ）
          - http://localhost:5173/
          - http://localhost:3001/
        default: true # 既定の環境
        forbidden_actions: [] # この環境で実施しない操作。空 = すべて実施可（副作用を伴う操作は承認制）
      - name: dev
        url: https://dev.example.com
        auth: user
        forbidden_actions: # forbidden_actions が未定義の環境は読み取り専用として扱う
          - データの作成・変更・削除
          - 分析ジョブの開始（課金を伴う）
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、このスキルが使うキー（`skills.browser-test`）だけを書く。指定値は**探索またはユーザー確認で得た実在の環境・起動方法**にする（上の URL・ポート・コマンド・禁止操作は例なので、そのまま盲目コピーしない）。
  既にあれば欠けたキーだけを該当セクション（無ければ親も）に追記し、既存のキー・値・コメントは変更しない。値が既にあれば尊重し上書きしない。

### 環境エントリの実行順

環境エントリの各項目は次の順で扱い、**いずれかが失敗したらそこで停止する**（後続へ進まず、確認も始めない）。

1. `pre_commands`（任意）: テスト前に順に実行するコマンド列（build 等）。1 つでも失敗したら停止する
2. `start`: 長時間実行する起動コマンド。**稼働していないとき（`check_urls`〈省略時は `url`〉の疎通が取れないとき）だけ使う**——稼働判定が先で、稼働中なら実行しない。
   本スキル（browser-test）は自動実行せず、コマンドを提示してユーザーに起動を促す（本スキルのフロー手順 2）。**参照側スキルが自動実行するかは各スキルの手順が定める**
3. `check_urls`: 稼働確認に使う URL（省略時は `url` のみ）への疎通確認（`start` の要否判定と、起動後の稼働確認の両方に使う）

この実行順と各項目の意味論（`url` / `pre_commands` / `start` / `check_urls` / `forbidden_actions`）は**本ファイルを正本**とし、
他スキル（`replace-strategy` の `targets` など、同じ形の環境定義を持つもの）はここを参照する（`auth` は対象外——本スキルの `auth: none | user` は browser-test 固有で、参照側は独自に定義する）。

## セットアップモード（`browser-test setup`）

上記の解決を対話的に先回りして行い、結果を設定ファイルに記録するモード。回帰確認は行わない。

1. リポジトリ探索（解決手順の 2）で環境・起動コマンド・稼働確認 URL の候補を推定する
2. 推定した候補を提示しながら、次を対話で確認する。選択式の質問には推定候補を判断材料ごと添える
   - 環境の一覧（名前・URL・認証の有無と方法・既定の環境）
   - テスト前に必要な事前コマンド（`pre_commands`。build 等。不要なら空にする）・ローカル起動コマンド・稼働確認 URL
   - 環境ごとの禁止操作（`forbidden_actions`。その環境で実施しない画面操作。すべて実施可なら空にする）
3. 確認結果を `skills.browser-test` に書き込む。新規作成・欠けたキーの追記は上記「作成・追記は非破壊」に従う。
   既存の値と異なる回答を得たキーは、現在値と新しい値を提示してユーザーの了承を得てから更新する（他スキルのキー・コメントには触れない）
