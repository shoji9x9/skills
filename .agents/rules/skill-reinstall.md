---
paths:
  - "skills/**"
  - ".agents/skills/**"
  - ".claude/skills/**"
applyTo: "skills/**,.agents/skills/**,.claude/skills/**"
---

# スキル編集後の再インストール

## 編集はソース（`skills/<name>/`）に対して行う

スキルのソースは `skills/<name>/` だけである。
`.agents/skills/<name>/` と Claude Code 用のシンボリックリンク `.claude/skills/<name>` は、`reinstall-skill.sh` が作るインストール済みのコピーなので、直接編集しない。
コピーを直接編集すると、ソースが古いまま残り、後述の `skills-sync` が commit を止める。

- `multiagent-setup` の `references/skills.md` は「`.agents/skills/<name>/SKILL.md` を直接編集」と案内している。
  これは `skills/` のソースを持たない配布先の手順である。配布元のこのリポジトリでは、`skills/<name>/` を編集する。

## 再インストールでインストール済みのコピーを同期する

`skills/<name>/` の中を編集したら、同じ作業の中で再インストールし、インストール済みのコピー（`.agents/skills/<name>/` と `.claude/skills/<name>` のシンボリックリンク）を同期する。

```bash
scripts/tools/reinstall-skill.sh <name>
```

- 編集したスキルごとに実行する。複数のスキルを直したら、それぞれについて実行する。全スキルを同期するなら `--all` を付ける。
- 同期を忘れると、lefthook の pre-commit と CI の `skills-sync`（`scripts/gates/check-skills-sync.js`）が commit を止める。
  それでも、手元で使うスキルを最新に保つため、編集の直後に再インストールする。
- 詳しい手順は `docs/skill-development.md` の「スキル修正後の再インストール」にある。
