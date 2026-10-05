# pnpm の transitive 依存を patched version へ上げるときの注意

pnpm を使うリポジトリで、transitive 依存に着手できるかを判定するときと、実際に上げるときに読む。他のパッケージマネージャには、一般には当てはまらない。

## `pnpm update <pkg>` は解決し直すとは限らない

pnpm の transitive 依存には 2 種類ある。

- peer-keyed transitive は、lockfile のキーが `pkg@x.y.z(peer@a.b.c)` のように peer dependency のバージョンを含むものである（例: `vite@8.0.14(@types/node@25.9.1)(jiti@2.6.1)`）
- plain transitive は、peer のキーを持たない通常の transitive 依存である

peer-keyed transitive は、`pnpm update <pkg>` や `pnpm update <pkg>@<version>` を実行しても、解決し直されないことがある。
親（例: devDependency として指定している別のパッケージ）の range が patched version を許していても、lockfile を残したままの update では上がらない。
確実に上げるには、lockfile を最初から作り直す（`rm -rf node_modules pnpm-lock.yaml && pnpm install`）必要があることがある。

作り直すと、対象以外の依存もまとめて新しい版に上がる（実例: vitest・oxlint・semantic-release・@types/node など約 20 のパッケージが上がった）。
`pnpm.overrides` や lockfile の手での編集を使わずに、対象の 1 件だけを狙って上げることはできない場合がある。

plain transitive は、patched version が分かっていても、バージョンを付けずに `pnpm update <pkg>` を使う。
`pnpm update <pkg>@<version>` と明示すると、無指定なら届く同じ入力でも、exit 0 でエラーも lockfile の差分も無いまま何も変わらないことがある。
版を指定しても機能しないことがある、というだけではない。版を指定すると、plain transitive で機能する無指定の方法が使えなくなる。

無指定で届いた場合も、対象の 1 件だけが更新されるとは限らない。
`pnpm update` は、range の中に新しい版がある別の plain transitive も同時に上げることがある。
実例では、`pnpm update undici` が nanoid・postcss・@napi-rs/wasm-runtime・@tybys/wasm-util も上げた。
ただの `pnpm install --lockfile-only` では差分が出ない。したがって、これは `update` に特有の広い解決し直しで、peer-keyed だけの問題ではない。

## 手段の優先順

`pnpm update` で上がらないことを確かめても、同じコマンドのオプションを広げただけ（`--depth Infinity`・`-L`・`<pkg>@"*"` など）で、「できない」「作り直すしかない」と結論しない。
update が上げない理由（lockfile にある transitive の解決を残す）を特定したら、その前提が成り立たなくなる別のコマンド（lockfile からエントリを消す `remove`）まで候補に入れてから結論する。

1. plain transitive は、バージョンを付けない `pnpm update <pkg> --depth Infinity --lockfile-only` を試す。patched version が分かっていても `<pkg>@<version>` にしない
2. direct 依存なら、直接更新する
3. 親を remove し、同じ range で add し直す（その下の依存だけを解決し直す。後述）
4. lockfile を手で最小限に編集する（最小の差分が要る plain transitive。後述）
5. lockfile を最初から作り直す（関係のない依存もまとめて上がる。最後の手段）

`pnpm.overrides` で解決を強制するのは品質が保証されないので、どの段階でも使わない（SKILL.md「Issue 本文の規約」の、品質が保証されない回避策を提案しないという項目）。

## リリース年齢の制限で何も変わらない場合を切り分ける

`minimumReleaseAge` は、transitive を含むすべての依存に当てはまる。patched version がまだ年齢の条件を満たさないとき、`pnpm update <pkg> --depth Infinity --lockfile-only` は、exit 0 でエラーも lockfile の差分も無いまま旧版を残すことがある。
この結果だけでは、「待てば解決するリリース年齢の制限」なのか、「update の解決し直しが機能せず、別の手段が要る」のかを区別できない。

次の順で切り分ける。

1. `pnpm config get minimumReleaseAge` で、有効な値を確かめる。CLI で条件を変えて再現するときは、同じ `--config.minimumReleaseAge=<分>` を付けた `pnpm config get minimumReleaseAge` で、上書きした後の値も確かめる
2. 元の作業ツリーを変えないように、必須の `package.json` と `pnpm-lock.yaml` を一時ディレクトリにコピーする。
   `pnpm-workspace.yaml` と、レジストリ・認証に要る `.npmrc` は、リポジトリにある場合だけコピーする。
   `.npmrc` に秘密の値があるときは、一時ディレクトリの権限を絞り、調べ終えたら消す
