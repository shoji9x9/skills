# pr-review-handle ベンチマーク（iteration-1）

## 方法論

- **モード**: with_skill のみ（ドライラン）
- **分離**: eval ごとに git worktree subagent
- **安全性**: リモートを変更する操作（コメント返信 / `resolveReviewThread` / `git commit` / `git push`）は未実行。
  subagent は実行する代わりに正確なコマンド文字列を提示した。読み取り専用（`gh pr view` / `gh api` GET / GraphQL クエリ）のみ許可。
  テスト用プロンプトは存在しない PR（#42）と非一致リポジトリを対象とし、読み取りは 404 となり副作用は発生しない。
- **備考**: baseline（no-skill）は省略。コマンド型ワークフローのスキルでは信号が乏しく、実際のレビュー操作のリスクもあるため。`issue-start` の方法論に倣う。

## サマリー

| 指標 | 値 |
| --- | --- |
| pass_rate | 1.0 |
| evals | 5 / 5 |
| assertions | 23 / 23 |

## eval 別

| id | 名前 | pass | assertions | tokens | tool calls | time (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | pr-url-default-mode | 1.0 | 7/7 | 14599 | 4 | 44.4 |
| 2 | push-mode | 1.0 | 6/6 | 14606 | 4 | 41.7 |
| 3 | invalid-finding-reply-rationale | 1.0 | 4/4 | 15227 | 4 | 45.3 |
| 4 | repo-mismatch-abort | 1.0 | 2/2 | 13255 | 2 | 19.6 |
| 5 | review-url-scope | 1.0 | 4/4 | 14929 | 4 | 41.0 |

## 観察

- 全ケースで PR URL / PR番号 / レビュー URL から owner/repo/PR番号（および review-id）を正しく抽出し、現在の repo との一致を確認してから後続へ進んだ。
- 未解決スレッドの取得は GraphQL `reviewThreads` を用い、`isResolved == false` のみ対象・全レビュアー対象という方針を一貫して守った。
- 返信 → 解決の順序を全ケースで守り、返信していないスレッドを解決しない不変条件を維持した。
- 妥当でない指摘（eval 3）ではファイルを修正せず、根拠を返信してから解決する判断を示した。
- repo 不一致（eval 4）では fetch / 返信 / 解決を一切行わず中断してユーザーに確認した。
- モード未指定では commit/push を行わず通知停止、`--push` では関連ファイルのみ stage・conventional commits・push を行い、`--amend` / force push を避ける方針を示した。
