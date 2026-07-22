---
paths:
  - "skills/*/SKILL.md"
  - ".agents/skills/*/SKILL.md"
applyTo: "skills/*/SKILL.md,.agents/skills/*/SKILL.md"
---

# スキルファイル形式

`skills/*/SKILL.md` を編集する際は Agent Skills 仕様のフォーマットを維持すること:

```yaml
---
name: <skill-name> # 必須: 小文字英数字とハイフンのみ、最大64文字
description: <description> # 必須: スキルの説明とトリガー条件、最大 1024 バイト（UTF-8。日本語はおよそ 340 文字）
argument-hint: "<hint>" # 任意: スラッシュコマンド実行時に表示する引数ヒント
---
```

`argument-hint` は Agent Skills 標準仕様外の拡張フィールド（Claude Code / VS Code が表示に使用。Codex CLI・Copilot CLI は無視するがエラーにはならない）。
値が `[` で始まると YAML の flow sequence と誤解釈されるため引用符で囲む（単・二重どちらでも可）。
