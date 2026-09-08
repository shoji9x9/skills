---
date: 2026-09-09
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# rule の多エージェント配線（symlink 3 点）に検査が無い

## 事象

`.agents/rules/eval-run-scope.md` を新規作成し、`AGENTS.md` の参照ルールガイドに
「`skills/*/evals/**` 編集時に適用」と記載した。しかし `.claude/rules/<name>.md` と
`.github/instructions/<name>.instructions.md` の symlink を作らなかったため、
**Claude Code と Copilot では自動適用されない**状態だった。
ドキュメント上は適用されることになっており、**成功した作業と見分けが付かない**。
コードレビューで指摘されるまで気付かなかった。

## 根本原因

1. なぜ symlink を作らなかったか: 既存 rule ファイルの中身（frontmatter の `paths` / `applyTo`）だけを真似て、
   `.agents/rules/` にファイルを置けば完成だと判断した。
2. なぜそう判断したか: rule 追加の完了条件を `multiagent-setup` の手順で確認せず、既存の成果物の見た目から逆算した。
3. なぜ確認を省いても進めたか: **rule 追加の完了を検査する決定論的な仕組みが無い**。
   `scripts/check-skills-sync.js` は `skills/` ↔ `.agents/skills/` の同期だけを見ており、
   `.agents/rules/` ↔ `.claude/rules/` ↔ `.github/instructions/` の parity は lefthook にも CI にも存在しない。
   ← 根本原因（対策可能）

KEDB を `symlink`・`.agents/rules`・`rule`・`.claude/rules` で照合したところ、
`2026-06-10-skill-edit-reinstall-rule.md`（applied）が同型だった——スキルの installed copy 同期漏れも
同じ「配線漏れが成功と見分けられない」故障で、そちらは `check-skills-sync.js` という機構で解決済み。
**rule だけが同じ機構を持たないまま残っている。**

## 横断スコープ

- `.agents/skills/` ↔ `.claude/skills/` の symlink: `reinstall-skill.sh` が作り `check-skills-sync.js` が検査する（穴なし）
- `.agents/rules/` ↔ `.claude/rules/` ↔ `.github/instructions/`: **どちらも無い（この穴）**
- 現時点の実測では 13 rule すべてが両 symlink を持つ（レビューでの修正後）。
  つまり規約自体は守られてきたが、守られていることを保証しているのは人の注意だけ

## 提案

`scripts/check-rule-symlinks.js` を新設し、lefthook pre-commit と CI の `Lint` ジョブへ入れる。

- `.agents/rules/*.md` それぞれについて、`.claude/rules/<name>.md` と
  `.github/instructions/<name>.instructions.md` が**存在し・symlink であり・正しい相対先を指す**ことを検査する
- 逆向き（正本の無い孤児 symlink）も検出する
- **対象 0 件を成功に倒さない**。走査した rule 数を絶対パス付きで出力し、0 件なら fail する
- 判定行を無効化する変異で赤くなることを実証してから green を根拠にする
  （`.agents/rules/state-space-and-mutation-proof.md`）
