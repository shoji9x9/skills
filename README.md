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

## インストール

```bash
gh skill install shoji9x9/skills multiagent-setup
gh skill install shoji9x9/skills kaizen
gh skill install shoji9x9/skills issue-create
gh skill install shoji9x9/skills issue-start
gh skill install shoji9x9/skills pr-review-handle
gh skill install shoji9x9/skills dependabot-merge
```

## スキルの更新

```bash
gh skill update --all
```

## スキルの設定

一部のスキル（issue-start / pr-review-handle / dependabot-merge）は、インストール先プロジェクトの設定を `.config/skills/<owner>/<repo>.yml` から読む。
`<owner>/<repo>` は**配布元（publisher）の owner/repo で固定**であり、導入先のリポジトリ名ではない（本リポジトリ配布物は常に `.config/skills/shoji9x9/skills.yml`）。
設定はスキル実行時に**非破壊で自動作成・追記**され（既存のキー・値・コメントは変更しない）、skill ディレクトリ外にあるため `gh skill update` でも保持される。

```yaml
version: 1
skills:
  common:
    # 導入先に実在する規約ドキュメントを指定（例: AGENTS.md / CLAUDE.md / CONTRIBUTING.md）
    conventions_doc: AGENTS.md
  dependabot-merge:
    merge_method: squash # squash | merge | rebase
```

- `skills.common.conventions_doc`: ブランチ運用・commit 規約を記した**導入先に実在する**ドキュメント。上の `AGENTS.md` は例（盲目コピーしない）。未設定なら標準ドキュメント（`AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` / `CONTRIBUTING.md` 等）を探索し、解決できなければスキルがユーザーに確認する。
- `skills.dependabot-merge.merge_method`: dependabot-merge のマージ方式（既定 `squash`）。
