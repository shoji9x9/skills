---
date: 2026-08-11
type: doc
priority: medium
status: applied
applied-to: [AGENTS.md, skills/dependabot-alert-issue/references/pnpm-transitive-update.md]
session: claude-code
---

# 集合を答えにする検査は取りこぼしが真陽性に隠れる。キー列挙は行 grep でなくパーサで取る

## 事象

Issue #189（nanoid high）の更新で float 範囲を確認するため、`pnpm-lock.yaml` の
解決キー（`name@version`）を使い捨ての grep/sed で列挙し before/after を diff した。
出力には本命の nanoid と postcss / vite / rolldown / tinyrainbow の真陽性が並び、
正しく動いているように見えた。

しかし文字クラスが YAML のクォート付きキー（`'@scope/pkg@ver':`）を弾いており、
561 キー中 152 キー（27%、スコープ付き全件）を無言で落としていた。Issue 本文が挙げて
いた `@oxc-project/types` が出力に無いことに気づいて発覚し、抽出をやり直した。
加えて当該 lockfile は 2 ドキュメント構成で、単一ドキュメント読み（`load`）でも
同じく無言の取りこぼしになる。

## 根本原因

- なぜ壊れた抽出器を根拠にしかけたか → 出力に真陽性が含まれ結果が妥当に見えた
  - なぜ取りこぼしに気づかなかったか → 陽性コントロールを取らなかった。網羅列挙では
    欠けた要素が出力に現れないため、出力の目視では原理的に検証できない
    - なぜ取らなかったか → 既存規律（`AGENTS.md`）の発動条件が「該当が無いことを
      根拠にする検査」「非ゼロ出力に真陽性 0 が隠れる」に書かれており、真陽性を
      返しつつ取りこぼす網羅列挙が発動条件として認識されなかった ← 根本原因
- 併発: 構造化フォーマット（YAML）を行単位の正規表現で解析した。クォート・複数
  ドキュメントという構文差が正規表現の想定外だった

KEDB 照合: [[2026-08-03-detector-nonzero-hits-not-proof]]・
[[2026-08-10-diff-scope-check-by-hunk-not-line-grep]]（ともに applied）と同型の 3 度目。
前 2 件は「陰性を根拠にする検査」「非ゼロだが真陽性ゼロ」を扱い、本件は
「真陽性はあるが集合が不完全」という派生形。applied のため追記せず恒久側を強化する。

横断スコープ: 同じ穴は集合を答えにする使い捨て検査全般（float 範囲確認・依存経路の
列挙・一覧の突き合わせ）、特に構造化フォーマットを行 grep で列挙する箇所にある。
リポジトリ内の恒久スクリプトは lockfile を解析していない（確認済み）が、配布スキル
`dependabot-alert-issue` の `references/pnpm-transitive-update.md` 手順 6 は
「`git diff pnpm-lock.yaml` の base `name@version` 比較」と取り方を規定しておらず、
下流でも同じ誤りが起きる。

## 提案

集合を列挙して突き合わせる検査は、取りこぼしが真陽性に隠れて見えないため、既知要素の
陽性コントロールと総数の突き合わせを取ってから根拠にする。

- `AGENTS.md` の陽性コントロール行の発動条件を「該当が無いことを根拠にする検査」から
  「集合を答えにする検査（網羅列挙・突き合わせ）」まで広げる。件数が非ゼロでも、
  真陽性が混ざっていても、検出能力の証拠にはならない
- 構造化フォーマット（YAML / JSON / TOML）のキー列挙は行 grep でなく実パーサで行う。
  `pnpm-lock.yaml` は複数ドキュメントのため `loadAll` を使う（`load` は無言で
  1 ドキュメント目だけを読む）
- 反映先: `AGENTS.md` ワークフロー節の陽性コントロール行、および
  `skills/dependabot-alert-issue/references/pnpm-transitive-update.md` 手順 6
