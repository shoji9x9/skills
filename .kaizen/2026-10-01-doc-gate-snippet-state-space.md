---
date: 2026-10-01
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手順書に埋め込むチェックのシェル断片も状態空間を先に列挙する

## 事象

PR #541 で parity-diff の preflight.md に「新側の版の一致」の照合スクリプト（撮る前に止めるチェック）を書いた。
初版は 7 状態だけ実測して出し、Copilot レビューが 1 周ごとに別の抜けを 1 件ずつ見つけた。見つかった順に次のとおり。

1. 一括再検証の照合相手（commits.after）
2. 停止分岐が exit 0
3. 固定 URL target の commit_check
4. commit_check の出力先が無い
5. パイプで終了コードが隠れる
6. SHA 形式未検査・commit_check 無しの配信型

/pr-finalize-loop の上限 5 周を使い切り、2 回目のループが要った。途中、commit_check を
「url_command の target だけのキー」と消費側の文書（capture-new.md）から断定して見送り、定義の原本
（replace-strategy の project-config.md）で誤りと分かって訂正した。

## 根本原因

- なぜ抜けが 1 件ずつ出たか → 入力の軸（target の種類 × 照合相手の出所 × コマンドの成否・出力形式）を書く前に列挙せず、思いついた状態だけを実測した
- なぜ列挙しなかったか → `.agents/rules/state-space-and-mutation-proof.md` は paths が `scripts/**` と `skills/*/scripts/**` に限られる。
  そのため、`skills/*/references/**` の Markdown に埋めたシェル断片の編集では読み込まれない
- なぜ断片を対象外にしていたか → チェックを「スクリプトファイル」として扱った。手順書の中の実行可能な断片も、判定できないときは失敗にするという同じ取り決めに従うことを想定していなかった
- 付随: 設定キーの適用範囲を、定義の原本ではなく消費側の 1 行から推した

## 提案

手順書（references/*.md）に停止・合否を決めるシェル断片を書くときは、書く前に入力の軸（対象の種類・比較相手の出所・外部コマンドの成否と出力形式）を表にし、各軸の「読めない」を含めて全状態を実測してから出す。

- state-space-and-mutation-proof.md の paths に skills/*/references/** を足す（または同ルールに「手順書のチェック断片も対象」と明記する）
- 設定キーの適用範囲（どの target が持つか等）を述べる前に、定義の原本（project-config.md 等）を読む。消費側の文書の記述から断定しない
- KEDB: 2026-09-21-check-written-to-fit-the-fixture（形式の原本から起こす）と同系
