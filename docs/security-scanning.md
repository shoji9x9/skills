# セキュリティの検査

PR ごとに、決定論的なスキャナと LLM の差分レビューで、セキュリティの観点を確かめる。
リポジトリ全体を LLM で監査する処理は時間がかかるので、PR ごとには行わない。

## 構成

| ツール | 対象 | 実行する場所 | 指摘があったとき |
| --- | --- | --- | --- |
| CodeQL（`javascript-typescript` と `actions`） | JavaScript・TypeScript のコードと `.github/workflows/` | `.github/workflows/codeql.yml`（PR・`push: main`・週次の `schedule`） | 結果を code scanning に表示し、ルールセットの code scanning の規則がマージを止める |
| zizmor | `.github/`（ワークフローと `dependabot.yml`）と、配布するワークフローのテンプレート（`skills/*/assets/` の YAML のうち、`jobs:` を持つもの） | CI の `GitHub Actions lint` ジョブ | 1 件でもあればジョブが失敗する |
| gitleaks | pre-commit はステージした差分、CI は全履歴 | pre-commit と CI の `Secret scan` ジョブ | commit とジョブが失敗する |
| `/security-review`（Claude Code に組み込みのコマンド） | push する前の差分 | 手元（「push の前のレビュー」） | 妥当な指摘だけを直してから push する |

CodeQL の解析のジョブは、指摘があっても失敗しない。
マージを止めるのは、`main` のルールセットの code scanning の規則（ツールは CodeQL）である。
code scanning の規則は、PR の commit に CodeQL の結果が上がるのを待ち、閾値以上の指摘があればマージを止める。

zizmor は mise でインストールする（`mise.toml`）。手元では、CI の `Security lint (zizmor)` のステップと同じ対象に実行する。テンプレートが 1 つなら、次のとおりである。

```bash
GH_TOKEN="$(gh auth token)" zizmor .github skills/kaizen/assets/kaizen-schedule.yml
```

`GH_TOKEN` を渡さないと、GitHub API を読む検査（タグの付け替え・既知の脆弱性を持つ Action）が実行されない。
`--offline` を付けた実行は、その検査を飛ばしても exit 0 になるので、合格の根拠にしない。

## 指摘を除外する方法

除外する前に、直せないかを確かめる。除外するときは、理由を除外と同じ場所に書く。

### zizmor

`.github/zizmor.yml` の `rules.<検査の名前>.ignore` に、ファイル名（`<ファイル名>` か `<ファイル名>:<行>`）を足す。
ファイル名だけを書くと、そのファイルの中のその検査の指摘をすべて外す。
行番号を書くと、ファイルを編集して行がずれたときに除外が外れる。
配布するテンプレートは `.github/workflows/` のワークフローと同じファイル名なので、1 行で両方を外せる。

指摘の範囲の行に YAML のコメント `# zizmor: ignore[<検査の名前>]` を書いても、その指摘を外せる。
コメントは `zizmor:` で始める必要がある。pinact のバージョンのコメントを持つ `uses:` の行では、`#` を重ねて後ろに書く（`# v7.0.1 # zizmor: ignore[<検査の名前>]`）。この形は pinact の `--check` も受け付ける。
`run: |` の本文の中に書いたコメントはシェルのコメントで、YAML のコメントではないので、zizmor は読まない。
`run: |` の本文の中の指摘は、`.github/zizmor.yml` で外す。

### CodeQL

指摘は、code scanning の画面（Security タブ）で、理由（`False positive`・`Used in tests`・`Won't fix`）と説明を付けて dismiss する。
同じ種類の指摘がディレクトリ単位で出続けるなら、CodeQL の設定ファイルの `paths-ignore` で外す。
設定ファイルは `.github/workflows/codeql.yml` の `init` の `config-file` で渡す。

## push の前のレビュー

Claude Code では、push する前に、手元で `/code-review` に続けて `/security-review` を実行する。
`/security-review` は、現在のブランチの差分をセキュリティの観点（コマンドインジェクション・資格情報の扱い・入力の検証など）でレビューする。
妥当な指摘は直し、直さない指摘は理由を PR の本文に書く。
`/security-review` を持たないエージェント（Codex・GitHub Copilot）では、push の前のレビューに、同じ観点で差分を確かめるよう指示を添える。
CI では `/security-review` を実行しない。手元の実行で同じ差分を push の前に確かめられ、CI で重ねると PR ごとに使用量が増えるからである。
