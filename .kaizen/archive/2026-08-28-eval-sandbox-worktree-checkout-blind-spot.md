---
date: 2026-08-28
type: rule
priority: high
status: applied
applied-to: [scripts/eval-sandbox.sh]
session: claude-code
---

# 自身のパス由来で隔離対象を 1 点に絞る遮断ロジックは、同一実体の他インスタンスを見落とす

## 事象

Issue #244 の作業中、`scripts/run-skill-eval.sh --config without_skill` の baseline run が
`contamination.txt` の `verdict: CONTAMINATED` になった。ベースラインがメインチェックアウト
`~/projects/skills/.agents/skills/kaizen/` を読み、**変更前**の kaizen 設計を答えていた。

`scripts/eval-sandbox.sh` は自身のスクリプトパス（`$0`）から `repo` / `repo_parent` を求め、
その `repo_parent` だけを `--tmpfs` で隠していた。今回はセッションが git worktree（`/tmp` 配下）へ
移動しており、`eval-sandbox.sh` もそこから起動されたため、`repo_parent` が `/tmp` になり、
**メインチェックアウトが遮断対象から外れた**。

## 根本原因

[[2026-07-28-eval-baseline-read-contamination]]（status: applied。過去 5 回の再発でハーネス既定の
4 群遮断＋汚染検知まで実装済み）の**6 回目の亜種**。KEDB 照合でヒット。既存 4 群
（作業ツリー・兄弟 run・OS ミラー・エージェント記録）はいずれも「対象資産へ到達できる経路を
**列挙**する」設計だが、その列挙の起点（`repo`/`repo_parent`）自体を「自身のパスから求めた 1 点」に
固定していた。同一リポジトリの複数チェックアウト（git worktree）が同時に存在しうるケースが
列挙から漏れていた——過去 5 回と同じ「片側・一軸だけの対処」パターンが、対象の**数え方**という
新しい軸で再発した。

横断スコープ確認: `scripts/*.sh` で `readlink -f "$0"` / `dirname "$0"` から自身のリポジトリパスを
求めている箇所は `eval-sandbox.sh` のみ（grep で確認）。他スクリプトはプロジェクトルート解決に
`git rev-parse --show-toplevel` や `CLAUDE_PROJECT_DIR` との `git-common-dir` 一致判定
（`kaizen-hook-common.sh` の `kaizen_resolve_project_root`）を使っており、worktree を正しく扱う。
今回の穴は `eval-sandbox.sh` に固有だった。

## 提案

`scripts/eval-sandbox.sh` に、`git -C "${repo}" worktree list --porcelain` が返す**全 work tree**の親を
`--tmpfs` で隠す処理を追加した（自分自身の worktree は `/tmp` 側の tmpfs+bind で別途保持されるため除外）。
適用済み（このセッションで実装・`--verify` の陽性コントロールと再実行後の `contamination.txt: clean` で確認）。

一般化した規律: **自身のパスから求めた 1 つの位置だけを隔離・除外の対象にするロジックは、
「同じ実体（同じリポジトリ・同じ設定・同じ資産）の他インスタンスが存在しないか」を先に列挙してから
対象を決める。** `git-worktree` スキルの `scanner-exclusions.md`「除外は 1 か所では足りない」は
検査の**種類**を横断する話だったが、本件は検査の**対象インスタンス**を横断する別軸。