3. リポジトリと同じ pnpm の実体を使い、元の有効な値を作った global config・環境変数・CLI の上書きも同じ条件にする。
   コピー先のそれぞれで `pnpm config get minimumReleaseAge` をもう一度実行し、元と同じ有効な値であることを確かめる。
   pnpm 11 では、`minimumReleaseAge` などのプロジェクトの設定は `pnpm-workspace.yaml` から、レジストリと認証の設定は `.npmrc` から読まれる
4. コピー先で `pnpm update <pkg> --depth Infinity --lockfile-only` を実行し、lockfile の対象の version を確かめる
5. 同じコピー元から作った別のコピーで、`pnpm add --save-dev <pkg>@<patched-version> --lockfile-only` を実行する

`add` が `ERR_PNPM_NO_MATURE_MATCHING_VERSION` を出し、対象の version の公開日時と基準の日時を示して失敗すれば、`update` が警告なしに旧版を残したのも同じリリース年齢の制限によるものと判断できる。
制限を外したときに、バージョンを付けない `update` が patched version に届くことも確かめる。通信の失敗・pnpm が起動していない・別の設定を読んでいる、のどれかを「何も変わらない」と取り違えないためである。
調べるための `add` は manifest を変えるので、必ず使い捨てのコピーで行う。

## 親を remove して同じ range で add し直す

親（direct 依存）を一度アンインストールすると、lockfile からその下の依存の解決が消える。
同じ range で入れ直すと、その下の依存だけが解決し直される。上がるのはその下の依存に限られ、作り直しのように全体が上がることはない。

先に、親の依存の宣言が range か、版を固定した exact pin かを確かめる。exact pin（`1.2.3` に固定）なら、この手順でも上がらず、上流を待つことになる。

1. 親がどの種類の依存として宣言されているか（`dependencies` / `devDependencies` / `optionalDependencies`）を記録する。
   `remove` すると宣言そのものが消えるので、先に確かめておく。

   ```bash
   PARENT='<親>' node -e 'const p=require("./package.json");const n=process.env.PARENT;for(const k of ["dependencies","devDependencies","optionalDependencies"])if(p[k]?.[n])console.log(k,p[k][n])'
   ```

   親の名前は、引数ではなく環境変数で渡す。`node -e` はスクリプトのパスを取らないので、`process.argv` の添字が
   ファイルを実行するときと 1 つずれる（`-e` では最初のユーザー引数が `argv[1]`）。環境変数なら、添字を
   気にしなくてよい。

2. `pnpm remove <親>`
3. 記録した種類に合わせて、同じ range で add し直す（元の range をそのまま渡す）
   - `dependencies` → `pnpm add --save-prod '<親>@<元の range>'`
   - `devDependencies` → `pnpm add --save-dev '<親>@<元の range>'`
   - `optionalDependencies` → `pnpm add --save-optional '<親>@<元の range>'`

   種類を取り違えない。production の依存を `--save-dev` で入れ直すと `devDependencies` に移る。
   そうなると、lockfile だけでなく、本番のインストール（`--prod` やデプロイ）でも依存が欠ける。
4. `package.json` の宣言（種類と range の両方）が元と変わっていないかを確かめる。変わっていたら元に戻し、`pnpm install --lockfile-only` で lockfile を合わせる
5. `pnpm install --frozen-lockfile` とテストで確かめる
6. `git diff pnpm-lock.yaml` で前後の `name@version` を比べ、どこまで上がったかを確かめる。
   キーの一覧は grep ではなく YAML パーサの `loadAll` で取る（`pnpm-lock.yaml` は複数のドキュメントになりうる）。
   引用符で囲んだ既知の scoped のキーと総数を突き合わせ、一覧を正しく取れていることを確かめる。

実例: postcss（high）の対応では、`pnpm update postcss` を試したどの形でも 8.5.15 のままだった。作り直すと 122 のパッケージ（typescript の major を含む）が変わった。
`pnpm remove vitest && pnpm add --save-dev 'vitest@^4.1.7'`（vitest は `devDependencies` に宣言）では 8.5.23 に届いた。
変わったのは 50 件で、major の更新は無く、`package.json` も変わらなかった。

