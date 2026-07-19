# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向け汎用スキル集。
エージェントによる自律的な開発（Issue の起票・着手から実装・レビュー対応・リリースまで）に必要なスキルを提供する。

## 利用可能なスキル

| スキル | 説明 |
|-------|------|
| [multiagent-setup](./skills/multiagent-setup/) | スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップ |
| [kaizen](./skills/kaizen/) | セッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映して同じ失敗の再発を防ぐ |
| [issue-create](./skills/issue-create/) | 短い説明から GitHub Issue を作成。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票 |
| [issue-start](./skills/issue-start/) | GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化 |
| [pr-review-handle](./skills/pr-review-handle/) | PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決。`--push` で commit・push・CI 確認後の Copilot 再依頼まで |
| [dependabot-merge](./skills/dependabot-merge/) | Dependabot PR の CI 確認・影響レビュー・判断のコメント記録・マージを標準化。PR 単体または `--all` で open な全 PR を処理（0.x や自動マージ未設定リポジトリ向け） |
| [dependabot-alert-issue](./skills/dependabot-alert-issue/) | Dependabot alerts を確認し解消 Issue を作成。着手可否で分類し severity・パッケージ単位でグルーピング、着手不能なものは着手可能条件を明記。設定で特定 alert の無視・dismiss も指定可 |
| [pr-finalize-loop](./skills/pr-finalize-loop/) | 作成済み PR の CI エラー解消とレビュー指摘対応を、CI 成功かつ未解決スレッドなしになるまで自律ループで反復。`--max-iterations`（既定 5）で停止し、人間判断を要する指摘だけ確認して反映後に復帰 |
| [browser-test](./skills/browser-test/) | フロント／バックエンドの変更を実ブラウザ（chrome-devtools MCP）で回帰確認。実施できる操作は環境ごとの設定（`forbidden_actions`）に従い、副作用を伴う操作は承認制（未設定の環境は読み取り専用）。変更スコープから影響ページを導出し、描画・console・API 応答を確認して課題をクロス環境で切り分け。`setup` で対話的に設定を記録 |
| [aws-architecture-diagram](./skills/aws-architecture-diagram/) | AWS 構成図を IaC（CDK / Terraform 等）や説明から spec に起こし SVG として生成・更新。作図ルール（交差最小・直交配線・軸整列）に従い、環境（prod / local 等）を単一ベース spec＋変換で出し分け、PNG 化して目視確認しながら反復。初回は `setup` で対話導入、以降は `update` |
| [box](./skills/box/) | Box のファイル/フォルダを Box REST API（`curl` + `jq`）で参照・検索・更新。フォルダ一覧・メタ取得・ダウンロード・検索・アップロード・新バージョン作成を、Dev Token または OAuth refresh のトークンで実行。MCP・SDK 不要 |
| [replace-strategy](./skills/replace-strategy/) | 仕様を変えないアプリケーションリプレイスの入口。現行アプリを実測（セマンティクス・DB 復元可否・コード入手性・副作用・既存テスト）して戦略を決め、機能に分解して姉妹スキルへ振り分ける。自分では実装しない。`setup` / `issues`（issue-create へ委譲）/ `status` の 3 モード。測定できなければ停止 |
| [golden-dataset](./skills/golden-dataset/) | replace-strategy の姉妹スキル。現行と新側の比較を成立させる共通データセットを構築。データそのものではなく冪等・決定論的な投入ツール（TypeScript / SQL）を作り、本番を参照せず一から作る。新側スキーマは後から出来るため 2 フェーズ（A: 現行テスト環境へ投入・検証、B: 新側スキーマへ写像・投入・現新一致検証）。データセットのバージョンで parity-suite / parity-diff のベースライン陳腐化を検出。replace-strategy setup 未完了なら停止 |
| [parity-suite](./skills/parity-suite/) | replace-strategy の姉妹スキル。現行アプリに対してパリティスイート（新旧どちらの実装にも当てられる実行可能な合否判定基準）を Playwright で構築し、故障注入で強度を検証。論理名のロケータマッピング・手書きの寛容な aria スナップショット・API の record/replay・視覚ベースラインとノイズ基準値の採取まで。1 回の実行で 1 機能。replace-strategy setup / golden-dataset 未完了・Playwright 不可なら停止 |

## 前提条件

