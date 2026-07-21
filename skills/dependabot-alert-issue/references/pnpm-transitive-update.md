# pnpm の transitive 依存を patched version へ上げる際の注意

pnpm を使うリポジトリで transitive dependency の着手可否を判定・実装するときに参照する。他パッケージマネージャには一般には当てはまらない。

## `pnpm update <pkg>` は再解決を保証しない

pnpm の transitive 依存には 2 種類ある。

- **peer-keyed transitive**: lockfile 上のキーが `pkg@x.y.z(peer@a.b.c)` のように peer dependency のバージョンを含む（例: `vite@8.0.14(@types/node@25.9.1)(jiti@2.6.1)`）
- **plain transitive**: peer key を持たない通常の transitive

**peer-keyed transitive** は、`pnpm update <pkg>` や `pnpm update <pkg>@<version>` を実行しても再解決されないことがある。
親（例: devDependency として指定している別パッケージ）の range が patched version を許容していても、lockfile を保持したままの update では上がらない。
確実に上げるには lockfile 完全再生成（`rm -rf node_modules pnpm-lock.yaml && pnpm install`）が必要になる場合がある。

この完全再生成は **対象パッケージ以外の依存も一斉に float させる**（実例: vitest / oxlint / semantic-release / @types/node など約 20 パッケージが巻き込まれた）。`pnpm.overrides` やロックファイルの手動編集なしに「対象 1 件だけを surgical に上げる」ことができないケースがある。

**plain transitive** は `pnpm update <pkg>` で patched version に到達することが多いが、この場合も **対象 1 件だけの更新は保証されない**。
`pnpm update` は in-range で新版がある他の plain transitive も同時に bump することがある（実例: `pnpm update undici` が nanoid / postcss / @napi-rs/wasm-runtime / @tybys/wasm-util を巻き込んだ）。
プレーンな `pnpm install --lockfile-only` では差分が出ないため、これは `update` 動詞特有の広い再解決挙動であり、peer-keyed 限定の問題ではない。

## 着手可否分類への反映

分類ルールは SKILL.md「着手可否の判定」を正とする。pnpm 固有の補足として、完全再生成での float 範囲は `git diff` で再生成前後の base `name@version` を比較すれば確認できる。

## 最小差分が必要なときの surgical hand-edit 手順

plain transitive であれば、無関係な float を混ぜずに対象 1 件だけを手動編集で上げられる。

1. 対象の旧 version 文字列がロックファイル内で他パッケージと衝突しないか確認する: `grep -c '<old-version>' pnpm-lock.yaml`。衝突しなければ以降の一括置換が安全
2. 正しい integrity を、使い捨ての `pnpm update <pkg>` 実行結果からコピーし、その後 `git checkout -- pnpm-lock.yaml` で floats ごと巻き戻す
3. version 文字列（resolution key・親 snapshot の参照・snapshot key の全箇所）と integrity 行だけを置換する。`engines` が新旧で変わる場合はそれも更新する
4. `pnpm install --frozen-lockfile` で検証する。integrity を実際に検証し、かつ `update` と違って無関係依存を re-float しない（成功すればロックファイルは追加変更なし）

peer-keyed transitive はこの hand-edit が確実に機能するとは限らない（完全再生成が必要になる場合がある）。

## 出典

Issue #39（vite / peer-keyed）・Issue #67（undici / plain）の実例に基づく。
