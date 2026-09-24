---
date: 2026-09-23
type: rule
priority: high
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

2026-09-24（#455、再発）: eval 判定器に「cd した後の相対パスを cwd で解決する」緩和を新設した。
根拠の構文（`&&` リスト・素の `cd`・`bash -c`）は列挙したが、`bash -c "…" && cd "/tmp"`（閉じ引用符が行末に来る別構文）を子シェル扱いし、
`eval "cd /tmp"`（引用符直後の `cd`）を移動と見なさなかった。`/code-review --fix` で検出し手戻り（どちらも「読んだ」を捏造する向き）。
自分の変異実証でも、4 変異が下流のガードで偶然落ちるだけで生存した。

## 根本原因

- なぜ穴が開いた? 根拠（型注釈）を単一の値として扱った
- なぜ? 状態空間を「判定される名前」の軸だけで引き、緩和を許す「根拠の式」を軸にしなかった
- なぜ? `.agents/rules/state-space-and-mutation-proof.md` の §2（文法から列挙）と §3（緩和は閉じた集合）が別々に書かれ、
  「緩和の根拠も解析対象であり文法がある」という結合が明文化されていない ← 根本原因

KEDB: `.kaizen/archive/2026-09-12-parser-state-space-from-grammar.md`（applied）と同根の再発。

- #455 で同根の 3 回目。シェルの根拠を「自分が想定した形」の字句で判定し、引用符・連結・子シェルの境界という文法の軸を先に表にしなかった
- 散文ルールだけでは再発が止まっていない。適用時に仕組み側（状態空間の表をテストの `test.each` として残す等）を検討する

## 提案

緩和（免除・対象外・確定）の根拠に構文を使うときは、根拠そのものの文法（修飾名・generic・演算子・別名・同族の型や同義コマンド）を列挙し、完全一致で読める最小形だけを根拠にして残りを fail-closed に倒す。

- 適用先: `.agents/rules/state-space-and-mutation-proof.md` §3「緩和経路を置くなら…」に 1 項目追記
- 横断: 同じ PR の `BUILTIN_NON_RECEIVERS` / 委譲検出の語彙も同じ観点で点検済み
