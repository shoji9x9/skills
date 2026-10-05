---
paths:
  - "skills/*/SKILL.md"
  - ".agents/skills/*/SKILL.md"
  - ".claude/skills/*/SKILL.md"
applyTo: "skills/*/SKILL.md,.agents/skills/*/SKILL.md,.claude/skills/*/SKILL.md"
---

# スキルファイル形式

`skills/*/SKILL.md` を編集するときは、frontmatter を Agent Skills 仕様の形に保つ。

```yaml
---
name: <skill-name> # 必須: 小文字英数字とハイフンのみ、最大64文字
description: <description> # 必須: スキルの説明とトリガー条件、最大 1024 バイト（UTF-8。日本語はおよそ 340 文字）
argument-hint: "<hint>" # 任意: スラッシュコマンド実行時に表示する引数ヒント
license: MIT # 任意（Agent Skills 仕様のフィールド）: 配布スキルは全て MIT
---
```

`argument-hint` は Agent Skills 仕様に無い拡張フィールドである。Claude Code と VS Code は表示に使い、Codex CLI と Copilot CLI は読まないがエラーにもしない。
値が `[` で始まると、YAML はリスト（flow sequence）として読む。そのため値を引用符で囲む。単引用符でも二重引用符でもよい。