- [GitHub CLI](https://cli.github.com/) **v2.90.0 以降**（`gh skill` コマンドが必要。`gh --version` で確認）。`gh skill` は v2.90.0 で導入された（[changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/)）
- `gh auth login` で GitHub に認証済みであること

## インストール

```bash
gh skill install shoji9x9/skills multiagent-setup
gh skill install shoji9x9/skills kaizen
gh skill install shoji9x9/skills issue-create
gh skill install shoji9x9/skills issue-start
gh skill install shoji9x9/skills pr-review-handle
gh skill install shoji9x9/skills dependabot-merge
gh skill install shoji9x9/skills dependabot-alert-issue
gh skill install shoji9x9/skills pr-finalize-loop
gh skill install shoji9x9/skills browser-test
gh skill install shoji9x9/skills aws-architecture-diagram
gh skill install shoji9x9/skills box
gh skill install shoji9x9/skills replace-strategy
gh skill install shoji9x9/skills golden-dataset
gh skill install shoji9x9/skills parity-suite
```

## スキルの更新

```bash
gh skill update --all
```

## スキルの設定

一部のスキル（issue-start / pr-review-handle / dependabot-merge / dependabot-alert-issue / pr-finalize-loop / browser-test / replace-strategy / golden-dataset / parity-suite）は、
インストール先プロジェクトの設定を `.config/skills/<owner>/<repo>.yml` から読む。
`<owner>/<repo>` は**配布元（publisher）の owner/repo で固定**であり、導入先のリポジトリ名ではない（本リポジトリ配布物は常に `.config/skills/shoji9x9/skills.yml`）。
設定は、**設定を作成するスキル**（`replace-strategy setup` / `browser-test setup` や各スキルの規約解決フロー等）の実行時に**非破壊で自動作成・追記**され（既存のキー・値・コメントは変更しない）、
skill ディレクトリ外にあるため `gh skill update` でも保持される。共有契約を**読むだけ**のスキル（golden-dataset / parity-suite 等）は設定を生成せず、未設定なら作成元スキル（`replace-strategy setup`）の実行を促して停止する。

```yaml
version: 1
skills:
  common:
    # 導入先に実在する規約ドキュメントを指定（例: AGENTS.md / CLAUDE.md / CONTRIBUTING.md）
    conventions_doc: AGENTS.md
  dependabot-merge:
    merge_method: squash # squash | merge | rebase
  dependabot-alert-issue:
    minimum_release_age_days: 3 # 任意。解決バージョン公開からこの日数未満は「すぐ着手できない」扱い
    ignore: [] # 任意。Issue も dismiss もしない alert の条件（自由記述）
    dismiss: [] # 任意。却下する alert（ghsa か package[+ecosystem] で限定／reason／comment）
  browser-test:
    environments: # 確認対象の環境（URL・認証・起動コマンド・既定・禁止操作）
      - name: local
        url: http://localhost:5173
        auth: none # none | user（user = ユーザーがログインを実施）
        start: pnpm run dev
        default: true
        forbidden_actions: [] # この環境で実施しない操作。空 = すべて実施可、未定義 = 読み取り専用
```

- `skills.common.conventions_doc`: ブランチ運用・commit 規約を記した**導入先に実在する**ドキュメント。上の `AGENTS.md` は例（盲目コピーしない）。未設定なら標準ドキュメント（`AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` / `CONTRIBUTING.md` 等）を探索し、解決できなければスキルがユーザーに確認する。
- `skills.dependabot-merge.merge_method`: dependabot-merge のマージ方式（既定 `squash`）。
- `skills.dependabot-alert-issue.*`: dependabot-alert-issue が読む特別処理設定（リリース年齢のしきい値・無視・dismiss）。すべて任意。
- `skills.browser-test.*`: browser-test が読む環境・禁止操作の設定。上の値は例（盲目コピーしない）。未設定ならリポジトリ探索とユーザー確認で解決する。`browser-test setup` で対話的に作成・更新できる（詳細はスキルの `references/project-config.md`）。
- `skills.replace-strategy.*`: リプレイス対象（現・新）・DB 接続の環境変数名・成果物方針・意図的差異レジストリ・references（利用者が選ぶ UI ライブラリ／DB 意味論／環境変数の用意方法のドキュメントパス）。
  姉妹スキル（golden-dataset / parity-suite 等）が直接読む共有契約で、`replace-strategy setup` が対話的に作成する（スキーマはスキルの `references/project-config.md`）。golden-dataset / parity-suite は専用キーを持たず、この共有契約だけを読む。
