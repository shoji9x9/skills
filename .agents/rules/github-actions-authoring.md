---
paths:
  - ".github/workflows/**"
applyTo: ".github/workflows/**"
---

# GitHub Actions ワークフロー作成・変更時のレビュー観点

ワークフローを追加・変更するたびに、actionlint では検出できない次の設計上の観点を確かめる。

## 1. 必要権限の突き合わせ（最小権限）

ジョブの `permissions` を最小にするときは、使う `gh` や REST の操作ごとに、必要な `GITHUB_TOKEN` の permission を突き合わせる。

- ラベルの操作（`gh label create`・`gh pr edit --add-label`・`--remove-label`）と、Issue の作成・コメントは、Issues API のリソースを使うので `issues: write` が要る。
  PR への操作でも `pull-requests: write` だけでは足りない。`gh pr edit --add-label` にも `issues: write` が要る。
- 判断に迷ったら、同じリポジトリの既存のワークフローを参考にする（例: `outdated.yml` は Issue を作るので `issues: write` を持つ）。

## 2. 前のステップが失敗したときの代わりの処理

振り分け・通知・ラベルの付与のように、実行されないと困る処理を、その前の通常の処理のステップが失敗したら実行されない形にしない。

- 失敗しうるステップ（例: コンフリクトで失敗する `gh pr merge --auto`）には `continue-on-error: true` を付けてジョブを続ける。
  そのうえで、失敗したときに実行する処理を後ろのステップに用意する（例: 自動マージの予約に失敗したら、レビュー用のラベルを付ける）。

## 3. エージェントのツールが読める場所と書ける場所

ワークフローでエージェント（`anthropics/claude-code-action` など）を動かし、その出力を Issue や PR に載せるなら、ジョブの `permissions` とは別に、エージェントのツールが読める場所と書ける場所を確かめる。
`contents: read` にしても、エージェントの `Read` はリポジトリの外（`/proc/self/environ`・`~/.claude`）を読め、`Write` は `.git/config` にも書ける。
入力に仕込まれた指示に従うと、資格情報を出力に書いて公開したり、git の設定を書き換えて後の段にコマンドを実行させたりしうる。

- 使えるツールは、拒否の一覧（`--disallowed-tools`）ではなく `--tools` で限る。拒否の一覧は、エージェントがツールを足すたびに抜けが出る。
- 読む・書くツールはパスの規則で限る（`Read(./**)`・`Grep(./**)`・`Glob(./**)` と、結果のファイルへの `Edit(./<file>)`）。Claude Code では `Edit(<path>)` の規則が Write にも当たり、`Write(<path>)` の形の規則は当たらない。
- `claude_args` に `--permission-mode default` を渡す。`claude-code-action` は v1.0.273 から auto mode をデフォルトにし、許可の規則に無い呼び出しを安全性の判定で通しうる。
  Bash の許可の規則は、引数まで決めたコマンドで書く。`*` を使うと、引数に任意のパスを渡せる。
  default モードでも、作業ディレクトリと `--add-dir` の中の読み取り（Read・Grep・Glob と、`cat` のような読むだけの Bash）は、許可の規則が無くても通る。読めるパスを絞るには、拒否の規則を使う。
- `claude-code-action` は agent モードで、エージェントを起動する前に `github_token` を使わせる設定を作業ツリーの `.git/config` に書く。
  `allowed_bots` を指定しないときは remote の URL に token を書き、指定すると環境変数 `GH_TOKEN` を読む credential helper を設定する。checkout の `persist-credentials: false` はこれを防がない。
  作業ディレクトリが checkout の作業ツリーなら、Read の許可の規則に関わらず、`--disallowed-tools` に `Read(./.git/**)` を入れる。
  この規則は Read に加えて Grep と Glob にも当たり、`.git` の中を指すシンボリックリンク・サブエージェントの読み取り・Bash の `cat`・`head`・`grep` も止める。
  Claude Code 2.1.325 の `claude -p` で、絶対パスでの読み取りも含めて確かめた。`Glob(./.git/**)` の形の拒否の規則は、Glob にも当たらなかった。
  `Grep(./.git/**)` の形も当たらないことは、`docs/claude-review.md`「危険と対策」に記録がある。
- リポジトリの設定を読ませない（`--setting-sources user` と `--strict-mcp-config`）。`.claude/settings.json` の Hook と `.mcp.json` の MCP サーバーは `--tools` の制限の外で動き、同じ設定の `permissions` は読める範囲を広げうる。
- Codex（`openai/codex-action`）の組み込みの `:read-only` は、ファイルシステム全体を読める。`codex-home` の `config.toml` に、`":root" = "deny"` と `:workspace_roots` の read を持つ名前付きの permission profile を書き、`permission-profile` にその名前を渡す。
  シェルに渡す環境変数は `[shell_environment_policy]` の `inherit = "core"` で絞る。`codex-args` の `-c` で permission を上書きする形は、action が拒否する。
  sandbox の中で codex を起動するには、codex を入れた場所の read も要る。codex-action は自分の `actions/setup-node` の Node に codex を入れるので、action より前の段で取った `npm root -g` とは場所が違う。ツールキャッシュ（`RUNNER_TOOL_CACHE`）に read を与える。
- GitHub Copilot CLI は、`--available-tools` で使えるツールを読み取りのもの（`view`・`grep`・`glob`）に限り、`--allow-all-paths`・`--add-dir` を付けない。
- 資格情報が出力に出るのを、出力を正規表現で検査して止める作りにしない。加工した値（区切り文字を挟むなど）は正規表現に当たらずに出力されるので、エージェントが読める範囲を絞る。
- 拒否や限定が機能するかは、そのツールを使うよう指示したエージェントの CLI（`claude -p`・`codex sandbox -P`・`copilot -p`）を、限る場合と限らない場合の両方で実行して確かめる。
