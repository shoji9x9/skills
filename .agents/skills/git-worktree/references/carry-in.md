# `.gitignore` 対象ファイルの運搬

worktree は checkout なので、`.gitignore` の対象のファイルは入らない。
`.env`・受領物・ベンダーの配布物・ビルドのキャッシュが要る作業では、明示的に運ぶ必要がある。

## 2 つの方法

Claude Code には、ファイルを運ぶ方法が 2 つある。`.worktreeinclude` は公式のドキュメント
（[Copy gitignored files into worktrees](https://code.claude.com/docs/en/worktrees#copy-gitignored-files-into-worktrees)）に書かれている。
`worktree.symlinkDirectories` は公式のドキュメントに書かれておらず、2.1.243 の実装を読んで確かめた挙動である。
書かれていない設定は予告なく変わることがあるので、頼る前に版を固定して確かめ直す。

| 方法 | 設定 | 向いているもの | 実体 |
| --- | --- | --- | --- |
| コピー | リポジトリの直下の `.worktreeinclude` | 小さいファイル（`.env` など） | worktree の中に複製が置かれる |
| リンク | `.claude/settings.json` の `worktree.symlinkDirectories` | 大きな読み取り用のディレクトリ | 共有ツリーの実体を指すシンボリックリンク |

**どちらも、worktree を新しく作るときだけ実行される。** 既存の worktree を再開するときや、`EnterWorktree` に
`path` を渡して入るときには呼ばれない。実装を読むと、運ぶ処理をまとめた関数を呼ぶ 3 か所は、すべて
「新しく作った」分岐の中にあった。

この制約が、置き場所の選び方を決める。

| 作り方 | 置き場所 | 自動で運ぶか |
| --- | --- | --- |
| `EnterWorktree` の `name` | `.claude/worktrees/` に固定（リポジトリの中なので[除外が要る](scanner-exclusions.md)） | 運ぶ |
| `git worktree add` の後に `EnterWorktree` の `path` | 自由に選べる | 運ばない（手で運ぶ） |

「`.env` や受領物が要る作業か」で決める。要らないなら、リポジトリの外に置いて除外の手間をなくすのが安い。

## `.worktreeinclude`（コピー）

リポジトリの直下に置く、`.gitignore` と同じ書式のファイルである。1 行に 1 つのパターンを書き、`#` で始まる行はコメント、空行は無視される。

運ぶ候補になるのは、`git ls-files --others --ignored --exclude-standard --directory` が返すものだけである。
つまり、実際に `.gitignore` の対象になっているファイルだけが候補になる。追跡済みのファイルは checkout で入るので対象外で、
無視もされていないファイルは候補にならない。「書いたのに運ばれない」ときは、まず `.gitignore` の対象かを確かめる。

次のものは飛ばされる。警告のログは出るが失敗にはならないので、ファイルが欠けたまま気付きにくい。

- ソース側がシンボリックリンクであるもの
- 宛先が、commit されたシンボリックリンクを通って worktree の外に出るもの

`**/` で始まるパターンは、ディレクトリごと `.gitignore` されている中身に届かないことがある。
届くのは、そのディレクトリ自身がパターンに一致するか、`**/` の直後の名前がディレクトリのパスに含まれる場合である。
無視されたディレクトリの中を確実に運ぶには、`**/config.json` ではなく `vendor/**/config.json` のようにディレクトリ名を書く。

```text
# .worktreeinclude
.env
.env.local
config/secrets.local.json
```

## `worktree.symlinkDirectories`（リンク）

`.claude/settings.json` に書く。

```json
{
  "worktree": {
    "symlinkDirectories": [".cache"]
  }
}
```

例に挙げるのは、作り直せるディレクトリだけにする。受領物とベンダーの配布物は、下の
「リンクは読み取り専用ではない」の理由でリンクの対象にしないので、設定例にも書かない。
設定例はそのままコピーして使われるからである。

### `node_modules` はリンクで運ばない（worktree の中で install する）

pnpm や npm の `node_modules` を、`symlinkDirectories` に入れてはいけない。
pnpm は、プロジェクトのルートの外を指す `node_modules` を拒否する。pnpm 11.23.0 で、次のエラーを確かめた。

```text
ERR_PNPM_UNSAFE_MODULES_DIR: Refusing to remove the modules directory ... because its resolved target is not a strict subdirectory of the project root
```

その結果、`pnpm exec` で起動する lint・整形・テストが 1 つも動かなくなる。
「作り直せるものはリンクしてよい」は、リンク越しに書き込む事故だけを考えた規則で、
パッケージマネージャ自身がリンクを拒否する場合は考えていない。

worktree の中で `pnpm install --frozen-lockfile` を実行する（実測で 3.4 秒）。lockfile があるので、同じ結果になる。

各項目について、`<worktree>/<項目>` から `<リポジトリのルート>/<項目>` へ、
絶対パスのディレクトリ型のシンボリックリンクを作る。
絶対パスや `..` を含む項目は拒否され、ソースが無い項目は飛ばされる。

### リンクの対象は `.gitignore` に末尾のスラッシュを付けずに書く

git は、シンボリックリンクをディレクトリではなくファイルとして扱う。そのため、`.gitignore` の
末尾にスラッシュが付いたパターン（`/node_modules/`）はリンクに一致しない。共有ツリーでは無視されて
いたディレクトリが、worktree では未追跡のファイルとして `git status` に現れる。

この状態では、どのチェックも失敗しない。`git status` を読むまで、状態が違うことに気付けない。

末尾のスラッシュを外しても、実体のディレクトリは引き続き無視される。そのため、共有ツリーと worktree の
両方で成り立つのは、末尾にスラッシュを付けない書き方だけである。

**説明を同じ行に書かない。** git がコメントとして扱うのは、行頭が `#` の行だけである。
`/node_modules   # ...` と書くと、空白と `#` 以降までパターンの一部になり、何にも一致しなくなる
（[gitignore の pattern format](https://git-scm.com/docs/gitignore#_pattern_format)）。
実際に、この形では `git check-ignore -v node_modules` が exit 1 で、リンクは `?? node_modules` のままだった。

```gitignore
/node_modules
```

上が正しい形で、実体のディレクトリにもリンクにも一致する。
`/node_modules/`（末尾にスラッシュあり）は実体のディレクトリにしか一致せず、worktree では
`?? node_modules` になる。

先頭の `/` は残す。外すと、下の階層にある同じ名前のディレクトリ（`packages/x/node_modules` など）まで
無視の対象になる。

git 2.47.3 で、次の結果を確かめた。2.51.1 でも同じ結果が報告されている。

| `.gitignore` | 実体のディレクトリ | シンボリックリンク |
| --- | --- | --- |
| `/linked/` | 無視される | `?? linked`（一致しない） |
| `/linked` | 無視される | 無視される |

```bash
root=$(mktemp -d); mkdir -p "$root/real/inner" "$root/repo"
echo payload > "$root/real/inner/file.txt"
cd "$root/repo" && git init --quiet .
printf '/linked/\n' > .gitignore
git add .gitignore && git commit --quiet -m "add gitignore"
mkdir -p linked/inner && git status --short   # → 空（実体は無視される）
rm -rf linked && ln -s "$root/real" linked
git status --short                            # → ?? linked（リンクは一致しない）
printf '/linked\n' > .gitignore
git status --short                            # → .gitignore の変更だけ（リンクも無視される）
```

このファイルの前の節で、運ぶ候補になるのは「実際に `.gitignore` の対象になっているファイルだけ」と書いた。
リンクが `.gitignore` に一致しなければ候補にもならないので、この書き方は運ぶこと自体の前提でもある。

## リンクは読み取り専用ではない（書き込める）

読むために設定するものだが、リンク越しに実体を書き換えたり消したりできる。
読み取り専用にする仕組みは無い。設定はリンクを作るだけで、権限やマウントには触らない。

GNU coreutils 9.7 で、次の結果を確かめた。9.4 でも同じ結果が報告されている。

| 操作 | 実体への影響 |
| --- | --- |
| `sed -i`・`truncate`・`: > <名前>/f` | 実体に届く（`rm` を見るガードでは止められない） |
| `rm -rf <名前>`（末尾にスラッシュなし） | リンクだけが消え、実体は残る |
| `rm -rf <名前>/`（末尾にスラッシュあり） | リンクをたどって、実体のディレクトリの中身を消す。リンクとディレクトリ自身は残り、終了コードは 0 |

最後の行が最も危ない。成功したように見えて、共有ツリー側の中身だけが消える。

次の手順で、使い捨てのディレクトリで再現できる。

```bash
S=$(mktemp -d); mkdir -p "$S/real/sub" "$S/wt"; : > "$S/real/sub/file.txt"
ln -s "$S/real" "$S/wt/linked"
rm -rf "$S/wt/linked/"                     # 末尾スラッシュあり
[ -e "$S/real/sub" ] && echo "残った" || echo "実体の中身が消えた"
```

**そのため、外部からしか取り戻せないディレクトリ（先方からの受領物・ベンダーの配布物）はリンクしない。**
どうしてもリンクするなら、この注意を作業の指示に明記し、リンクの名前を末尾にスラッシュを付けて書かない。
作り直せるキャッシュはリンクしてよい（ただし、`node_modules` は上のとおり除く）。

なお、`git worktree remove` 自体はリンクをたどらない。Windows でも、worktree の中のリンクはリンクだけを消し、
指す先のフォルダを残す。危ないのは、手で書いた `rm` や編集のコマンドの方である。
