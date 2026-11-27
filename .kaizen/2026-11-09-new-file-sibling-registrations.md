---
date: 2026-11-09
type: doc
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 既存と同じ種類のファイルを足すときは、既存のファイル名をリポジトリ全体で grep して、載っている一覧をすべて挙げる

## 事象

Issue #929 で、`parity-suite` に記録の fixture の雛形（`runtime-errors.fixture.template.ts`）を足した。
同じ種類の既存の雛形（`perf-capture.spec.template.ts`）は、カバレッジの除外・CRAP のベースライン・`IS_ARRAY_HOLDERS` に載っていた。
これを確かめずに push したので、CI がカバレッジの閾値で 1 回、CRAP で 1 回失敗した。

2026-11-25 に、Issue #1106 で同じ原因で再発した。
`parity-suite` に、vendor へコピーするスクリプト（`determinism.mjs`・`noise-masks.mjs`）を足した。
同じ種類の既存のスクリプト（`element-shot.mjs`・`trait-capture.mjs`）は、ページで実行する関数を `page/*.page.mjs` に分けている。
その置き場所は、`oxlint.config.ts` の page ファイル用の override と `types/parity-templates.ts` の `declare module` に載っていた。
`mutation-durations.json` と、`SKILL.md`・`locator-mapping.md` のコピーの一覧にも載っていた。
これを確かめずに書いたので、oxlint（関数の行数）・tsc（雛形の import）・mutations-declaration のテストの失敗で 1 つずつ見つけた。
関数を page ファイルへ移し、文書を直す手戻りが起きた。

2026-11-27 に、Issue #1155（PR #1158）で同じ原因で 2 回目の再発をした。
`parity-suite` に、ブラウザでだけ動く `page/scroll-settle.page.mjs` を足した。
同じ種類の既存の page ファイル（`feature-check.page.mjs`）は、カバレッジの除外と CRAP のベースライン（`.config/fallow/crap-baseline.json`）の両方に載っていた。
カバレッジの除外だけを足し、CRAP のベースラインを確かめずに push したので、CI の Unit tests の CRAP の検査が失敗した。

## 根本原因

- なぜ CI で失敗したか: 雛形はブラウザでだけ動くので、ユニットテストのカバレッジが無い。
- なぜ前もって気付かなかったか: 2 つの検査は CI だけで実行され、pre-commit は通った。
- なぜ一覧を見なかったか: 足したファイルの名前で影響を探し、同じ種類の既存のファイルの名前では探さなかった。
- 再発したときも、同じ種類の既存のファイル（`element-shot.mjs`）の名前で grep しなかった。この学びの提案はまだ適用されておらず、作業の時点で読み込まれる場所に無かった。

## 根拠

確信度は medium である。1 回の観測だが、既存の雛形が載る一覧を確かめなかったという原因に絞れている。
`IS_ARRAY_HOLDERS` は oxlint の指摘で、カバレッジの除外と CRAP のベースラインは CI の失敗で、それぞれ後から見つけた。3 つとも既存の雛形の名前で grep すれば先に見つかった。
KEDB 照合では「登録・grep・既存」と「ベースライン・カバレッジ」で照合し、一致は無かった。
2026-11-25 の再発は、この学びの根本原因と読み比べて同じ原因だったので、確信度を high に上げた。KEDB 照合は「雛形・既存」で、このノートに一致した。
2026-11-27 の再発も、既存のファイルの名前で一覧を探さなかったという同じ原因だった。KEDB 照合は「雛形・template.ts」で、このノートに一致した。

## 既存の規約

- 扱い: なし
- 場所: `AGENTS.md`「編集」の「一括で書き換える前に、その文字列を鍵にする他のチェックを挙げる」は書き換えが対象で、ファイルを足す場合は扱っていない
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/` を「同じ種類のファイル」で検索した（配布スキルの同梱物の優先の規則だけが当たった）。
  再発したときに「同じ種類の既存」「既存のファイル名」でも検索し、当たりは無かった

## 食い違い

- 相手: なし
- 判断: なし

## 提案

既存と同じ種類のファイル（雛形・スクリプト・テスト）を足すときは、既存のファイル名をリポジトリ全体で grep し、載っている一覧（除外・ベースライン・登録）に新しいファイルも載せるかを 1 件ずつ決めてから push する。

- 書き始める前にも同じ grep を行い、既存のファイルの分け方（page ファイルへの分割など）に合わせて書く。
- 適用先の候補: `AGENTS.md`「編集」の「一括で書き換える前に」の箇条の隣。
