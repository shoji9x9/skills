---
date: 2026-09-01
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 共有契約ドキュメントを変えたら、その文を根拠に引用する他スキルの evals も横断で grep する

## 事象

Issue #273 で `component_diffs` T の照合キーに `component` を足し、根拠文である
`replace-strategy/references/project-config.md:151`（「1 回の宣言が全 slug・全インスタンスに効く」）を
「`component` に合致する全 slug・全インスタンスに効く」へ更新した。
しかし、その文をそのままアサーションに引用している `replace-strategy` の eval 15 を更新しなかった。

結果、**更新後のドキュメントに沿った正しい回答（要素/glob で限定される）が不合格判定され、
いまは誤りである無条件の主張が合格になる**状態を作った。`/code-review` が検出した。

同じ変更で `parity-diff/references/normalize.md:9`（適用順序 2 の要約行）も旧仕様のまま残していた。

## 根本原因

- なぜ eval の齟齬に気づかなかったか → 変更した概念のキーワードで `evals/` を grep したのは
  `parity-diff` だけで、リポジトリ全体の `skills/*/evals/` を対象にしなかった
  - なぜ `parity-diff` に閉じたか → `docs/skill-development.md`「push 前の整合パス」項目 4 が
    「変更した概念のキーワードで**同スキルの** `evals/` を grep」と定めており、変更対象が
    姉妹スキル共有の契約ドキュメントでも他スキルの evals を見る手順になっていない
    - なぜそう定められているか → 項目 4 は「スキルの挙動・手順を変更したら」という単一スキル前提で書かれ、
      消費側を逆引きする項目 5 は姉妹スキルの同名 `references` と `assets/` のテンプレートを列挙するが、
      **evals を消費側として挙げていない** ← 根本原因（対策可能）

KEDB 照合: `2026-08-08-consistency-pass-not-path-loaded.md`（applied）は整合パスの**到達性**（rule 化）の話で、
本件は到達した整合パスの**スコープの穴**。`2026-08-28-threshold-change-must-update-all-fixtures.md`（pending）は
同一スキル内の fixture / assertion の取りこぼしで、姉妹スキル横断ではない。軸が違うため新規記録。

横断スコープ確認: 同じ穴が「他スキルの `references` が引用する文」にもあるが、そちらは項目 5 が
「姉妹スキルの同名 references」を明示していてカバー済み。`evals/` だけが抜けている。
同一ファイル内の要約行の取りこぼしは項目 5 が「表セル・原則行・要約行」として既に明記しており、
文面ではなく実行の漏れなので本件の対策対象にしない。

## 提案

`docs/skill-development.md`「push 前の整合パス」項目 4 を次の趣旨へ拡張する（配送は既存の
`.agents/rules/skill-consistency-pass.md` が `skills/**` 編集時に担うため、正本の更新だけで届く）。

- 変更したのが**姉妹スキルが読む共有契約**（`replace-strategy/references/project-config.md` 等）や
  他スキルが根拠として引用しうる記述なら、grep の範囲を同スキルに閉じず `skills/*/evals/` 横断にする
- grep する語は変更後の新しい語ではなく**変更前の語彙／既存要素の名前**にする
  （古いアサーションは変更前の語彙で書かれているため、新語では原理的に引っかからない）
- ヒットしたアサーションは、更新後のドキュメントに沿った回答が pass するかを 1 件ずつ読み直す
