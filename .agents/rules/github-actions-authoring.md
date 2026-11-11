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
- リポジトリの設定を読ませない（`--setting-sources user` と `--strict-mcp-config`）。`.claude/settings.json` の Hook と `.mcp.json` の MCP サーバーは `--tools` の制限の外で動き、同じ設定の `permissions` は読める範囲を広げうる。
- Codex（`openai/codex-action`）の組み込みの `:read-only` は、ファイルシステム全体を読める。`codex-home` の `config.toml` に、`":root" = "deny"` と `:workspace_roots` の read を持つ名前付きの permission profile を書き、`permission-profile` にその名前を渡す。
  シェルに渡す環境変数は `[shell_environment_policy]` の `inherit = "core"` で絞る。`codex-args` の `-c` で permission を上書きする形は、action が拒否する。
  sandbox の中で codex を起動するには、codex を入れた場所の read も要る。codex-action は自分の `actions/setup-node` の Node に codex を入れるので、action より前の段で取った `npm root -g` とは場所が違う。ツールキャッシュ（`RUNNER_TOOL_CACHE`）に read を与える。
- GitHub Copilot CLI は、`--available-tools` で使えるツールを読み取りのもの（`view`・`grep`・`glob`）に限り、`--allow-all-paths`・`--add-dir` を付けない。
- 出力を正規表現で検査して塞がない。加工した値（区切り文字を挟むなど）が通るので、読める範囲を絞るほうを選ぶ。
- 拒否や限定が機能するかは、そのツールを使うよう指示したエージェントの CLI（`claude -p`・`codex sandbox -P`・`copilot -p`）を、限る場合と限らない場合の両方で実行して確かめる。
