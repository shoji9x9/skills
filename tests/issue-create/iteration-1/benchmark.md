# issue-create ベンチマーク（iteration-1）

## 方法論

- **モード**: with_skill のみ（ドライラン）
- **分離**: eval ごとにバックグラウンド subagent
- **安全性**: リモートを変更する操作（`gh issue create`）は未実行。subagent は実行する代わりに正確なコマンド文字列を提示した。読み取り専用（`gh repo view` / `gh issue list`）とテンプレ read のみ許可。
- **備考**: baseline（no-skill）は省略。コマンド型ワークフローのスキルでは信号が乏しく、実起票のリスクもあるため。`issue-start` の方法論に倣う。

## サマリー

| 指標 | 値 |
| --- | --- |
| pass_rate | 1.0 |
| evals | 4 / 4 |
| assertions | 18 / 18 |

## eval 別

| id | 名前 | pass | assertions | tokens | tool calls | time (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | bug-report | 1.0 | 7/7 | 14412 | 8 | 61.7 |
| 2 | feature-request | 1.0 | 5/5 | 13890 | 5 | 50.3 |
| 3 | vague-clarify | 1.0 | 3/3 | 13155 | 5 | 48.0 |
| 4 | task-fallback | 1.0 | 3/3 | 14089 | 5 | 54.5 |

## 観察

- 全ケースで対象リポジトリ確認（`gh repo view`）と `gh issue list` による重複チェックを先に行ってから後続へ進んだ。
- bug / feature の各ケースで `.github/ISSUE_TEMPLATE/` の該当テンプレを検出・読み込み、title 接頭辞とラベルを踏襲した。
- タスク（テンプレ非該当）ケースでは SKILL.md の指示どおり汎用構成へフォールバックした。
- 曖昧な依頼では推測で本文を埋めず質問し、承認なしに起票しなかった。
- 全ケースで多行本文を `--body-file` で渡すコマンドを提示し、承認前に `gh issue create` を実行しなかった。
