# セットアップ

`agent-usage setup` と、コミットの前の確認の Hook を設定する手順。

## 1. 人の ID と、リポジトリの設定を作る

```bash
node <このスキル>/scripts/agent-usage.mjs setup --time-zone Asia/Tokyo
```

- 人の ID（`p-` と 16 進数 8 桁）は、初めての実行で作る。置き場所は `${XDG_CONFIG_HOME:-~/.config}/agent-usage/config.json` で、マシンのすべてのリポジトリが同じ ID を使う
- 別のマシンで同じ人として数えたいときは、そのマシンでも `--person-id <既存の ID>` を付けて実行する
- 後から同じ人だと分かった ID は、リポジトリの設定の `aliases` でまとめる（下の「リポジトリの設定」）
- タイムゾーンを省くと、マシンのタイムゾーンを使う。日別の集計の日付と、時刻ごとの停止の時間はこのタイムゾーンで切る
- `--billing user` を付けると、collect が個人のプランの premium request の実額（GitHub の課金 API）も記録する（[`reviews.md`](reviews.md)）

setup はリポジトリに `.agent-usage/config.json`（空の設定）と `.agent-usage/records/` を作る。`.agent-usage/` があることが、このリポジトリでスキルを使う印になる（Hook は無いリポジトリでは何もしない）。

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
  `Bash(git commit *)` にしないのは、`git -C <dir> commit` のようにオプションを挟んだ形が当たるかを、ドキュメントで確かめられないためである。
  コマンドを解析できないときは `if` に関わらず起動するので、スクリプトの中でも判定する（[Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)）
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
| `git commit` を実行しない | 通す。判定は、引用符・`git` のグローバルのオプション（`-C <dir>` など）・`&&`・`;`・`$(...)`・シェルの予約語（`then`・`do`・`{`・`!` など）・コマンドを実行するコマンド（`env`・`command`・`sudo` など）を扱う。エイリアス・変数・`sh -c` の中・スクリプトの中・`git` や `commit` の語を引用符で分けた形は検出しない |
| `.agent-usage/` が無い・detached HEAD・デフォルトブランチ | 通す |
| ブランチの判断が無い | 止める（exit 2）。stderr で、利用者に確かめて `collect --stage` か `decline` を実行するよう求める |
| 判断が「記録しない」 | 通す |
| 判断が「記録する」 | collect を実行し、増えた明細を stage して通す。collect が失敗したら止める。Hook の collect は常に GitHub も取得する（`--no-github` は手動の collect だけ） |
| Node.js が無い・同梱のスクリプトを読めない・想定外の失敗 | 確認をせずに通し、その旨を stderr に出す（記録の仕組みの不具合で作業を止めない） |

デフォルトブランチは、`origin/HEAD` から決める。分からなければ `main` と `master` をデフォルトブランチとして扱う。
判断はリポジトリに入れず、git の共通のディレクトリ（`git rev-parse --git-common-dir` の下の `agent-usage/decisions.json`）に置く。worktree でも共有する。

## 3. 動作を確かめる

1. `agent-usage status` で、セットアップ済みであることと、人の ID を確かめる
2. feature ブランチで、何も変えずに `git commit --allow-empty -m test` を試し、Hook が止めて確認を求めることを確かめる（止まらなければ、Hook の設定か Codex の信頼を見直す）
3. `agent-usage decline` を実行し、同じコミットが通ることを確かめてから、試しのコミットを取り消すか残すかを利用者に確かめる

## リポジトリの設定（`.agent-usage/config.json`）

すべてのキーは任意である。知らないキーと型の誤りはエラーにする（綴りの誤りが警告なしにデフォルトとして扱われるのを防ぐ）。

```json
{
  "pricing": { "<モデル>": { "input": 4, "output": 20, "cacheRead": 0.2, "cacheWrite5m": 5, "cacheWrite1h": 8 } },
  "reviewPricing": { "copilot": 0.04 },
  "ci": { "external": false },
  "activityWindowMinutes": 15,
  "reviewTools": { "<レビューの作者の login>": "<ツールの名前>" },
  "people": { "p-0123abcd": { "name": "表示名" } },
  "aliases": { "p-89abcdef": "p-0123abcd" }
}
```

| キー | 意味 |
| --- | --- |
| `pricing` | モデルごとの単価（USD / 100 万トークン）。同梱の単価表（`assets/pricing.json`）より優先する。`input` と `output` は必須 |
| `reviewPricing` | レビューツールごとの 1 回あたりの推定額（USD）。同梱の推定額（`assets/pricing.json` の `reviews`）より優先する。どちらにも無ければ、そのツールのレビューの費用は空欄にする |
| `ci.external` | GitHub Actions 以外の CI（check runs・commit status）も取得するか。取得は PR の head の commit ごとに呼び出すので、デフォルトでは無効 |
| `activityWindowMinutes` | 人の活動の前後で、人がいたとみなす幅（分）。デフォルトは 15 |
| `reviewTools` | レビューの作者からツールを決める対応。同梱の `assets/review-tools.json` より優先する。自分の Actions で実行するレビューの作者（workflow のトークンの持ち主）はここに足す |
| `people` | 人の ID の表示名 |
| `aliases` | 同じ人としてまとめる ID の対応（左の ID を右の ID として数える）。右の ID をさらに別名にはできない |
