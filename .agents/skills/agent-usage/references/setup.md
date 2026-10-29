# セットアップ

`agent-usage setup` と、コミットの前の確認の Hook を設定する手順。

## 1. 人の ID を作る

```bash
node <このスキル>/scripts/agent-usage.mjs setup --time-zone Asia/Tokyo
```

- 人の ID（`p-` と 16 進数 8 桁）は、初めての実行で作る。置き場所は人ごとの設定（`${XDG_CONFIG_HOME:-~/.config}/skills/shoji9x9/agent-usage.jsonc`）で、マシンのすべてのリポジトリが同じ ID を使う
- 別のマシンで同じ人として数えたいときは、そのマシンでも `--person-id <既存の ID>` を付けて実行する
- 後から同じ人だと分かった ID は、リポジトリの設定の `aliases` でまとめる（下の「設定」）
- タイムゾーンを省くと、マシンのタイムゾーンを使う。日別の集計の日付と、時刻ごとの稼働状況はこのタイムゾーンで切る
- `--billing user` を付けると、collect が個人のプランの premium request の実額（GitHub の課金 API）も記録する（[`reviews.md`](reviews.md)）
- setup が作った人の設定に `"defaultDecision": "record"`（または `"decline"`）を書き足すと、コミットの前の確認の Hook は、判断の無いブランチのコミットを止めずに、その値に従う。
  人の設定の値は、リポジトリの設定の同じキーより優先する。setup を実行し直しても、この値は残る（setup が書くのは `personId`・`timeZone`・`billing` だけである）
- 設定ファイルの置き場所・層・書き込みの決まりは、[`config-files.md`](config-files.md) にある。キーごとに置ける層は、下の「設定」の表にある

setup はリポジトリに `.agent-usage/records/`（commit できるよう空の `.gitkeep` を置く）を作る。`.agent-usage/` があることが、このリポジトリでスキルを使う印になる（Hook は無いリポジトリでは何もしない）。
リポジトリの設定（`.config/skills/shoji9x9/agent-usage.jsonc`）は作らない。無ければすべてのキーがデフォルトになる。

続けて、記録のファイルを PR の差分で生成物として折りたたむために、リポジトリの直下の `.gitattributes` に次の 1 行を足すかを利用者に確かめる。
了承されたら、無ければファイルを作り、既に同じ行があれば何もしない。既存の行は変えない。

```text
.agent-usage/records/** linguist-generated=true
```

GitHub は `linguist-generated` の付いたファイルを、PR の差分で最初から折りたたむ（[Customizing how changed files appear on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github)）。

## 2. コミットの前の確認の Hook を設定する

`<SCRIPTS_DIR>` は、インストールしたこのスキルの `scripts/` の絶対パス、またはリポジトリのルートからの相対パス（例: `.agents/skills/agent-usage/scripts`）に置き換える。
既に同じイベントの Hook があれば、置き換えずに配列へ足す。設定ファイルを書き換える前に利用者に確認する。

