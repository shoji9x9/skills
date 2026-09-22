---
date: 2026-09-22
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 検査対象の解決を本番の探索順に委ね、正本ではなくインストール済みコピーを測った

## 事象

Issue #420 で、2 つのワークフローに重複していた追跡 Issue の照会を配布スキル同梱の
`skills/kaizen/scripts/tracking-issue-lib.sh` へ括り出した。ステップの実行テストは
`TRACKING_LIB` の宣言（`${{ steps.locate.outputs.lib }}`）を**本番と同じ探索ステップを実際に走らせて**
解決していた。その探索順の先頭は `.claude/skills/kaizen/scripts` ——
テストは正本ではなく**インストール済みコピー**を source していた。

正本へ当てた変異（`query_tracking_issues` を終了コードを捨てる形へ戻す）で、`outdated.yml` 側の
fail-closed テストは赤くなったのに `kaizen-schedule.yml` 側は緑のまま。「kaizen 側の assertion が
効いていない」と読みかけたが、実際は**測っていたファイルが違った**。正本を直接 source する最小プローブで
再現し、正本を読む構成なら落ちることを確認してから直した。

## 根本原因

- なぜ kaizen 側だけ緑だったか? → 実行テストが正本ではなくインストール済みコピーを source していた
  - なぜコピーだったか? → 対象パスの解決を**本番と同じ探索**へ委ね、その探索順の先頭がコピーだった
    - なぜ委ねたか? → 「宣言をハードコードすると、宣言を落とす変異で緑のまま通る」を避けるため解決を宣言側へ寄せた。
      **宣言の検証（どこを指すか）と挙動の測定（何を測るか）を同じ 1 本のパスで兼ねた**のが誤り ← 根本原因（対策可能）

コピーは `scripts/check-skills-sync.js` がバイト一致で見張るので「同期されていれば同じ」は普段は成立する。
破れるのは**正本を編集してから再インストールするまでの窓**で、変異実証はまさにその窓を作る（正本だけを書き換えて測る）。

## KEDB 照合

[[2026-09-21-check-written-to-fit-the-fixture]]（`status: pending` / high）と同じ族——「検査が本物の対象に
当たっていないのに緑」。あちらは対象の**形**（fixture のスキーマ）、本件は対象の**場所**（正本かコピーか）。
[[2026-09-19-mutation-proof-judged-by-exit-code]]（applied）は「変異が当たらない偽の生存」で、本件は
「変異は当たったが測る対象が別ファイル」——同じ偽の生存の別経路。applied なので追記せず恒久側で扱う。

横断スコープ: `scripts/*.test.js` のうち実行対象のパスを実行時の探索で解決していたのはこの 1 件だけだった
（他は `skills/<name>/scripts/...` を名指し。`.claude` / `.agents` 配下への言及は合成 fixture の文字列のみ）。実測で確認した。

## 提案

同梱物の実行テストは正本を名指しし、宣言・探索の検証は別の assertion に分ける（1 本のパスで兼ねない）。

- 挙動の測定は正本（`skills/<name>/...`）を渡す。インストール済みコピーを実行対象にしない
- 宣言が実在の対象を指すことは別に検査する（探索ステップを走らせる・宣言値の実在を確かめる）
- コピーとの一致は `scripts/check-skills-sync.js` に任せる（測定と同期検査を混ぜない）
- 反映先: `.agents/rules/state-space-and-mutation-proof.md`（変異実証の節）か
  `.agents/rules/skill-reinstall.md`（正本とコピーの関係を述べている側）
