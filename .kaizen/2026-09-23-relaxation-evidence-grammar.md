---
date: 2026-09-23
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 緩和の根拠に使う構文は、根拠そのものの文法から列挙する

## 事象

auto-wait-check（#412）で「Playwright 以外と確定」＝判定不能から外す根拠を新設した。
束縛の形（引数・分割・再代入…）は文法から列挙したが、根拠の型注釈は「Page / Locator 以外の識別子」の
1 トークンとして扱い、`pw.Locator` / `Readonly<Locator>` / `typeof page` / `import(…).Page` / `Frame` /
`type Row = Locator` を「確定」に数えていた。/code-review で検出し手戻り。
同じ PR のゲート（#423）でも、heredoc の本文を読むシェルの列挙から `.` が漏れた。

## 根本原因

- なぜ穴が開いた? 根拠（型注釈）を単一の値として扱った
- なぜ? 状態空間を「判定される名前」の軸だけで引き、緩和を許す「根拠の式」を軸にしなかった
- なぜ? `.agents/rules/state-space-and-mutation-proof.md` の §2（文法から列挙）と §3（緩和は閉じた集合）が別々に書かれ、
  「緩和の根拠も解析対象であり文法がある」という結合が明文化されていない ← 根本原因

KEDB: `.kaizen/archive/2026-09-12-parser-state-space-from-grammar.md`（applied）と同根の再発。

## 提案

緩和（免除・対象外・確定）の根拠に構文を使うときは、根拠そのものの文法（修飾名・generic・演算子・別名・同族の型や同義コマンド）を列挙し、完全一致で読める最小形だけを根拠にして残りを fail-closed に倒す。

- 適用先: `.agents/rules/state-space-and-mutation-proof.md` §3「緩和経路を置くなら…」に 1 項目追記
- 横断: 同じ PR の `BUILTIN_NON_RECEIVERS` / 委譲検出の語彙も同じ観点で点検済み
