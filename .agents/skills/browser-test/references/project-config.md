# プロジェクト設定の解決

環境（名前・URL・認証・デフォルト・禁止操作）とローカルの起動方法はリポジトリごとに違うので、次の順で解決する。デフォルトの値は埋め込まない。

呼び出し元のスキルから環境を渡されたときは、この解決をしない。
他のスキル（`parity-suite`・`parity-replace`・`parity-diff` など）が解決済みの環境を渡してこのスキルを起動したときは、渡された環境をそのまま使う。
設定ファイルの参照、リポジトリの探索、ユーザーへの確認は、どれもしない。
`browser-test` の設定（`environments`）との対応づけもしない。
このとき、設定ファイルを開かず、存在も確かめず、内容にも触れない。
「参照していない」ことを示す目的でも読まない。読んだ内容が判断や応答に入り込むのを、元から防ぐためである。

- 受け渡す形は `{url, pre_commands, start, check_urls, forbidden_actions}` の 5 つのキーだけである。
  各キーの意味は、下の「環境エントリの実行順」と同じである。
  渡されなかったキーは、省いたときの扱いに従う（`forbidden_actions` が無ければ読み取り専用、も同じ）。
  知らないキーは無視する（呼び出し元が独自のキーを持っていても解釈しない）。
- `url_command` を持つ環境は、呼び出し元が解決した `url` を渡す。
  `url_command` そのものは渡さず、このスキルは受け取った `url` をそのまま使う。
- `auth` は渡さない。認証は、呼び出し元が済ませてから渡すか、ユーザーがログインする（このスキルから見ると `auth: user` と同じ）。
- このスキルの環境エントリと `replace-strategy` の `targets` は、`auth` の型が違う（このスキルは `none | user`、`replace-strategy` はロールの構造）。
  そのため、エントリを互いにコピーせず、それぞれの設定ファイル（`browser-test.jsonc` と `replace-strategy.jsonc`）に別々に書く。

1. 設定ファイル: `browser-test` の設定に `environments` があれば、その設定に従う（読み方は下の「設定ファイル」）。
2. リポジトリの探索: 設定が無ければ、次から推定する。推定した内容（URL・起動コマンド・認証）は、ユーザーに確かめてから使う。
   - `package.json` の scripts（`dev`・`start`）
   - dev サーバーの設定（`vite.config`・`next.config` などの port）
   - `README.md`・`AGENTS.md`・`CLAUDE.md`・`CONTRIBUTING.md` にある起動の手順と環境の一覧
3. 解決できなければユーザーに確かめる: 環境の URL、起動の方法、認証の有無、環境ごとの禁止操作（`forbidden_actions`）を確かめる。
   確かめた後、「`.config/skills/shoji9x9/browser-test.jsonc` の `environments` に記録すれば、次回からその設定を参照する」ことを伝える。
   了承を得たら、下の「記録する」に従って書く。

## 設定ファイル

設定は `browser-test` の名前の設定ファイルに書く。置き場所・層・解決の順序・書き込みの決まりは [`config-files.md`](config-files.md) で定義する。
キーは `environments` だけで、型はスキーマ（`config-schemas/browser-test.schema.json`）で定義する。
全員が使う環境はリポジトリの層（`.config/skills/shoji9x9/browser-test.jsonc`）に置く。
このリポジトリで自分だけが使う環境（手元のポートなど）は、人ごと・リポジトリ限定の層（`browser-test.local.jsonc`）に置ける。
`.local.jsonc` の `environments` は、リポジトリの層の一覧を丸ごと置き換える（要素ごとには混ぜない）。

読むときは、同梱の読み取りを使う。読み取りが exit 1（設定の誤り）で終わったら、推定に進まずにエラーを示して止まる。
exit 3（どの層にも無い）なら、上の解決の手順の 2 に進む。
Node.js が無いときは、3 つの層のファイルを確かめる。どれも無ければ手順の 2 に進み、1 つでもあれば止まる。
3 つの層のファイルは、`.config/skills/shoji9x9/browser-test.jsonc`・`browser-test.local.jsonc`・`${XDG_CONFIG_HOME:-~/.config}/skills/shoji9x9/browser-test.jsonc` である。

```bash
node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs get browser-test environments --raw
```

```jsonc
// .config/skills/shoji9x9/browser-test.jsonc
{
  "environments": [
    {
      "name": "local", // 環境名（ユーザーへの提示に使う）
      "url": "http://localhost:5173",
      "auth": "none", // none | user（user = ユーザーがログインを実施）
      "pre_commands": [], // 任意。start の前提となる環境準備コマンド列（build 等）。起動が必要なときだけ実行し、失敗したら停止する
      "start": "pnpm run dev", // ローカル起動コマンド（稼働していないとき提示する）
      // 稼働確認に使う URL（省略時は url のみ）
      "check_urls": ["http://localhost:5173/", "http://localhost:3001/"],
      "default": true, // 既定の環境
      "forbidden_actions": [] // この環境で実施しない操作。空 = すべて実施可（副作用を伴う操作は承認制）
    },
    {
      "name": "dev",
      "url": "https://dev.example.com",
      "auth": "user",
      // forbidden_actions が未定義の環境は読み取り専用として扱う
      "forbidden_actions": ["データの作成・変更・削除", "分析ジョブの開始（課金を伴う）"]
    },
    {
      "name": "preview",
      // url と排他。標準出力に URL を 1 行出す（ブランチ連動のプレビュー環境等、URL を固定文字列で書けない環境向け）。実行のたび解決し、失敗・空出力は停止
      "url_command": "<コマンド>",
      "auth": "user",
      "forbidden_actions": ["データの作成・変更・削除"]
    }
  ]
}
```