## 判断の根拠は lockfile にする（今の状態も、更新の結果も）

pnpm には、lockfile を読むコマンドと、node_modules（実際にインストールされたもの）を読むコマンドがある。
インストールしていない間は、両者の結果がずれる。今の状態の判定にも、更新の結果の判定にも、常に lockfile の側を根拠にする。

| 判定したいこと | 根拠にするもの（lockfile から） | 使わないもの（node_modules から） |
| --- | --- | --- |
| 着手する前の状態（どの version が入っているか、脆弱か） | `pnpm audit`、lockfile を直接確かめる | `pnpm why`、`pnpm list` |
| 更新した後に、意図しない更新が含まれていないか | `git diff pnpm-lock.yaml`（必要なら `git show HEAD:pnpm-lock.yaml`） | `pnpm update` の標準出力のまとめ |

- 着手する前に、`pnpm install --frozen-lockfile` で node_modules を lockfile に合わせてから見る。
  ブランチを作った直後の node_modules は、前にインストールしたときのままである。その間に base に取り込まれた依存の更新は入っていない。
  合わせる前の `pnpm why` は、base の lockfile ではなく、過去の解決の状態を示す。
- `pnpm why` の出力が Issue 本文と一致しても、裏付けにならない。
  起票した時点の状態と、合わせる前の node_modules は、どちらも古い。独立した 2 つの情報ではない。
- 起票してから時間がたった Issue は、着手する時点で、対象のパッケージごとに測り直す。
  一部の対象だけが、別の PR のマージで解消済みになっていることがある（本文全体を疑うのではなく、対象ごとに測り直す）。
- 更新した後の標準出力の増減（`- pkg X` / `+ pkg Y`）は、node_modules を lockfile に合わせた分も含む。
  そのため、lockfile に差分が無くても増減が表示される（実際より多く見える）。

実例: js-yaml・undici・fast-uri の脆弱性の Issue に着手したとき、合わせる前の `pnpm why undici` は Issue 本文と同じ `6.27.0` / `7.28.0` を返した。
しかし base の lockfile は既に `6.28.0` / `7.29.0` で、`pnpm audit` にも advisory は無かった。起票の後に取り込まれた semantic-release の更新で解消していた。
`pnpm install --frozen-lockfile` の後は、`pnpm why` も patched version を返した。
js-yaml と fast-uri は解消しておらず、実際に更新が要ったのはこの 2 件だけだった。

## 着手可否の分類への反映

分類のルールは SKILL.md「着手可否の判定」で定義する。pnpm に固有の補足として、作り直したときにどこまで上がったかは、作り直す前後の `name@version` を `git diff` で比べれば確かめられる。

## 最小の差分が要るときに lockfile を手で編集する手順

plain transitive なら、関係のない依存を上げずに、対象の 1 件だけを手で編集して上げられる。

1. 対象の旧 version の文字列が、lockfile の中で他のパッケージと重ならないかを確かめる（`grep -c '<old-version>' pnpm-lock.yaml`）。重ならなければ、以降の一括置換を安全に行える
2. 正しい integrity を、使い捨てで実行した `pnpm update <pkg>` の結果からコピーする。その後、`git checkout -- pnpm-lock.yaml` で、一緒に上がった依存ごと元に戻す
3. version の文字列（resolution のキー、親の snapshot からの参照、snapshot のキーのすべての箇所）と integrity の行だけを置き換える。新旧で `engines` が変わる場合は、それも更新する
4. `pnpm install --frozen-lockfile` で確かめる。integrity を実際に検証し、`update` と違って関係のない依存を上げない（成功すれば、lockfile はそれ以上変わらない）

peer-keyed transitive では、この手での編集が確実に機能するとは限らない（作り直しが要る場合がある）。

## 出典

- 配布元のリポジトリでの実測（vite の peer-keyed、undici の plain、標準出力の多すぎる表示、親の remove と add し直し、合わせる前の `pnpm why` が古いこと、バージョンの明示とリリース年齢の制限で何も変わらないこと）
- [pnpm update](https://pnpm.io/cli/update)
- [pnpm Settings — configuration files](https://pnpm.io/settings)
- [pnpm Dependency Resolution Settings — minimumReleaseAge](https://pnpm.io/settings#minimumreleaseage)
