---
date: 2026-09-17
type: doc
priority: low
status: pending
applied-to: []
session: claude-code
---

# 呼び出す識別子（npm スクリプト名・ツール名）を正本を見ずに記憶から組み立てて 2 回失敗した

## 事象

同じセッションで、存在しない識別子を呼んで 2 回失敗した。

- `pnpm run format:json:check` → `ERR_PNPM_NO_SCRIPT`（`package.json` の `scripts` は
  `format:js` / `format:js:check` / `lint:js` / `test` の 4 つで、JSON 用のスクリプトは無い。
  JSON の整形は lefthook が `oxfmt` を直接呼ぶ構成だった）
- `AskUserQeustion` → `No such tool available`（正しくは `AskUserQuestion`）

どちらも 1 回の再試行で回復したが、`package.json` を 1 度読めば前者は起きず、
ツール名を写せば後者も起きない。

## 根本原因

1. なぜ存在しない識別子を呼んだか → 「JS 用があるなら JSON 用もあるはず」という対称性の推測と、
   タイプした綴りをその場で確認しなかったため。
2. なぜ確認しなかったか → 識別子が短く、記憶で足りる種類のものだと扱った（不透明 ID や SHA と違い、
   意味のある単語なので verify の対象と認識されなかった）。
3. なぜその扱いになったか → 基底ドキュメントの規律は「opaque ID・完全 SHA・長い prompt は
   表示結果から手で転記・補完しない」と**不透明な値**に限定しており、
   **名前で呼ぶ識別子（スクリプト名・ツール名・タスク名）が対象に入っていない** ← 根本原因

## 提案

呼び出す識別子（npm スクリプト名・ツール名・タスク名）は、意味のある単語でも記憶から組み立てず、正本（`package.json` の `scripts`・利用可能なツール一覧）を読んで写してから呼ぶ。

- 反映先: 基底ドキュメント（`AGENTS.md`）の「opaque ID・完全 SHA・長い prompt は…機械取得する」の項に、
  名前で呼ぶ識別子も対象であることを 1 文追加する（別項を新設しない）
- 横断スコープ: 同じ推測は「あるはずの隣接コマンド」（`lint:md` / `format:yaml` 等）や
  スキル名・スラッシュコマンド名でも起きるので、規律は識別子一般に書く
- KEDB 照合: 該当なし（`推測` × `package.json` / `存在しない` × `Bash` で走査。
  近いのは `2026-09-11-optional-artifact-check-must-not-decide-exit-code.md` だが別事象）
