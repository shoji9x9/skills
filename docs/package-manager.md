# パッケージマネージャ（pnpm）の保守

pnpm の版は 4 か所に書く。`mise.toml` の `pnpm`、`package.json` の `packageManager` と `devEngines.packageManager`、`pnpm-lock.yaml` である。
npm は使わず、`package-lock.json` を作らない。誤ってほかのパッケージマネージャを使うと、`devEngines` が警告する。

## pnpm を bump する

版を書いた 4 か所をすべて同じ版にそろえる。手順は次のとおりである。

1. `mise upgrade pnpm --bump` を実行する。
2. `mise lock` を実行し、すべてのプラットフォームの URL を lockfile に書き足す。
3. `package.json` の `packageManager` と `devEngines.packageManager.version` を新しい版にする。
4. `pnpm install --lockfile-only` で `pnpm-lock.yaml` を作り直す。

mise だけを更新して `package.json` と lockfile を更新し忘れると、`devEngines` が警告を出し、版が食い違う。

## mise lock の巻き込み差分を絞る

`mise lock` は lockfile 全体を解決し直す。そのため、版の指定が変わらない他のツールでも、上流が作り直した成果物（例: python-build-standalone のビルド日）を取得して entry を書き換える。
生成した後に `git --no-pager diff mise.lock` で変わった範囲を確かめ、bump の対象以外のツールのブロックは元に戻し、commit を対象のツールだけにする。

変わった範囲は、変更行の文字列ではなく、hunk がどのブロックに属するかで確かめる。
checksum・integrity・URL のようにツール名を含まない行が必ず変わるので、`grep -v '<ツール名>'` のような行単位の照合は、正しい差分でも違反を出す。
出力が空になるまで除外する語を足していくのは禁止する。足した語（`integrity: sha512` など）は無関係なパッケージの変更行そのものなので、目的の異常を検出できなくなるからである。
差分全体を読み、hunk のヘッダと直前の節の見出し（`[[tools.X]]` やパッケージの entry）から、変更が対象のブロックの中に収まっていることを確かめる。

## broken 版を避ける

採用する前に、選んだ版が deprecated や broken になっていないかを `pnpm view <版> deprecated` で確かめる。
broken なら、修正版を厳密な版の指定で採用する。`minimum_release_age` の 7 日のフィルタは、厳密に指定した版には当てはまらない。
`mise upgrade --bump` は 7 日を過ぎた最新版を選ぶだけで、broken な版を除かない。そのため、修正版が出て 7 日たっていないと、broken な版を選んでしまう。
