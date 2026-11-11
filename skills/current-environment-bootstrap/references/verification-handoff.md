# 起動・到達の検証と引き渡し（工程 7・8・9）

結果は `.replace/bootstrap/verification.md`（テンプレート: [`../assets/verification-template.md`](../assets/verification-template.md)）と
`.replace/bootstrap/metadata.json`（テンプレート: [`../assets/metadata-template.json`](../assets/metadata-template.json)）に記録する。

## 工程 7: 起動・疎通・認証・主要な画面への到達を実測する

すべて実測する。「起動するはず」「ログインできるはず」は、検証していないのと同じである。

1. 起動
   - 選んだ target を `check_urls`（省略したときは `url`）で稼働の判定をする。落ちているときだけ、`pre_commands` → `start` の順に起動して確かめ直す。
   - 意味と、条件によって変わる実行順は、`browser-test` の `references/project-config.md` で定義する。
     最初の稼働の判定の失敗は起動の合図で、それ以外の失敗ではそこで止まる。
2. 疎通: 解決した URL に実際にアクセスし、応答が返ることを確かめる
3. 認証: `auth.roles` の**各ロール**で、実際にログインする。環境変数が在るかの確認だけで済ませない。値は出力しない。
   ロールごとに結果を記録する。1 つのロールでも通らなければ、そのロールでしか見えない画面は検証していないことになる
4. 主要な画面への到達: 受領資産から把握できる主要な画面に実際に到達し、エラーの表示なく描画されることを確かめる。
   到達できた画面と、到達できなかった画面とその理由（データ不足・権限・未実装・設定不足）を一覧で残す
5. ストレージ（`uses_storage: true` のとき）: 起動に要る入れ物（バケット・ディレクトリ）が在り、`storage.env_vars` が設定されていることを確かめる（値は出さない）

- 画面が白紙のときや、エラーが表示されたときは、「到達できた」にしない（HTTP 200 は到達の証拠ではない）
- 到達できない画面は、暫定データが足りないのか、環境の復元が足りないのかを切り分けて記録する。前者は `golden-dataset` で解消し、後者はこのスキルに戻る

## 工程 8: 再構築を再実行して確かめる

空の環境から、工程 3・6 のツールだけで同じ状態を再現できることを実測する（禁止事項 9）。
手作業が 1 つでも要るなら、それをツールか手順書に移してから再実行する。

- 手順は、空の環境を用意する → スキーマを構築する → 暫定起動データを投入する → 工程 7 の起動・認証・到達をもう一度通す、の順である
- 1 回目と同じ結果になることまで確かめる。起動はできたが画面の内容が違うなら、再現できていない
- 再現できなかった場合は、再現できない箇所を特定して記録し、ツールか手順書を直してから再実行する。「たぶん環境の差」で片付けない
- `verification.md` に「再構築の再実行: 未実施」と書いたまま引き渡さない。未実施では `status: handed-off` の条件を満たさない

## 工程 9: current target を引き渡す

引き渡しは、環境が動いていることの宣言ではない。どこに根拠があり、どこが未確認かを添えて渡すことである。

1. 設定の current target を確定する
   - 再構築で決まった `url`（`none` から実際の URL へ）を、既存の値を壊さずに埋め、`side: current` のデフォルトとして `default: true` を付ける。
   - `default: true` は、側ごとに 1 つだけ付けられる。すでに別の current target に付いているなら、どちらをデフォルトにするかを利用者に確かめる。
   - このスキルが設定に書くのは、この引き渡しと、下の「引き渡しを取り消すとき」の 2 か所だけで、値は利用者に確かめてから書く。
     `url` は既にある値（`none`、または取り消しを断られて残った前の URL）を変えるので、`skill-config.mjs set replace-strategy targets.<添字>.url '"<URL>"' --layer repo --replace` で書く。
     `default` は、無いキーなら `--replace` を付けずに `set ... targets.<添字>.default true --layer repo` で書く。
     キーが既に在るなら（取り消した後の `false` か、取り消しを断られて残った `true`）、`--replace` を付ける（書き込みの決まりの原本は [`config-files.md`](config-files.md)「書き込みの決まり」）。
