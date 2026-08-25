# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-08-25T02:40:47Z
**Evals**: 4, 8, 17（1 run each）

## スコープ

Issue #218（制御ファイルの session 単位化 / worktree でのルート解決 / 他セッションのセンチネル自動走査）に
関係する eval のみを実行した。コスト最小化のため id 15 / 16 は除外（走査器のロジック自体は未変更で、文言更新のみのため）。

## Summary（with_skill のみ）

| Metric    | With Skill      | Without Skill    |
| --------- | --------------- | ---------------- |
| Pass Rate | 100% (17/17)    | 測定なし（下記） |
| Time      | 131.3s ± 25.0s  | —                |
| Tokens    | 9552 ± 1614     | —                |

Delta は算出しない。ベースラインが 1 本しかなく、それが無効化されたため（下記）。

## Per-eval（with_skill）

| Eval | 名前                        | Pass  | Time   |
| ---- | --------------------------- | ----- | ------ |
| 4    | claude-hook-setup           | 5/5   | 105s   |
| 8    | initial-setup               | 5/5   | 135s   |
| 17   | multi-session-control-files | 7/7   | 154s   |

## 除外した run

- **eval 17 / without_skill / run-1**: `contamination.txt` の `verdict` が `CONTAMINATED`
  （出力に kaizen のスクリプト名が現れた）。`docs/skill-development.md`「eval 実行の隔離（必須）」の規約どおり、
  Delta 無効として `grading.json` を置かず集計から除外した。
- **帰結**: eval 17 の**弁別**（スキル無しでは答えられないこと）は本イテレーションでは未実証。
  上表の「測定なし」はベースライン不在を意味し、0% という実測値ではない。

## 実行時の注記

- 初回の 4 run は API のセッション上限（429）に当たって 3 本が途中終了したため、上限リセット後に取り直した。
  打ち切られた run は採点せず破棄している（部分出力を fail として数えると偽の信号になるため）。
- eval 4 / 8 が生成した成果物では、センチネルが実際に session 単位の名前
  （`.kaizen/.pending-extract.<session id>`）で作られ、`.gitignore` も末尾 `*` 付きの 3 行になっていることを
  `project-tree.txt` と生成ファイルで確認した。
