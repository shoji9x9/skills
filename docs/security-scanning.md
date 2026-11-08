# セキュリティの検査

PR ごとに、決定論的なスキャナと LLM の差分レビューで、セキュリティの観点を確かめる。
リポジトリ全体を LLM で監査する処理は時間がかかるので、PR ごとには行わず、別のワークフローで行う（「リポジトリ全体の監査」）。

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

## リポジトリ全体の監査

`.github/workflows/security-audit.yml` が、[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)（MIT）をエージェントに実行させ、リポジトリ全体を監査する。
上流のスキルは、偵察・調査・候補の検証・記録の検証・報告の段に分けてサブエージェントを使い、`findings.json`（指摘の記録）と `coverage-ledger.json`（網羅の台帳）を書く。
スキルは、ワークフローの `SKILL_SHA` に固定した commit を取得して使う。上げるときは、差分を読んでから SHA を変える。

### 資格情報と設定

| 名前 | 種類 | 用途 |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret | エージェントの資格情報。週次のセルフ点検（`docs/self-review.md`）と同じものを使う |
| `SECURITY_AUDIT_STATE_KEY` | secret | 記録を暗号化する鍵。追跡 Issue に載せる識別子を作る鍵にも使う |
| `SECURITY_AUDIT_MODEL` | リポジトリ変数 | エージェントのモデル（例: `opus`）。無ければ `claude-code-action` のデフォルトのモデルを使う |
| `SECURITY_AUDIT_SKIP` | リポジトリ変数 | `on`・`true`・`yes`・`1` のどれかなら、監査を一時停止する |

鍵は、手元で作って secret に登録し、同じ値を手元のパスワードマネージャなどにも保管する。記録を読むときに要る。

```bash
openssl rand -base64 48 | tr -d '\n' >security-audit-key.txt
gh secret set SECURITY_AUDIT_STATE_KEY --repo shoji9x9/skills <security-audit-key.txt
```

### 実行

`workflow_dispatch` で実行し、入力で対象・プロファイル・エージェントの起動回数の上限を選ぶ。

| 入力 | 値 |
| --- | --- |
| `target` | `self`（このリポジトリ）か `dvna`（既知の脆弱性を持つ [appsecco/dvna](https://github.com/appsecco/dvna) を、固定した commit で監査する。検出できるかの確認用） |
| `profile` | `quick`（調査を 1 波だけ行う）か `standard`（上流のスキルのデフォルト） |
| `budget` | エージェントを起動する回数の上限（1〜999） |

エージェントのツールは、対象とスキルと記録を読むこと、出力のディレクトリに書くこと、サブエージェントを使うこと、上流の検証スクリプト（`validate-findings.cjs`・`validate-coverage-ledger.cjs`）を実行することに限る。
GitHub-hosted runner には、上流のスキルが対象のコードを実行する前に求める、OS が強制する sandbox が無い。
そのため、対象のコードを実行して確かめる候補は、上流のスキルの決まりどおり `needs_validation`（確かめきれなかった候補）として残る。

### 記録の引き継ぎと公開する範囲

公開リポジトリの artifact はログインした誰でも取得できるので、監査の出力とエージェントの実行記録は、`SECURITY_AUDIT_STATE_KEY` で暗号化してから artifact に置く。
`self` の監査で記録の形を確かめられたら、`security-audit-state-<鍵の識別子>`（90 日保持）に置き、次の実行がそれを復号して前回の記録として引き継ぐ。
鍵の識別子は、鍵から作った HMAC の先頭 12 桁で、鍵には戻せない。
引き継ぐのは、今回を含む直近の 3 回分の出力である。今回が未完了でも、その前の完了した実行の記録が残る。
失敗した実行と `dvna` の監査の記録は、`security-audit-run-<対象>-<試行>`（14 日保持）に置き、引き継がない。

追跡 Issue（`Security audit findings (<日付>)`）は、デフォルトブランチの監査だけが書く。追跡 Issue には、判定ごとの件数と、記録ごとの識別子（`sa-` と 12 桁の 16 進数）だけを載せる。
識別子は、記録の fingerprint を鍵付きハッシュにしたもので、鍵が無いと fingerprint を推測して確かめることもできない。
監査が完了し（`run_status` が `complete`）、対応が要る記録（`confirmed` と `needs_validation`）が 0 件になったら、追跡 Issue を閉じる。
未完了の監査は、確かめきれなかった候補を `findings.json` に載せないので、0 件でも追跡 Issue を閉じない。

### 記録の読み方

run の artifact を取得し、鍵で復号する。出力のディレクトリの `REPORT.md`・`FINDINGS-DETAIL.md`・`NEEDS-VALIDATION.md` が、上流のスキルの報告である。
追跡 Issue の識別子と記録を対応づけるときは、`findings.json` の各 fingerprint から `scripts/weekly/security-audit-issue.ts` の `itemId` で識別子を作って照らし合わせる。

```bash
gh run download <run の ID> --repo shoji9x9/skills --pattern 'security-audit-*' --dir audit
# artifact ごとのディレクトリ（audit/<artifact の名前>/state.tar.gpg）ができる
gpg --batch --pinentry-mode loopback --passphrase-file security-audit-key.txt --decrypt audit/<artifact の名前>/state.tar.gpg | tar -xf - -C audit
```

鍵を替えると、引き継ぐ記録の artifact の名前（鍵の識別子）も変わるので、次の実行は古い鍵の記録を選ばずに初回として監査する。古い記録は、保持の期間が過ぎると消える。
識別子も鍵から作るので、鍵を替えた次の実行は、追跡 Issue の記録をすべて「新規」、前回の記録をすべて「解消」と書く。直ったという意味ではないので、その回の差分は読み飛ばす。
