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

## 手段の優先順

`pnpm update` で上がらないことを確認しても、**同じ動詞のオプションを広げただけ**（`--depth Infinity` / `-L` / `<pkg>@"*"` 等）で
「不可能／完全再生成しかない」と結論しない。拒む理由（lockfile の既存 transitive 解決を保持する）を特定したら、
**その前提を崩す別の動詞**（lockfile からエントリを消す `remove`）まで候補に入れてから結論する。

1. **direct dependency なら直接更新する**
2. **親を remove して同一 range で add し直す**（サブツリーだけ再解決。下記）
3. **surgical hand-edit**（最小差分が要る plain transitive。下記）
4. **lockfile 完全再生成**（無関係な依存も一斉に float する。最後の手段）

`pnpm.overrides` による強制解決は品質が保証されないため、いずれの段でも採らない（SKILL.md「品質が保証されない回避策は提案しない」）。

## 親を remove して同一 range で add し直す

親（direct dependency）を一度アンインストールすると lockfile からそのサブツリーの解決が消えるため、
同一 range で入れ直したときに**そのサブツリーだけが再解決**される。float は当該サブツリーに限定され、完全再生成のような全体巻き込みにならない。

先に**親の依存宣言が range か exact pin か**を確認する。exact pin（`1.2.3` 固定）ならこの手法でも上がらず上流待ちになる。

1. **親がどの依存種別に宣言されているかを記録する**（`dependencies` / `devDependencies` / `optionalDependencies`）。
   `remove` すると宣言そのものが消えるため、先に確認しておく:

   ```bash
   PARENT='<親>' node -e 'const p=require("./package.json");const n=process.env.PARENT;for(const k of ["dependencies","devDependencies","optionalDependencies"])if(p[k]?.[n])console.log(k,p[k][n])'
   ```

   引数ではなく環境変数で渡す。`node -e` は script path を取らないため `process.argv` の添字が
   ファイル実行時と 1 つずれる（`-e` では最初のユーザー引数が `argv[1]`）。環境変数なら添字を
   意識せずに済む。

2. `pnpm remove <親>`
3. **記録した種別に合わせて**同一 range で add し直す（元の range をそのまま渡す）:
   - `dependencies` → `pnpm add --save-prod '<親>@<元の range>'`
   - `devDependencies` → `pnpm add --save-dev '<親>@<元の range>'`
   - `optionalDependencies` → `pnpm add --save-optional '<親>@<元の range>'`

   **種別を取り違えない**。production dependency を `--save-dev` で入れ直すと `devDependencies` へ移動し、
   lockfile だけでなく本番インストール（`--prod` / デプロイ）で依存が欠落する。
4. `package.json` の宣言（**種別と range の両方**）が元と変わっていないか確認し、変わっていたら戻して `pnpm install --lockfile-only` で lockfile を追随させる
5. `pnpm install --frozen-lockfile` とテストで検証する
6. `git diff pnpm-lock.yaml` の base `name@version` 比較で float 範囲を確認する

実例: Issue #124（postcss high）で `pnpm update postcss` は全変種で 8.5.15 のまま・完全再生成なら 122 パッケージ変更（typescript の major を含む）だったが、
`pnpm remove vitest && pnpm add --save-dev 'vitest@^4.1.7'`（vitest は `devDependencies` 宣言）では 8.5.23 に到達し、変更 50 件・major ゼロ・`package.json` 無変更に収まった。

## 判断の権威は lockfile（現況・更新結果とも）

pnpm には **lockfile を読むコマンド**と **node_modules（実インストールツリー）を読むコマンド**があり、
両者は install していない間ずれる。**現況の判定も更新結果の判定も、権威は常に lockfile 側**に置く。

| 判定したいこと | 権威（lockfile 由来） | 使わない（node_modules 由来） |
| --- | --- | --- |
| 着手前の現況（どの version が入っているか・脆弱か） | `pnpm audit` / lockfile の直接確認 | `pnpm why` / `pnpm list` |
| 更新後の混入・float の有無 | `git diff pnpm-lock.yaml`（必要なら `git show HEAD:pnpm-lock.yaml`） | `pnpm update` の stdout サマリ |

- **着手前に `pnpm install --frozen-lockfile` で node_modules を lockfile へ同期してから観測する。**
  ブランチを切った直後の node_modules は前回 install 時点のままで、その間に base へマージされた依存更新が
  反映されていない。同期前の `pnpm why` は base の lockfile ではなく過去の解決状態を映す。
- **`pnpm why` の出力が Issue 本文と「一致」しても裏取りにならない。** 起票時点の状態と同期前の
  node_modules は「古い」という同じ軸を共有しており、独立した 2 情報源ではない。
- **起票から時間が経った Issue は、対象パッケージごとに着手時点で再測定する。** 一部だけが他 PR の
  マージで解消済み、ということが起きる（本文全体を疑うのではなく、対象ごとに測り直す）。
- 更新後の stdout の増減（`- pkg X` / `+ pkg Y`）は node_modules を lockfile 記載へ整合させた分も
  報告するため、**lockfile 差分が無くても増減が表示される**（過大表示）。

実例: Issue #177（js-yaml / undici / fast-uri）の着手時、同期前の `pnpm why undici` は Issue 本文と同じ
`6.27.0` / `7.28.0` を返したが、base の lockfile は既に `6.28.0` / `7.29.0`（起票後にマージされた
semantic-release の bump で解消済み）で `pnpm audit` にも advisory は無かった。
`pnpm install --frozen-lockfile` 後は `pnpm why` も patched version を返した。
同 Issue の js-yaml / fast-uri は未解消のままで、実際に更新が要ったのはこの 2 件だけだった。

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

Issue #39（vite / peer-keyed）・Issue #67（undici / plain）・Issue #113（stdout の過大表示）・Issue #124（親 remove + re-add）・Issue #177（同期前 `pnpm why` の陳腐化）の実例に基づく。
