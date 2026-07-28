---
date: 2026-07-28
type: doc
priority: medium
status: applied
session: claude-code
---

# 階層マージされる設定は供給元を列挙してから切り分ける

## 事象

pnpm bump（Issue #127）の検証で `mise install --locked` が `jq@1.8.2 is not in the lockfile` で失敗した。
jq はリポジトリの `mise.toml` に無く `~/.config/mise/config.toml`（ユーザーグローバル）由来で、
CI（mise-action）にはグローバル config が無いため CI とは無関係だった。切り分けの決め手は `mise config ls`
だったが、先に試した `MISE_GLOBAL_CONFIG_FILE=/dev/null` は効かず（同じエラー）判断材料にならなかった。

さらに解消のため `mise lock --global` をプロジェクト内で実行したところ、グローバルの `python@3.14.5` が
プロジェクトの `python@3.14.6` に隠れて lockfile に入らず、`$HOME` での再検証まで取りこぼしに気づけなかった。

## 根本原因

- なぜ失敗した? → `mise install --locked` は cwd で有効な**全 config のマージ結果**を対象にし、
  リポジトリ外のグローバル config のツールまで lockfile に要求するため。
  - なぜ切り分けに手間取った? → 「どの設定階層がどのツールを供給しているか」を先に列挙せず、
    環境変数で無効化する当て推量から入ったため（その env var は効かなかった）。
    - なぜ当て推量から入った? → 階層マージされる設定を扱うツールの検証手順（供給元の列挙 →
      階層の切り分け）が明文化されていないため ← 根本原因
- 取りこぼしの原因は同じ構造の裏返し: 下位（グローバル）スコープ対象の一括操作も**マージ後に見える
  ツール**を対象にするため、上位（プロジェクト）に同名ツールがあると下位側が隠れる。

横断スコープ: mise に限らず階層マージされる設定全般（`git config` の global/local、npm/pnpm の
config、`.editorconfig` 等）で同型。ローカルの「CI 相当」検証が CI と乖離する経路にもなる。

## 提案

階層マージされる設定（mise / git / npm 等）に依存するツールの検証は、まず有効な設定ソースを列挙して
（`mise config ls` 等）どの階層由来かを切り分けてから原因を判断する。下位スコープを対象にする一括操作は
上位設定の無いディレクトリから実行し、そのスコープの地点で再検証する。

反映先: 基底ドキュメント（`AGENTS.md`）「ワークフロー」の検証規律に 1 行追加する。paths で絞れない
一般規律のため `.agents/rules/` にはしない。
