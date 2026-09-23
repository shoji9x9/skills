---
date: 2026-09-23
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 後段の検査ツールを前段のゲートに流用し、その時点で揃わない入力を列挙しなかった

## 事象

Issue #446 で parity-component build の前提判定に「behavior-compare.mjs が落とす」と書いた。
前提判定の時点では突き合わせ表がまだ無く、ツールは常に exit 1（comparison-missing）になるため
終了コードでは判定できず、見る finding も behavior-baseline-* だけで
unreachable-declaration-invalid を取りこぼしていた（/code-review が検出）。
同じ変更で前提を足したため build 系 eval fixture 3 件が前提で止まる形になり、
整合パスの終盤まで気付かなかった。

## 根本原因

- なぜ誤った? 完了判定用に設計したツールを前提判定へ流用した
- なぜ気付かない? 工程ごとに「その時点で存在する入力」を列挙しなかった
- なぜ列挙しない? state-space ルールは入力の値の状態空間を対象にし、
  「呼ばれる工程（時点）」と「新設した前提を既存 fixture が通るか」を軸に持たない

## 提案

検査ツールを複数の工程（前提判定・完了判定など）から呼ぶときは、工程ごとにその時点で揃う入力を列挙し、判定を終了コードではなく「許容する finding の集合」で書く。前提を新設したら、その前提を前段に持つ既存の eval fixture を同じ変更で列挙して通ることを確かめる。

- 適用先候補: `.agents/rules/state-space-and-mutation-proof.md` §3（呼ばれる工程を軸に足す）、§4（新設の前段ゲート→既存 fixture）
- 横断: `component-comparison-check.mjs` も `parity-replace` の複数工程から呼ばれるので同型がないか確認する
