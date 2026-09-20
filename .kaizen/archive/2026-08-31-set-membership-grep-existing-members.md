---
date: 2026-08-31
type: doc
priority: medium
status: applied
applied-to: ["docs/skill-development.md"]
session: claude-code
---

# 集合に要素を足したら、既存要素名で grep して古い列挙を洗う

## 事象

`references.db_semantics` を移植時の点検表として定義し、読み手に `parity-replace` を足す横断変更で、
同じ集合を**変更前の語彙で再掲していた箇所**が 4 件更新漏れになり、code-review で初めて発覚した。

- `parity-replace/SKILL.md` 手順 7: レビュー役へ渡すものが「差分のみ」のまま（`references/adversarial-review.md` の渡すもの表と乖離）
- `references/adversarial-review.md` の原則行 / `assets/review-template.md` のコメント: `may_change` が落ちた縮約
- `replace-strategy/references/project-config.md` の YAML コメント: 読み手の列挙から `current-environment-bootstrap` が欠落（同ファイルのキー表には有る）

新語（`db_semantics` / 点検表）で grep しても、これらは**新語を含まないため 1 件も引っかからなかった**。

## 根本原因

1. なぜ漏れたか → 変更点のキーワード（新しく足した語）で grep して確認を終えた。
2. なぜ足りると考えたか → 「契約を足す＝新語が増える」と捉え、既存の集合を要約・短縮して再掲している箇所（表セル・原則行・テンプレのコメント）が更新対象だと認識していなかった。
3. なぜ認識できなかったか → `docs/skill-development.md`「push 前の整合パス」項目 5 は「既存の条件リストへ項目を追加したときも grep は空振る」と現象は書いているが、**代わりに何で grep するか**という機械的な手掛かりが無く、「義務づけた記述から逆引き」という判断依存の指示に留まっていた ← 根本原因

KEDB 照合: `2026-06-09-intra-doc-consistency-pass.md`（`status: applied`）と同根の再発。applied ノートへは追記せず恒久側（`docs/skill-development.md`）を更新する規定に従った。
横断スコープ: 同じ空振りは `.agents/rules/skill-consistency-pass.md` が入口とする全ての配布スキル変更で起きうる。要素名 grep はどの集合（設定キーの読み手・渡すもの・条件リスト・プロパティ集合）にも同じ形で当たる。

## 提案

集合（渡すもの・読み手・条件・プロパティ）に要素を足したら、**足した語ではなく「既存要素の名前」で grep する**。
古い列挙は変更前の語彙で書かれているため既存要素名を必ず含み、新語 grep では原理的に引っかからない。
表・原則行・テンプレのコメント・YAML コメントなど、要約・短縮形で同じ集合を再掲している箇所をすべて洗ってから push する。