2. `metadata.json` を書く。`status` を `handed-off` にし、`blocked_on` を空配列に、`resume` を `null` にして、次の項目を記録する
   - 復元の方法（受領 DDL／マイグレーションの適用／ORM による生成）と、埋まらなかった領域
   - `semantics` の確定済みと確認待ちの件数と、確認待ちが影響する機能
   - `handoff.boot_requirements`: `golden-dataset` のフェーズ A のデータ設計に含める必要がある起動要件（認証ユーザー・マスタ・コード表など）。
     フェーズ A の投入は暫定起動データを置き換えるので、ここに挙げないと、投入し直した後に環境が起動しなくなる
   - `handoff.unconfirmed`: 未確認のまま引き渡す項目の一覧（禁止事項 8）。空にしない。無ければ「なし」と書く
   - `stale_downstream`: 空配列にする。空にする前の一覧は、手順 3 で報告する
3. `replace-strategy` の測定に戻す: 引き渡しが済んだことを報告し、`replace-strategy setup` の測定（再構築した target が対象）を促す。
   手順 2 で空にする前の `stale_downstream` に成果物があったら、それらは作り直す前の環境で作ったものなので、報告に一覧を載せ、挙げたスキルをやり直すよう促す

### 引き渡しを取り消すとき

`handed-off` の記録を `blocked` に戻すとき（いつ戻すかは SKILL.md「停止と再開」の「引き渡した後に届いたとき」）は、`metadata.json` を書き換えてから、設定の current の target を引き渡しの前の値に戻す。
`url` も `default` も既にある値を変えるので、どちらも `--replace` を付けて書く。値は利用者に確かめてから書く。

```bash
node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs set replace-strategy targets.<添字>.default false --layer repo --replace &&
  node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs set replace-strategy targets.<添字>.url '"none"' --layer repo --replace
```

`default` は、キーを消さずに `false` にする（`set` はキーを消せない）。
`url` だけを戻すと、`url: none` の target が `default: true` を持つことになり、target を解決する姉妹スキルが設定の誤りとして止まる（`replace-strategy` の `references/project-config.md` のスキーマ不変条件）。
`default` を先に書くのはこのためで、2 つ目の書き込みが失敗しても、この誤りの状態を残さない。

利用者が取り消しを断ったら、設定を書かずに `blocked` のまま進める。
`replace-strategy` の測定・`golden-dataset`・`parity-suite`・`spec-parity` の `suite`・`parity-component` の `capture` は `status` を読んで止まるので、残った設定の値で作り直しの途中の環境を使わない。

### `status` の値

| 値 | 意味 | 次にすること |
|---|---|---|
| `blocked` | 不足で止まっている（`blocked_on` に理由、`resume` に再開する工程） | 質問票の回答・追加資産を待って `--resume` |
| `handed-off` | 工程 7・8 を通して引き渡した | `replace-strategy setup` の測定へ。後から回答や追加資産が届いたら `--resume`（SKILL.md「停止と再開」の「引き渡した後に届いたとき」） |

「工程の途中」を表す 3 つ目の値は持たない。このスキルの実行は、工程 9 まで進んで `handed-off` になるか、不足に当たって `blocked` で止まるかのどちらかで終わる。
`handed-off` の記録に届いた回答で確認待ちを確定させるだけの実行は、工程を進めずに `handed-off` のまま終わる（SKILL.md「停止と再開」の「引き渡した後に届いたとき」）。
途中で正常に終わる流れが無いので、書く人のいない値をテンプレートに残すと、下流が起こりえない状態を前提にした分岐を持つことになる。
後で `--resume` の途中経過を記録する設計に変えるなら、値を足すのと同時に、誰がいつ書くかを実行の流れに決める。

`handed-off` にしてよい条件は、工程 7 の起動・認証・主要な画面への到達をすべて実測し、工程 8 の再実行で再現できていることである。
確認待ちの意味論と、`schema.md` の区分「層の確認待ち」が残っていることは、`handed-off` を妨げない。残っている一覧を `handoff.unconfirmed` に載せて渡す。
