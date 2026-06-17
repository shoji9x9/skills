---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# スキル編集後の再インストール

`skills/<name>/` 配下を編集したら、同じ作業の中で必ず再インストールしてインストール済みコピー
（`.agents/skills/<name>/` ＋ `.claude/skills/<name>` シンボリックリンク）を同期する:

```bash
scripts/reinstall-skill.sh <name>
```

- 編集したスキル**すべて**に対して実行する（横展開修正で複数スキルに触れた場合は各スキル分。全スキルは `--all`）
- 同期漏れは lefthook pre-commit / CI の `skills-sync`（`scripts/check-skills-sync.js`）が commit 時にブロックするが、
  編集直後に再インストールしてドッグフード環境を最新に保つこと
- 詳細手順は `docs/skill-development.md`「スキル修正後の再インストール」を参照
