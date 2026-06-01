# multiagent-setup 開発ガイド

このスキル自体を修正・改善する際の手順。

## スキル修正後の検証ループ

`multiagent-setup` を修正した場合は、インストール済みファイルを更新してドキュメントの整合性を確認する:

1. `skills/multiagent-setup/` 内のファイルを修正する
2. 既存のインストール済みファイルを削除して再インストールする:
   ```bash
   rm -rf .agents/skills/multiagent-setup .claude/skills/multiagent-setup
   # --agent codex で .agents/skills/multiagent-setup/ に実体を配置する
   gh skill install ./skills/multiagent-setup multiagent-setup --from-local --agent codex
   ln -s ../../.agents/skills/multiagent-setup .claude/skills/multiagent-setup
   ```
3. `multiagent-setup` スキルを使ってこのリポジトリのドキュメントを再作成する（AGENTS.md → CLAUDE.md → copilot-instructions.md）
4. 生成されたドキュメントを確認し、エージェント固有でない内容が混入していないか検証する
5. 問題があれば 1 に戻る

## 回帰テスト

`skills/multiagent-setup/evals/README.md` の手順を参照。
