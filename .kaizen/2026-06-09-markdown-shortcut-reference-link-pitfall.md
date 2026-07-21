---
date: 2026-06-09
type: doc
priority: low
status: applied
session: claude-code
---

## 事象

`dependabot-alert-issue` の SKILL.md で、リンク化の意図なく丸括弧の注記に ASCII 角括弧を使い
`（[`AGENTS.md`のページネーション規約]）` と書いていた。これは Markdown の**未定義 shortcut 参照リンク**
（`[text]` に対応する `[text]: URL` 定義が無い）となり、GitHub 上で表示が崩れる。
リポジトリの markdownlint（`default: true`）でも検出されず、PR レビュー（Copilot）で初めて指摘された。
角括弧を外して `（`AGENTS.md`のページネーション規約に従う）` に修正した。

## 根本原因

- なぜ崩れる記法が混入したか? → リンクにしない丸括弧の注記に、強調のつもりで ASCII `[ ]` を使った。
  - なぜ lint で止まらなかったか? → markdownlint の MD052（reference-links-images）は **shortcut 構文
    `[text]` を既定では検査しない**（`shortcut_syntax` の既定が false）。`default: true` でも素通りする。
    - なぜ shortcut_syntax を有効化していないか? → そもそも未定義参照リンクを禁止する方針が無く、
      執筆規約にも lint 設定にも明文化されていなかった。← 根本原因

KEDB 照合: 同種の Markdown 表示崩れの学びは既存 `.kaizen/` に無し（初出）。横断スコープ: 配布スキルの
SKILL.md / references はすべて GitHub 上で表示されるため、同じ素 `[text]` 記法が他スキルにも潜み得る。

## 提案

`type: doc`。執筆規約として「Markdown 本文でリンク化しない注記に ASCII `[text]` を使わない
（必要なら全角『』や丸括弧を使い、リンクにするなら必ず定義/URL を付ける）」を明記する
（`.agents/rules/` か `docs/skill-development.md`）。

決定論チェック（lint 強化）として markdownlint の MD052 `shortcut_syntax: true` 有効化が候補だが、
本調査では `--config` 経由で活性化を確認できず（既知 NG でも 0 error）、また `[bot]` 等
ASCII 角括弧（多くはコードスパン内で安全だが素のものは誤検出し得る）への影響評価が必要。
**有効化方法の確定と誤検出範囲の実測を済ませてから**導入を判断する（未検証のまま lint を強化しない）。
