---
date: 2026-09-30
type: skill
priority: medium
status: pending
session: claude-code
---

# 作業ツリー外に置けと指示された入力を扱うときも、node はリポジトリの cwd から起動する

## 事象

issue-start の受け入れ条件の突き合わせで、`issue.json` 等を指示どおり作業ツリー外（`$CLAUDE_JOB_DIR/tmp/acc`）に置き、
そのディレクトリへ cd して `acceptance-check.mjs` を起動したところ
`mise ERROR No version is set for shim: node` で起動自体が落ちた（1 往復の手戻り）。

## 根本原因

- なぜ落ちたか → `node` は mise の shim で、cwd がプロジェクト外だとバージョンを決められない
- なぜ cd したか → `acceptance.md` が入力を「作業ツリーの外の一時ディレクトリに置く」と指示し、
  コマンド例が相対の `<issue.json>` なので、置き場へ cd して相対で渡す形を取った
- なぜ既存の規律で防げなかったか → `AGENTS.md`「ツール起動」に shim の cwd 依存は書いてあるが（[[2026-09-03-mise-shim-resolves-by-cwd]] applied）、
  置き場を外に指定する手順（`acceptance.md`）側に「cwd はリポジトリに保ち、入力は絶対パスで渡す」が無い ← 根本原因

## KEDB 照合

[[2026-09-03-mise-shim-resolves-by-cwd]]（applied）の再発。applied には追記しない。

## 提案

issue-start の `references/acceptance.md` 手順 1・5 に、一時ディレクトリの入力は絶対パスで渡しコマンドはリポジトリの cwd から起動すると 1 行足す。

- 横断: 「作業ツリーの外に置く」と指示する他の手順（parity 系・pr-finalize-loop の一時ファイル）も同じ形か確認する
