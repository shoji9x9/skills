# パッケージマネージャ（pnpm）の保守

正本は `package.json` の `packageManager` / `devEngines.packageManager` と `pnpm-lock.yaml`。
**npm は使わない**（`package-lock.json` を作らない。誤った PM 利用は `devEngines` が警告する）。

## pnpm を bump する

正本 4 箇所すべてを同期する: `mise upgrade pnpm --bump`
→ `mise lock`（全プラットフォーム URL を補完）→ `package.json` の `packageManager` と
`devEngines.packageManager.version` を新版へ → `pnpm install --lockfile-only` で
`pnpm-lock.yaml` を再生成。mise だけ更新して package.json / lock を取りこぼすと
`devEngines` 警告・不整合になる。

## broken 版を避ける

採用前に選定版が deprecated/broken でないか `pnpm view <版> deprecated` で確認する。
broken なら修正版を厳密ピンで採る（`minimum_release_age` の 7 日フィルタは厳密ピン対象外）。
`mise upgrade --bump` は 7 日を満たす最新を選ぶだけで broken を除外しないため、fix 版が
fresh だと broken 版を掴む。