### Claude Code（`.claude/settings.json`）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git *)",
            "command": "bash \"${CLAUDE_PROJECT_DIR}/<SCRIPTS_DIR>/precommit-gate.sh\" claude-code"
          }
        ]
      }
    ]
  }
}
```

- `if` は、git 以外の Bash の呼び出しで、スクリプトそのものを起動しないための絞り込みである。
  `Bash(git commit *)` にしないのは、`git -C <dir> commit` のようにオプションを挟んだ形に当たらないためである。`Bash(git *)` はこの形に当たる（Claude Code 2.1.302 で実測）。
  `Bash(git *)` は、heredoc の中の `git commit`（`bash <<'EOF'` の本文）に当たらない（同じバージョンで実測）。
  ドキュメントによると、照合は前方一致なので、パスを付けた git（`/usr/bin/git commit`）と、照合の前に取り除かれないコマンドの後ろの git（`env A=1 git commit`・`sudo git commit`・`exec git commit`）にも当たらない。
  取り除かれるのは `timeout`・`time`・`nice`・`nohup`・`stdbuf`・`command`・`builtin` で、この後ろの git には当たる（[Claude Code permissions](https://code.claude.com/docs/en/permissions) の Wrappers の節）。
  スクリプトは、この 7 つと `sudo`・`env`・`xargs`・`exec` を、値を取るオプションと引数（`timeout 60`・`nice -n 5`・`sudo -u <user>`）ごと読み飛ばし、後ろの `git commit` をコミットと判定する。
  短いオプションをまとめた形（`env -iC <dir>`・`sudo -Eu <user>`）も、getopt と同じく、値を取る最初のオプションの後ろをその値として読む。
  長いオプションの省略形（`env --chd <dir>`）は、getopt_long と同じく一意な前方一致で正式な名前（`--chdir`）として読む。
  2 つ以上のオプションに当たる省略形（`sudo --ch` は `--chdir` と `--chroot`）は、値を取るかを決められないので、後ろに `git` の語とその後ろの `commit` の語があればコミットと判定する。作業ディレクトリは、それより前の指定（`env --chd <dir> --de`）も含めて変えない。
  `env -S <文字列>`（`--split-string`）は、GNU env と同じく値を空白で語に分け、その位置に置いてからオプションを読み直す（`env -S '-C <dir> git' commit` は `<dir>` でのコミット）。
  値に引用符・`\`・`$`・`#` があると語に分けられないので、語をつないだ文字列で `git` の後ろに `commit` があればコミットと判定し、作業ディレクトリは変えない。
  スクリプトが値を取ると知らないオプション（ラッパーごとに一覧を持つ）の値は、後ろのコマンドとして読むので、その後ろの `git commit` をコミットと判定しない。
  `if` に当たらないコミットではスクリプトが起動しないので、その時点の記録は作られず、判断の無いブランチでも確認を求めない。記録は、次にスクリプトが起動したコミットの collect がまとめて作る。ブランチの最後のコミットがこの形だと、その分の記録は PR に入らない。
  `if` を外すとこれらも検出できるが、スクリプトは heredoc の本文を読み飛ばさないので、git を実行しない heredoc（`cat > f <<'EOF'` の本文の行頭の `git commit`）もコミットと判定し、判断の無いブランチで止めるか、コミットしない呼び出しで記録を stage する。
  `if` を付けると、Claude Code がコマンドを解析できる呼び出しでは、この誤検知は git のサブコマンドを含む呼び出しに限られる（`git add f && cat > g <<'EOF'` の本文に `git commit` があれば、まだ誤検知する）。
  判断の無い feature ブランチで Hook の入力を渡して測ると、スクリプトは `git add a && cat > notes.md <<'EOF'` の本文の行頭に `git commit -m x` がある呼び出しを止め（exit 2）、本文に `git commit` が無ければ通す（exit 0）。
  `if` を付けるかは、取りこぼしたときの費用と、誤検知したときの費用を比べて決める。
  取りこぼしたコミットの記録は、上のとおり、同じブランチで後にスクリプトが起動するコミットがあれば、その collect が作る。無ければ、そのコミットの記録は PR に入らない。
  heredoc の本文の誤検知では、スクリプトはその呼び出しをコミットとして扱う。
  判断も `defaultDecision` も無いブランチでは呼び出しを止め、記録すると決めたブランチでは呼び出しのたびに collect を実行して `.agent-usage/records/` を stage する（条件の詳細は下の「Hook の振る舞い」の表）。
  collect は GitHub から取得するので時間がかかり、失敗すると呼び出しを止める。
  誤検知の費用は、記録が PR に入らないことがある取りこぼしより大きいので、`if` を付けて誤検知を減らす側を選ぶ。
  heredoc の本文を読み飛ばす処理をスクリプトに足せば誤検知は減るが、引用や入れ子の形ごとに判定の分岐が増えるので足さない。
  コマンドを解析できないときは `if` に関わらず起動するので、スクリプトの中でも判定する
- Claude Code は、timeout に達した Hook の呼び出しを止めずに通す。`timeout` を付けるなら、collect の所要時間（初めての collect は GitHub の取得で数分かかることがある）より長くする

