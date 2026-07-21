---
date: 2026-07-21
type: doc
priority: medium
status: pending
session: claude-code
---

# markdownlint MD013（非 strict）は 200 桁超に半角スペースがある行だけを弾く

## 事象

skills/** の日本語 SKILL.md や README/AGENTS を編集中、既存の 400 字級の日本語長行は
markdownlint を通るのに、自分が追記した行だけが MD013（line-length 200）で fail した。
一見して「なぜ一部の長行だけ落ちるのか」が分からず、原因特定に数手かかった。

## 根本原因

本リポの markdownlint 設定は MD013 が `line_length: 200` かつ
`code_blocks: false` / `tables: false` / `headings: false` の「非 strict」運用。
非 strict の MD013 は行長超過だけでは fail させず、**設定長を超えた位置に半角スペース
（＝改行可能点）がある行**だけを fail させる。日本語は分かち書きしないため純 CJK の長行は
200 桁超でもスペースが無く通過するが、英語のツール名・設定キー（"Claude Code" /
"@codex review" / "review_tool" 等）を長行に足すと 200 桁超にスペースが入り fail する。
この挙動が未明文化で、「長行＝一律 fail」という誤った直感で原因を見誤った。

## 提案

markdownlint の非 strict MD013 は 200 桁超に半角スペースがある行だけを弾く。日本語ドキュメント
（skills/** / README / AGENTS 等）に英数字＋スペースを追記したときは、行を 200 桁以内に収めるか、
200 桁超に半角スペースが残らないよう折り返す（純 CJK なら 200 桁超でも通る）。既存の長い日本語行が
通っているのは違反の見逃しではなく非 strict 仕様。恒久化するなら AGENTS.md のリント節に一行追記する。
