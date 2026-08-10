# パッケージマネージャ（pnpm）の保守

正本は `package.json` の `packageManager` / `devEngines.packageManager` と `pnpm-lock.yaml`。
**npm は使わない**（`package-lock.json` を作らない。誤った PM 利用は `devEngines` が警告する）。

## pnpm を bump する

正本 4 箇所すべてを同期する: `mise upgrade pnpm --bump`
→ `mise lock`（全プラットフォーム URL を補完）→ `package.json` の `packageManager` と
`devEngines.packageManager.version` を新版へ → `pnpm install --lockfile-only` で
`pnpm-lock.yaml` を再生成。mise だけ更新して package.json / lock を取りこぼすと
`devEngines` 警告・不整合になる。

## mise lock の巻き込み差分を絞る

`mise lock` は lockfile 全体を再解決するため、バージョン指定が同じ他ツールでも上流の再ビルド
（例: python-build-standalone のビルド日）を拾って entry を書き換える。生成後に
`git --no-pager diff mise.lock` で範囲を確認し、bump 対象以外のツールのブロックは元に戻して
commit を対象ツールだけに絞る。

範囲の確認は**変更行の文字列マッチではなく hunk の帰属**で行う。checksum / integrity / URL など
対象ツール名を含まない行が必ず含まれるため、`grep -v '<ツール名>'` 系の行単位マッチは正しい差分でも
偽陽性を出す。出力が空になるまで除外語を足すのは、その除外語（`integrity: sha512` 等）が
無関係パッケージの変更行そのものになり、検査が目的の異常を原理的に検出できなくなるため禁止。
差分全体を読み、hunk ヘッダと直近のセクション見出し（`[[tools.X]]` / パッケージ entry）で
変更が対象ブロック内に収まることを確認する。

## broken 版を避ける

採用前に選定版が deprecated/broken でないか `pnpm view <版> deprecated` で確認する。
broken なら修正版を厳密ピンで採る（`minimum_release_age` の 7 日フィルタは厳密ピン対象外）。
`mise upgrade --bump` は 7 日を満たす最新を選ぶだけで broken を除外しないため、fix 版が
fresh だと broken 版を掴む。
