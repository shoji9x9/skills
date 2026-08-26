# `.gitignore` 対象ファイルの運搬

worktree は checkout なので、**`.gitignore` 対象のファイルは入らない**。
`.env`・受領物・ベンダー配布物・ビルドキャッシュが要る作業では、明示的に運ぶ必要がある。

## 2 つの経路

Claude Code には 2 経路ある。`.worktreeinclude` は公式ドキュメント
（[Copy gitignored files into worktrees](https://code.claude.com/docs/en/worktrees#copy-gitignored-files-into-worktrees)）に記載がある。
`worktree.symlinkDirectories` は**公式ドキュメント未記載**で、2.1.243 の実装を読んで確認した挙動である
（未記載の設定は予告なく変わりうる。依存する前にバージョンを固定して再確認する）。

| 経路 | 設定 | 向き | 実体 |
| --- | --- | --- | --- |
| **コピー** | リポジトリ直下の `.worktreeinclude` | 小さいファイル（`.env` 等） | worktree 内に複製が置かれる |
| **リンク** | `.claude/settings.json` の `worktree.symlinkDirectories` | 巨大な読み取り用ディレクトリ | 共有ツリーの実体を指すシンボリックリンク |

**どちらも「新規作成」のときだけ走る。** 既存の worktree を再開する経路・`EnterWorktree` に
`path` を渡して入る経路からは呼ばれない（実測: 運搬をまとめた関数の呼び出し箇所は 3 か所すべて
「新規作成した」分岐の内側）。

**このトレードオフが置き場所の選択を縛る。**

| 作り方 | 置き場所 | 自動運搬 |
| --- | --- | --- |
| `EnterWorktree` の `name` | `.claude/worktrees/` 固定（リポジトリ内 → [除外が要る](scanner-exclusions.md)） | 走る |
| `git worktree add` → `EnterWorktree` の `path` | 自由に選べる | **走らない**（手で運ぶ） |

「`.env` や受領物が要る作業か」で決める。要らないならリポジトリ外に置いて除外の手間を消すのが安い。

## `.worktreeinclude`（コピー）

リポジトリ直下に置く、`.gitignore` と同じ書式のファイル。行単位、`#` 始まりはコメント、空行は無視。

運搬の候補になるのは `git ls-files --others --ignored --exclude-standard --directory` が返すもの、
つまり**実際に `.gitignore` の対象になっているファイルだけ**である。追跡済みファイルは checkout で入るため対象外、
無視もされていないファイルは候補にならない。「書いたのに来ない」ときはまず `.gitignore` 対象かを確かめる。

以下は**スキップされる**（警告ログは出るが失敗しない。静かに欠ける）。

- ソース側が**シンボリックリンク**であるもの
- 宛先が committed symlink 経由で worktree の外へ出るもの

`**/` で始まるパターンは、ディレクトリごと `.gitignore` されている中身に届かないことがある。
届くのは、そのディレクトリ自身がパターンに一致するか、`**/` の直後の名前がディレクトリのパスに含まれる場合。
無視されたディレクトリの中を確実に運ぶなら、`**/config.json` ではなく `vendor/**/config.json` のように**ディレクトリ名を書く**。

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
    "symlinkDirectories": ["node_modules", ".cache"]
  }
}
```

**例に挙げるのは再生成できるディレクトリだけにする。** 受領物・ベンダー配布物は下の
「リンクは読み取り専用ではない」の理由からリンクの対象にしないため、設定例にも書かない
（設定例はコピー&ペーストされる）。

各エントリについて `<worktree>/<エントリ>` から `<リポジトリルート>/<エントリ>` へ、
**絶対パスの dir 型シンボリックリンク**を張る。
絶対パス・`..` を含むエントリは拒否され、ソースが存在しないエントリはスキップされる。

## リンクは読み取り専用ではない（**書けます**）

読むために設定するが、**リンク越しに実体へ書ける・消せる**。
**読み取り専用にする機構はない**（設定はリンクを張るだけで、権限やマウントを触らない）。

実測（GNU coreutils 9.7。9.4 でも同じ結果が報告されている）:

| 操作 | 実体への影響 |
| --- | --- |
| `sed -i` / `truncate` / `: > <名前>/f` | **実体に届く**（`rm` を見るガードでは捕まらない） |
| `rm -rf <名前>`（末尾スラッシュなし） | リンクだけ消えて実体は残る |
| `rm -rf <名前>/`（**末尾スラッシュあり**） | **リンクを辿って実体ディレクトリの中身を消す**。リンクとディレクトリ自身は残り、**終了コードは 0** |

最後の行が最も危ない。**成功したように見えて、共有ツリー側の中身だけが消える。**

再現（使い捨てディレクトリで確かめられる）:

```bash
S=$(mktemp -d); mkdir -p "$S/real/sub" "$S/wt"; : > "$S/real/sub/file.txt"
ln -s "$S/real" "$S/wt/linked"
rm -rf "$S/wt/linked/"                     # 末尾スラッシュあり
[ -e "$S/real/sub" ] && echo "残った" || echo "実体の中身が消えた"
```

**したがって: 復元経路が外部にしかないディレクトリ（先方受領物・ベンダー配布物）はリンクしない。**
どうしてもリンクするなら、この注意を作業指示に明示し、リンク名を末尾スラッシュ付きで書かない。
`node_modules` のように再生成できるものはリンクしてよい。

なお `git worktree remove` 自体はリンクを辿らない（Windows でも、worktree 内のリンクはリンクだけを消して
指し先のフォルダを残す）。危険なのは**手で書いた `rm` や編集コマンド**の方である。