### 記録する

- 書く値は、探索かユーザーへの確認で得た、実在する環境と起動方法にする。上の URL・ポート・コマンド・禁止操作は例なので、そのままコピーしない。
- 作成と追記は非破壊にする。書くのは `environments` だけで、既にあるキー・値・コメントと、他のスキルの設定ファイルは変えない。
- `environments` が無ければ、`set` で一覧ごと書く。既にあれば、同じ `name` の無い環境だけを `append --unique-by name` で足す。
  既にある環境の値は変えない。変えるのは、今の値と新しい値を示してユーザーの了承を得た後だけにする（`--replace`）。
- 書き込みの決まり（コメントと整形を残す・書いた後に検証する・`.local.jsonc` は gitignore を確かめる）は、[`config-files.md`](config-files.md)「書き込みの決まり」で定義する。

```bash
CFG=<このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs
node "$CFG" set browser-test environments '[{"name":"local","url":"http://localhost:5173","auth":"none","forbidden_actions":[]}]' --layer repo
node "$CFG" append browser-test environments '{"name":"dev","url":"https://dev.example.com","auth":"user"}' --layer repo --unique-by name
```

### 環境エントリの実行順

環境エントリの各項目は、次の順で扱う。
1 の稼働の判定で動いていないと分かることは、止まる条件ではなく、起動（3）に進む合図である。
それ以外の失敗（`url_command` の解決、`pre_commands`、`start`、4 の再確認）が起きたら、そこで止まる。後に進まず、確認も始めない。

`url_command` を持つ環境は、まずそれを実行して `url` を解決してから 1 へ進む。
`url_command` と `url` は同時に持てず、両方ある場合もどちらも無い場合も止まる。
コマンドが失敗したときと出力が空のときはここで止まり、代わりの方法を試さない。
解決した URL は、ログや成果物に書き出さない（環境名で識別する）。
ブランチ名からエイリアスへの変換など、プロバイダに固有の取得の規則は、プロジェクトのスクリプトが受け持つ。このスキルは関わらない。

1. `check_urls`（省いたときは `url` だけ）につながるかを確かめ、動いているかを先に判定する。
2. 動いていれば、`pre_commands` も `start` も実行しない（そのまま確認へ進む）。
3. 動いていなければ、`pre_commands`（任意。起動のために環境を準備するコマンド。build など）、`start`（長く動き続ける起動コマンド）の順で起動する。
4. 起動した後、`check_urls` につながるかをもう一度確かめる。

`pre_commands` は `start` の前提なので、`start` と同じく、稼働の判定の後（起動が必要なときだけ）実行する。
動いている環境に対して、条件なしに実行しない。読み取り専用の確認しか要らない場面で、build や codegen などの副作用を承認なしに起こさないためである。
このスキル（browser-test）は `pre_commands` と `start` のどちらも自動で実行せず、両方をまとめて示してユーザーに実行を促す（このスキルのフローの手順 2）。
参照する側のスキルが自動で実行するかは、各スキルの手順が決める（自動で実行する場合も、1〜4 の条件付きの実行順は共通である）。

この実行順と各項目の意味（`url`・`url_command`・`pre_commands`・`start`・`check_urls`・`forbidden_actions`）は、このファイルを原本とする。
同じ形の環境の定義を持つ他のスキル（`replace-strategy` の `targets` など）は、ここを参照する。
`auth` はこの対象に含めない。このスキルの `auth: none | user` は browser-test に固有で、参照する側は独自に定義する。

## セットアップモード（`browser-test setup`）

上の解決を対話で先に行い、結果を設定ファイルに記録するモードである。回帰の確認はしない。

1. リポジトリの探索（解決の手順の 2）で、環境・起動コマンド・稼働の確認に使う URL の候補を推定する。
2. 推定した候補を示しながら、次を対話で確かめる。選択式の質問には、推定した候補を判断の材料と一緒に添える。
   - 環境の一覧（名前・URL・認証の有無と方法・デフォルトの環境）
   - 起動に必要な事前のコマンド（`pre_commands`。build など。不要なら空にする）、ローカルの起動コマンド、稼働の確認に使う URL
   - 環境ごとの禁止操作（`forbidden_actions`。その環境で実施しない画面の操作。すべて実施してよいなら空にする）
3. 確かめた結果を、上の「記録する」に従って `browser-test` の設定ファイルに書く。全員が使う環境はリポジトリの層に、自分だけの環境は `.local.jsonc` に書く。
   既存の値と違う回答を得た環境は、今の値と新しい値を示し、ユーザーの了承を得てから更新する（他のスキルの設定ファイルには触れない）。
