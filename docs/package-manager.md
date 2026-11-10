# パッケージマネージャ（pnpm）の保守

pnpm のバージョンは 4 か所に書く。`mise.toml` の `pnpm`、`package.json` の `packageManager` と `devEngines.packageManager`、`pnpm-lock.yaml` である。
npm は使わず、`package-lock.json` を作らない。誤ってほかのパッケージマネージャを使うと、`devEngines` が警告する。

## 依存のバージョンの指定

`package.json` の依存は、キャレット（`^1.2.3`）で指定する。実際に入るバージョンは `pnpm-lock.yaml` で決まり、CI は lockfile のとおりに install するからである。
キャレットにしない依存は、理由をこの節に書く。理由を書けないなら、キャレットにする。
依存を足すときは `pnpm add -D <名前>` を使う。`--save-exact` は付けない。

配布スキルに同梱するパッケージ（`docs/tooling.md`「同梱するパッケージの更新」）も、キャレットで指定する。
同梱物の先頭のコメントと `NOTICE.md` に書くバージョンは、`node_modules` に入ったバージョンから作るので、`package.json` の範囲とは関係しない。

## pnpm を bump する

バージョンを書いた 4 か所をすべて同じバージョンにそろえる。手順は次のとおりである。

1. `mise self-update` で手元の mise を最新にしてから（「lock を作る mise を CI とそろえる」）、`mise upgrade pnpm --bump` を実行する。
2. `mise lock` を実行し、すべてのプラットフォームの URL を lockfile に書き足す。
3. `package.json` の `packageManager` と `devEngines.packageManager.version` を新しいバージョンにする。
4. `pnpm install --lockfile-only` で `pnpm-lock.yaml` を作り直す。

mise だけを更新して `package.json` と lockfile を更新し忘れると、`devEngines` が警告を出し、バージョンが食い違う。

## mise lock の巻き込み差分を絞る

`mise lock` は lockfile 全体を解決し直す。そのため、バージョンの指定が変わらない他のツールでも、上流が作り直した成果物（例: python-build-standalone のビルド日）を取得して entry を書き換える。
生成した後に `git --no-pager diff mise.lock` で変わった範囲を確かめ、bump の対象以外のツールのブロックは元に戻し、commit を対象のツールだけにする。

変わった範囲は、変更行の文字列ではなく、hunk がどのブロックに属するかで確かめる。
checksum・integrity・URL のようにツール名を含まない行が必ず変わるので、`grep -v '<ツール名>'` のような行単位の照合は、正しい差分でも違反を出す。
出力が空になるまで除外する語を足していくのは禁止する。足した語（`integrity: sha512` など）は無関係なパッケージの変更行そのものなので、目的の異常を検出できなくなるからである。
差分全体を読み、hunk のヘッダと直前の節の見出し（`[[tools.X]]` やパッケージの entry）から、変更が対象のブロックの中に収まっていることを確かめる。

## lock を作る mise を CI とそろえる

`jdx/mise-action` に mise のバージョンを指定しないワークフローは、最新の mise を使う。
mise は、ツールを検証する方法（lockfile の `provenance`）を、本体に組み込んだ aqua registry から決める。
手元の mise が古いと、上流が検証の方法を変えたツールで、検証用のファイルが公開されていない方法を lockfile に書く。
ghalint は v1.5.7 から SLSA の検証用のファイルを公開していないが、mise 2026.5.16 は、それより後のバージョンの entry にも `provenance = "slsa"` を書いた（1.6.0 で確かめた）。
その lockfile では、空の環境からの `mise install --locked` が検証用のファイルを取得できずに失敗した。

そのため、`mise upgrade` や `mise lock` を実行する前に、`mise self-update` で手元の mise を最新にする。
パッケージマネージャ（Homebrew など）で入れた mise は `mise self-update` で更新できないので、そのパッケージマネージャで更新する。
既にある entry の `provenance` は、`mise lock <tool>` を実行しても作り直されない。古い mise で作った entry は、そのツールのブロックを `mise.lock` から消してから `mise lock <tool>` を実行する。
lock を作ったら、空のデータディレクトリで入れ直し、lockfile のとおりに入ることを確かめる。

```bash
d=$(mktemp -d)
MISE_DATA_DIR="$d/data" MISE_CACHE_DIR="$d/cache" mise install --locked <tool>... </dev/null
rm -rf "$d"
```

## broken バージョンを避ける

採用する前に、選んだバージョンが deprecated や broken になっていないかを `pnpm view pnpm@<バージョン> deprecated` で確かめる。
broken なら、修正版を厳密なバージョンの指定で採用する。`minimum_release_age` の 7 日のフィルタは、厳密に指定したバージョンには当てはまらない。
`mise upgrade --bump` は 7 日を過ぎた最新版を選ぶだけで、broken なバージョンを除かない。そのため、修正版が出て 7 日たっていないと、broken なバージョンを選んでしまう。
