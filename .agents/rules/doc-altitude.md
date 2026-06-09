---
paths:
  - "AGENTS.md"
  - "CLAUDE.md"
  - "**/SKILL.md"
  - ".agents/rules/**/*.md"
  - "docs/**/*.md"
applyTo: "AGENTS.md,CLAUDE.md,**/SKILL.md,.agents/rules/**/*.md,docs/**/*.md"
---

# ドキュメント記載基準（altitude）

エージェント向けドキュメント（`AGENTS.md` / `CLAUDE.md` / `SKILL.md` / `.agents/rules/` / `docs/`）には、
**エージェントが正しく行動するために必須の情報だけ**を載せる。「網羅」ではなく「行動に必須な分だけ」。

- 網羅性のための説明・**読み手（consumer）のいない節**・他ドキュメントと**重複**する内容は置かない。
- 詳細は参照リンク（`docs/` や `references/`）へ逃がす。
- 重複は二重管理 ＝ drift 源（一方が古くなる）。**single source of truth を 1 箇所に置き、他からは参照**する。
- 追記しようとしたら自問する: 「これはエージェントが把握していないと誤った行動を取るか？」 No なら載せない
  （コンテキスト圧迫を避ける）。

関連: 配置の決定論（どこに置くか）は別軸。本ルールは「そもそも載せるか・どの粒度で載せるか」を扱う。
