---
date: 2026-09-01
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 照合・集計の状態空間には「値」だけでなく「キーの材料」を入れる

## 事象

Issue #274 で `parity-diff` に fail-closed の収束ゲート `scripts/coverage-check.mjs` を新設し、
被覆表のセル値（`present` / `absent` / `unmeasured`）・行の欠落・`evidence` 空・`covered_by` 空について
陽性／陰性コントロールを 16 件書いて全て green にした。

`/code-review` が、その状態空間の外にある fail-open を検出した。列挙側（`components[].items[]` /
`instances[]`）の要素に `id` が無いと `String(c.id)` が `"undefined"` へ潰れ、**全期待セルが同一キーに収束**する。
そこへ `component` だけを持つセル行が 1 件あれば `cells:2, present:2, unmeasured:0, problems:[]` で exit 0——
fail-closed を目的に作ったゲートが、1 件のデータで全件を満たして素通りする。`items` に同じ id が 2 つある場合も
期待セルが二重に数えられ、1 行で両方が `present` になった。

## 根本原因

1. なぜテストが捕まえなかったか → 状態空間の列挙を「セルが取りうる値」と「行の有無」に閉じ、
   **突き合わせに使うキーの材料**（`component` / `item` / `instance` の id）を状態空間に入れなかった。
2. なぜキーの材料が漏れたか → 「何を測るか（値）」は仕様（`coverage.md`）に列挙されているが、
   「何で突き合わせるか（キー）」は実装の内部事情で仕様に現れない。仕様から assertion を逆引きする手順では構造的に落ちる。
3. なぜ既知の故障クラスを参照できなかったか → **同じ故障クラスを 1 日前に同じスキルで直している**
   （Issue #273 / commit 2198c63: `component_diffs` の照合キー欠落が「どの要素にも合う」に化ける。
   その回帰テスト `scripts/diff-normalize-component-match.test.js` は本セッションで読んでいた）。
   KEDB 照合は「学びの抽出時」の手順であって、**実装の設計時に既知故障クラスを引く手順が無い**。← 根本原因

KEDB 照合（`照合` / `キー` / `fail-closed` × `parity-diff`）では
[[2026-07-30-negative-result-checks-need-positive-control]]（0 件を合格根拠にしない）と
[[2026-08-30-new-state-branches-need-fixtures]]（新設分岐の状態空間）が近いが、どちらも別軸——
前者は「検査が動いていない」、後者は「自分が足した分岐」を扱い、
本件の「キーが潰れて別対象が同一視される」は覆っていない。

横断スコープ: `trait-compare.mjs:139` の `new Map(entries.map((e) => [e.name, e]))` は
`name` 欠落の複数エントリが 1 キーへ潰れて後勝ちになる（同型）。
`json-normalize-diff.mjs` のドット記法パス解決、`component_diff_exception_causes[].id` ↔ `cause` の参照、
`replace-strategy status` の slug × target 集計も同じ構造を持つ。

## 提案

照合・集計・突き合わせを行うコードは、判定に使う**値**の状態空間だけでなく、
**キーの材料**（id・照合キー・論理名）の欠落・空文字・重複・型崩れも状態空間に入れ、
「キーが潰れて 1 件のデータが全件を満たさないこと」を陰性コントロールで実測する。
キーを文字列化して索引にする実装（`String(x)` / テンプレートリテラル / `Map` の key）は、
欠落が `"undefined"` という**有効なキー**に化けるため、欠落を先に弾いてから索引に入れる。

加えて、既知故障クラスの参照点を抽出時だけでなく**実装の設計時**にも置く——
同種の照合・集計を書く前に、そのスキル・スクリプトの直近の修正（KEDB と git 履歴）を引き、
同じ故障クラスの陰性コントロールを最初から移植する。
