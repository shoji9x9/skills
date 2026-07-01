---
paths:
  - "skills/**"
  - ".agents/skills/**"
  - ".claude/skills/**"
applyTo: "skills/**,.agents/skills/**,.claude/skills/**"
---

# スキル編集後の再インストール

## 編集はソース（`skills/<name>/`）に対して行う

スキルの**唯一のソースは `skills/<name>/`**。`.agents/skills/<name>/` とその Claude 用シンボリックリンク
`.claude/skills/<name>` は `reinstall-skill.sh` が生成する**インストール済みコピー**なので直接編集しない。
installed copy を直接編集するとソースが stale になり、`skills-sync`（後述）が commit をブロックする。

- `multiagent-setup` の `references/skills.md` は「`.agents/skills/<name>/SKILL.md` を直接編集」と案内するが、
  これは `skills/` ソースを持たない**配布先（下流）**向けの手順。本リポ（配布元）では必ず `skills/<name>/` を編集する。

## 再インストールで installed copy を同期する

`skills/<name>/` 配下を編集したら、同じ作業の中で必ず再インストールしてインストール済みコピー
（`.agents/skills/<name>/` ＋ `.claude/skills/<name>` シンボリックリンク）を同期する:

```bash
scripts/reinstall-skill.sh <name>
```

- 編集したスキル**すべて**に対して実行する（横展開修正で複数スキルに触れた場合は各スキル分。全スキルは `--all`）
- 同期漏れは lefthook pre-commit / CI の `skills-sync`（`scripts/check-skills-sync.js`）が commit 時にブロックするが、
  編集直後に再インストールしてドッグフード環境を最新に保つこと
- 詳細手順は `docs/skill-development.md`「スキル修正後の再インストール」を参照