### Codex（`.codex/hooks.json`）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$(git rev-parse --show-toplevel)/<SCRIPTS_DIR>/precommit-gate.sh\" codex"
          }
        ]
      }
    ]
  }
}
```

- Codex の matcher はツールの名前までしか絞れないので、すべての Bash の呼び出しでスクリプトが起動する。
  スクリプトは、`git commit` を含まない入力を Node.js を起動せずに数 ms で通す（[Codex Hooks](https://learn.chatgpt.com/docs/hooks)）
- Codex は、定義を足しただけでは Hook を実行しない。Codex CLI で `/hooks` を開いて定義を確かめ、信頼するまでをセットアップの完了条件にする。定義を変えたら、信頼し直す

### Hook の振る舞い

| 状況 | 振る舞い |
| --- | --- |
| `git commit` を実行しない | 通す。判定が扱う書き方と、`git commit` を実行しても検出しない形の主な例は、下の「コミットと判定しない形と、コミットと判定する形」にある |
| `.agent-usage/` が無い・detached HEAD・デフォルトブランチ | 通す |
| ブランチの判断が無く、人の設定にもリポジトリの設定にも `defaultDecision` が無い | 止める（exit 2）。stderr で、利用者に確かめて `collect --stage` か `decline` を実行するよう求める |
| ブランチの判断が無く、どれかの層の設定に `defaultDecision` がある（どれかの層の設定を読めないときは、値があっても、下の「設定を読めない」の行に当たる） | 止めずに、その値（`.local.jsonc`・人ごと・リポジトリの順で最初の値）を判断として扱う。下の「記録しない」「記録する」と同じに振る舞い、従った設定のパスを stderr に出す。ただし人の設定が無ければ、下の「人の設定が無く」の行に当たる |
| 人の設定が無く、リポジトリの設定の `defaultDecision` に従う場合か、判断が「記録する」場合 | 止める（exit 2）。stderr で、setup を実行して人の ID を作るか、`decline` を実行するよう求める。Hook からは人の ID を作らない |
| ブランチの判断が無く、設定を読めない（どれかの層の知らないキー・型の誤り・置けない層のキー、旧い置き場所の設定） | 止める（exit 2）。stderr で、読めない理由と、設定を直すか `decline` を実行するよう案内する。値を使わない層の誤りでも止める |
| 判断が「記録しない」 | 通す |
| 判断が「記録する」で、ブランチが merge 済み | collect も stage もせずに通し、merge 済みと決めた方法を stderr に出す。決め方は下の表の後に書く |
| 判断が「記録する」 | collect を実行し、`.agent-usage/records/` を stage して通す（前に書いて stage されなかった記録も入る）。collect が失敗したら止める。Hook の collect は常に GitHub も取得する（`--no-github` は手動の collect だけ）。コミットが実行されなかったときに stage が残る場合の扱いは、[SKILL.md「コミットの前の確認」](../SKILL.md)にある |
| Node.js が無い・同梱のスクリプトを読めない・想定外の失敗 | 確認をせずに通し、その旨を stderr に出す（記録の仕組みの不具合で作業を止めない） |

判断と collect は、git commit を実行する作業ディレクトリ（`-C <dir>` と前の `cd <dir>` を当てた先）のリポジトリで行う。
デフォルトブランチは、`origin/HEAD` から決める。分からなければ `main` と `master` をデフォルトブランチとして扱う。
判断はリポジトリに入れず、git の共通のディレクトリ（`git rev-parse --git-common-dir` の下の `agent-usage/decisions.json`）に置く。worktree でも共有する。

merge 済みのブランチかは、次の順に決める。どちらにも当たらなければ、merge 済みとせずに collect する。

1. HEAD が、リモートのデフォルトブランチ（`origin/<デフォルトブランチ>`）の祖先で、HEAD がこのブランチで作った commit である。
   作った直後のブランチや、fast-forward（`git pull`・`git merge --ff-only`）や reset でデフォルトブランチの commit に移っただけのブランチも、HEAD が祖先になる。
   そこで、ブランチの reflog の最新の行が、commit を作った行（`git commit`・`git cherry-pick`・`git revert`・merge commit）であることも確かめる。
   rebase した後や reflog が無いときは、この方法では決めない
2. `gh` で、このブランチを head にした PR のうち、merge 済みで head の commit が HEAD と同じものがある（squash merge と rebase merge では、HEAD がデフォルトブランチの祖先にならないため）。
   origin が GitHub でない・`gh` が無い・取得に失敗したときは、この方法では決めない。
   PR は origin のリポジトリでだけ探すので、fork から上流のリポジトリへ出した PR は見つからない

merge の後にそのブランチで commit を足していれば、HEAD が変わるので merge 済みとしない。新しい作業として記録する。
merge 済みのブランチで Hook が通しても、前に stage された明細は index に残る（SKILL.md「コミットの前の確認」）。

### コミットと判定しない形と、コミットと判定する形

この節は、スクリプトが起動した後の判定を扱う。
Claude Code は、`if` に当たらない形（`env A=1 git commit`・`sudo git commit` など）では、コマンドを解析できればスクリプトを起動しない。どの形でスクリプトが起動するかは、上の「Claude Code（`.claude/settings.json`）」に書いた。

Hook のスクリプトは、エージェントが普段書く形の `git commit` を判定する。
判定は、区切りの文字（`;`・`&`・`|`・`(`・`)`・バッククォート・改行）でコマンドを分けて読む。
そのうえで、引用符・`git` のグローバルのオプション（`-C <dir>` など）・`$(...)`・前の `cd <dir>` を扱う。
シェルの予約語（`if`・`then`・`while`・`do`・`{`・`!` など）と、コマンドを実行するコマンド（`env`・`command`・`sudo` など）も読み飛ばす。
普段書かない形まで判定を広げると、形ごとに判定の分岐が増え、広げるたびに新しい誤検知と見逃しが見つかる。
そのため、判定を直さず、見逃す形と止めすぎる形の主な例を次の 2 つの表に挙げる。
表は網羅していない。表に無い形でも、見逃しや止めすぎは起こる。

次の表は、このリポジトリへの commit でも、スクリプトが判断を確かめずに通す形の主な例である。記録もしない。
確認させたい commit は、`git commit` か `git -C <dir> commit` を、行の先頭か区切りの文字（`;`・`&`・`|`・`(`・`)`・バッククォート・改行）の直後に書く。

| 形 | 例 | スクリプトの読み方 |
| --- | --- | --- |
| エイリアス・変数で書く | `alias gc='git commit'; gc`・`G=git; $G commit` | 名前が `git` でないコマンドとして読む |
| 別のコマンドの引数やスクリプトの中に書く | `sh -c 'git commit'`・`eval git commit`・`./scripts/commit.sh` | 引数やスクリプトの中は読まない |
| 関数置換の中に書く | `echo ${ git commit; }`・`echo "${ git commit; }"` | 引用の有無に関わらず、`${ …; }` の中を読まない |
| `coproc` の後ろに書く | `coproc git commit` | `coproc` を予約語としてもラッパーとしても読まない |
| `git` や `commit` の語を引用符で分ける | `g"it" commit`・`git "comm"it` | 検出されるかは決まらない。Node.js を起動する前の絞り込みは、Hook の入力の JSON 全体に `git` と `commit` の語がこの順であるかを見る。他の欄（`cwd`・`transcript_path` など）に語が無ければ、ここで通す。あれば Node.js の判定に渡り、引用を外して commit と判定する |
| 環境変数でリポジトリを差し替える | `GIT_DIR=<このリポジトリ>/.git git -C <別のリポジトリ> commit` | 判断と collect を `-C` の先のリポジトリで行い、`GIT_DIR` を読まない。`-C` の先に `.agent-usage/` が無ければ通す |

次の表は、commit しない呼び出しでも、スクリプトが commit と判定する形の主な例である。

| 形 | 例 | スクリプトの読み方と、避ける書き方 |
| --- | --- | --- |
| git のパスを調べる `command -v` | `command -v git commit` | `command` を後ろのコマンドを実行するコマンドとして読み、`-v` を読み飛ばして、後ろを commit と判定する。判断が無ければ止め、判断が「記録する」なら collect して stage する。`command -v git` だけを書く |

## 3. 動作を確かめる

1. `agent-usage status` で、セットアップ済みであることと、人の ID を確かめる
2. feature ブランチで `agent-usage status` を実行し、「このブランチの判断」に `defaultDecision` が出ていれば、Hook は判断の無いブランチのコミットを止めずにその値に従う。
   そのときは試しのコミットをせず、手順 3 と 4 を飛ばす。`record` の値で試しのコミットをすると、明細がコミットに入り、最初の collect の記録が残る
3. feature ブランチで、何も変えずに `git commit --allow-empty -m test` を試し、Hook が止めて確認を求めることを確かめる（止まらなければ、Hook の設定か Codex の信頼を見直す）
4. `agent-usage decline` を実行し、同じコミットが通ることを確かめてから、試しのコミットを取り消すか残すかを利用者に確かめる

## 設定（`agent-usage.jsonc`）

すべてのキーは任意である。知らないキー・型の誤り・置けない層に書いたキーはエラーにする（綴りの誤りが警告なしにデフォルトとして扱われるのを防ぐ）。
リポジトリの設定（`.config/skills/shoji9x9/agent-usage.jsonc`）には、次のキーを置ける。

```jsonc
{
  // 単価は同梱の単価表より優先する
  "pricing": { "<モデル>": { "input": 4, "output": 20, "cacheRead": 0.2, "cacheWrite5m": 5, "cacheWrite1h": 8 } },
  "reviewPricing": { "copilot": 0.04 },
  "ci": { "external": false },
  "activityWindowMinutes": 15,
  "reviewTools": { "<レビューの作者の login>": "<ツールの名前>" },
  "people": { "p-0123abcd": { "name": "表示名" } },
  "aliases": { "p-89abcdef": "p-0123abcd" },
  "defaultDecision": "record"
}
```

| キー | 置ける層 | 意味 |
| --- | --- | --- |
| `pricing` | リポジトリ | モデルごとの単価（USD / 100 万トークン）。同梱の単価表（`assets/pricing.json`）より優先する。`input` と `output` は必須 |
| `reviewPricing` | リポジトリ | レビューツールごとの 1 回あたりの推定額（USD）。同梱の推定額（`assets/pricing.json` の `reviews`）より優先する。どちらにも無ければ、そのツールのレビューの費用は空欄にする |
| `ci.external` | リポジトリ | GitHub Actions 以外の CI（check runs・commit status）も取得するか。取得は PR の head の commit ごとに呼び出すので、デフォルトでは無効 |
| `activityWindowMinutes` | リポジトリ | 人の活動の前後で、人がいたとみなす幅（分）。デフォルトは 15 |
| `reviewTools` | リポジトリ | レビューの作者からツールを決める対応。同梱の `assets/review-tools.json` より優先する。自分の Actions で実行するレビューの作者（workflow のトークンの持ち主）はここに足す |
| `people` | リポジトリ | 人の ID の表示名 |
| `aliases` | リポジトリ | 同じ人としてまとめる ID の対応（左の ID を右の ID として数える）。右の ID をさらに別名にはできない |
| `defaultDecision` | すべて | 判断の無いブランチの扱い（`record` か `decline`）。置くと、コミットの前の確認で止めずにこの値に従う。`.local.jsonc`・人ごと・リポジトリの順に見て、最初に見つかった値を使う（`null` は置いていないのと同じで、下の層を見る）。どこにも無ければ止めて確かめる |
| `personId` | 人ごと | 人の ID。setup か最初の collect が作る |
| `timeZone` | 人ごと・`.local.jsonc` | 記録と集計のタイムゾーン（IANA の名前）。省くとマシンのタイムゾーン |
| `billing` | 人ごと | `user` なら、collect が個人のプランの premium request の実額も記録する。デフォルトは `none` |

リポジトリの設定はコミットして全員で使うので、`defaultDecision` は、人の設定（setup が作る人の ID）があり、そこに同じキーを置いていないすべての人のコミットに当たる。
人の設定が無い人には当てない。その人のコミットは止まり、setup を求める（Hook は人の ID を作らない）。
`record` を置くと、確認を受けずに各自の利用実績が記録されてコミットに入るので、置く前にリポジトリを使う人の同意を得る。
反対の向きもある。人の設定の `record` は、リポジトリの設定の `decline` より優先する。そのため、記録しないと決めたリポジトリでも、人の設定に `record` を置いた人のコミットには明細が入る。人の設定に `record` を置く人は、このことを知ったうえで置く。

`defaultDecision` を知らない古いバージョンの agent-usage は、知らないキーとしてエラーにする。
人の設定はマシンのすべてのリポジトリで共有するので、人の設定に置くときは、そのマシンで使うすべてのリポジトリのスキルを、このキーを読めるバージョンに更新してから置く。
リポジトリの設定に置くときも、そのリポジトリを使う人のスキルを先に更新する。

### 使い捨ての環境と、HOME に書けない環境

CI のジョブの中で動くエージェントや、クラウドのエージェントの環境は、実行のたびに作り直される。人の設定が残らないので、そのままではコミットのたびに止まる。
環境の起動の処理（ジョブの最初のステップや、環境のセットアップのスクリプト）で、人の設定を書いておく。
`personId` には、その人がいつも使う ID（手元のマシンで `agent-usage status` の「人の設定」に出る値）を書く（実行のたびに別の ID にすると、人別の集計が分かれる）。`defaultDecision` も同じファイルに書く。

```bash
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/skills/shoji9x9"
cat > "${XDG_CONFIG_HOME:-$HOME/.config}/skills/shoji9x9/agent-usage.jsonc" <<'JSON'
{ "personId": "p-0123abcd", "timeZone": "Asia/Tokyo", "defaultDecision": "record" }
JSON
```

HOME に書けない sandbox では、`XDG_CONFIG_HOME` を書ける場所に向けてから、同じ内容を書く。人の設定の置き場所は、`XDG_CONFIG_HOME` があればその下の `skills/shoji9x9/agent-usage.jsonc` になる。迷ったら、Hook が止めたときの stderr に出るパスに書く。
向けた環境変数は、エージェントを起動するプロセスにも設定する。Hook はエージェントの環境変数を引き継ぐので、設定のスクリプトの中だけで向けると、Hook は元の場所を見て止まる。
