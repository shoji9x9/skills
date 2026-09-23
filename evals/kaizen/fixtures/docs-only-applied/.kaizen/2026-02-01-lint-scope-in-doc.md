---
date: 2026-02-01
type: hook
priority: high
status: applied
applied-to: [AGENTS.md]
session: claude-code
---

# 配布テンプレートの拡張子が検査対象から漏れた

## 事象

`.ts` を配布テンプレートに足したが、手元の検査は拾わず CI でだけ落ちた。

## 提案

lint の対象集合を JS/TS ファミリ全体へ広げ、pre-commit の glob も同じ範囲に揃える。
