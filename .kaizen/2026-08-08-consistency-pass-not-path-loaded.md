---
date: 2026-08-08
type: rule
priority: high
status: applied
applied-to: [.agents/rules/skill-consistency-pass.md]
session: claude-code
---

# パス限定できる push 前チェックを docs 側だけに置くと、そのパスを編集しても読まれない

## 事象

Issue #179 で「`verification_commands` が設定に無い／対象パスを含まない場合はその旨を記録する」を
`golden-dataset` / `parity-suite` の複数箇所（設定キー表・実行フロー・`references/seeding-tool.md`）で義務づけたが、
記録先の様式正本である `golden-dataset/assets/verification-template.md` と
`parity-suite/assets/gaps-template.md` に記入節を作らなかった。
記入欄が無いため、テンプレートを埋めるエージェントは記録を黙って落とす。`/code-review` が検出した。

これは `docs/skill-development.md`「push 前の整合パス」項目 5 が既に明文化している内容
（「義務の目的語が『どこかに**書く**』のときは、書く先のテンプレート（`assets/` の成果物様式）に
その節が存在することまで確認する」）で、同根の 3 回目である（Issue #149 → #159 → #179）。

## 根本原因

- なぜ整合パスを実行しなかったか → `skills/**` を編集している間、その手順が一度も文脈に入らなかった
  - なぜ入らなかったか → 手順が `docs/skill-development.md` にあり、`.agents/rules/` と違って
    パス一致による自動ロードの対象外だから（本セッションでも `skills/**` 編集時に注入されたのは
    `.agents/rules/` の 8 件のみで、`docs/` は 1 つも入っていない）
    - なぜ docs 側だけにあるか → 「`skills/**` 編集に閉じた規律＝rule 向き」という配置判断を、
      内容を書いた時点（2026-07-29 / 07-30 の適用）で行わなかった ← 根本原因

過去 2 回の対策はいずれも「`docs/skill-development.md` 項目 5 に追記する」で、
**記述の精度は上げたが到達性は上げていない**。3 回目の再発は文面不足ではなく配送経路の問題である。

KEDB 照合: [[2026-07-29-new-contract-key-declaration-sites]]（`status: applied`）が内容側の正本で、
その追記（2026-07-30）がまさに今回破った項目。applied ノートには追記せず、本ノートで配送経路を扱う。
[[2026-06-09-intra-doc-consistency-pass]] も同じ整合パスの内容を育ててきたが、いずれも置き場所は docs 側のままだった。

## 横断スコープ

同じ構造（パスで絞れるのに `docs/` 側だけにあり自動ロードされない）は
`docs/package-manager.md` の bump 手順（`package.json` / `pnpm-lock.yaml` 編集時に必要）にもある。
`docs/vulnerability-handling.md` はスキル実行時の知識でパスに紐づかないため対象外。

## 提案

**パス限定できる push 前チェックは、正本を `docs/` に置いたまま `.agents/rules/` から入口を張る**
（rule は「いつ・どれを開いて実行するか」だけを持ち、手順を転記しない）。

- `.agents/rules/skill-consistency-pass.md` を新設する（`paths: skills/**`）。内容は入口だけに絞り、
  繰り返し漏れている 2 項目（新設契約は義務づけた記述から逆引きする／義務の目的語が「書く」なら
  記録先テンプレートに節があるか）を名指しし、手順の正本が `docs/skill-development.md` にあることを明記する
- `docs/package-manager.md` にも同型の入口が要るかを、次に依存を bump するときに判定する
