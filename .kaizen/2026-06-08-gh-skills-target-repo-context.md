---
date: 2026-06-08
type: skill
priority: high
status: applied
session: claude-code
---

## 事象

eval セッション横断集計（228 ラン、is_error 112 件）で、`gh`/`git` 系スキルの失敗が最多だった:

- `fatal: not a git repository (...)`: **32 件**
- `gh ... GraphQL: Could not resolve to a PullRequest with the number of 42`: **19 件**
- `gh ... GraphQL: Could not resolve to a Repository with the name 'other-org/other-repo'`: **6 件**

3 スキル（dependabot-merge / pr-review-handle / issue-start）すべてで発生。エージェントは
空ディレクトリ（eval の使い捨てプロジェクト）で `git status` / `gh pr view 42` 等を実行し、
対象リポジトリのコンテキストが無いため解決に失敗した（`gh` 認証自体は
`Logged in to github.com account shoji9x9` で成功している）。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）。二面の根本原因がある:

**面 A（eval fixture）**:

- なぜ repo が無かったか? → `run-skill-eval.sh` が分離のため**空の使い捨てプロジェクト**で `claude -p` を回し、
  対象 repo の clone も `gh repo set-default` も行わないため。さらに架空の PR#42 / issue#12 /
  `other-org/other-repo` を渡しており実在しない。
  - なぜ前提を用意しないか? → `[[2026-06-08-eval-isolation-cd-not-persisted]]` で *ファイル分離* は
    解決したが、**スキルの前提条件の確立**（repo コンテキスト・実在する対象）が fixture の責務として
    未整備のため。← 根本原因 A

**面 B（スキル）**:

- なぜ cwd 依存で失敗したか? → スキルが `gh pr view <n>` を cwd の repo 文脈に暗黙依存させ、
  引数の URL/番号から `OWNER/REPO` を導出して `gh --repo` で**明示**していないため。← 根本原因 B

KEDB 照合: `[[2026-06-08-eval-isolation-cd-not-persisted]]`（同ハーネスの分離層）の次層。
横断スコープ: `gh`/`git` を使う全スキル、および「別リポジトリ」シナリオ全般。

## 提案

両面に対処する。

1. **eval fixture（type: skill / doc）**: `run-skill-eval.sh` に前提セットアップ段を追加 ――
   対象 repo を clone する（または `gh repo set-default OWNER/REPO`）、シナリオでは**実在する**
   PR/Issue 番号を使う。これにより「環境起因の失敗」と「スキル本来の失敗」を切り分ける。
2. **スキル（type: skill）**: 各スキル冒頭で、引数の URL/番号から対象 `OWNER/REPO` を確定し、
   以降の `gh` 呼び出しで `--repo OWNER/REPO` を明示する手順を追記。cwd が対象 repo の
   チェックアウトである前提に暗黙依存しない。

教訓（一般化）: **gh/git 系スキルは「対象リポジトリのコンテキスト」を冒頭で明示的に確立してから実行する。
eval は前提条件（repo・実在する対象）を fixture で用意しないと、失敗がスキル欠陥か環境かを切り分けられず
シグナルを汚染する。**
