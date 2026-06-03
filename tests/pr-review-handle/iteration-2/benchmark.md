# pr-review-handle ベンチマーク（iteration-2）

## 方法論

- **モード**: with_skill のみ（ドライラン）
- **分離**: なし（共有作業ツリー・読み取り専用ドライラン）
- **対象**: コミット前の作業ツリー版スキル（push 後の Copilot 再依頼タイミング確認・ページング全件取得・AGENTS.md との整合修正を含む）。worktree は HEAD からしか作れず未コミット変更を反映できないため、読み取り専用ドライランを前提に分離なしで実行した。
- **安全性**: リモートを変更する操作（コメント返信 / `resolveReviewThread` / `git commit` / `git push` / `requested_reviewers`）は未実行。subagent はコマンド文字列の提示にとどめた。テスト用プロンプトは存在しない PR（#42）と非一致リポジトリを対象とし、読み取りは 404 で副作用なし。
- **iteration-1 からの差分**: eval 2（push-mode）に「Copilot 再依頼タイミングの確認（今すぐ / CI 完了後 / 依頼しない の 3 択）」の 3 assertion を追加（6→9）。baseline（no-skill）は省略。

## サマリー

| 指標 | iteration-1 | iteration-2 |
| --- | --- | --- |
| pass_rate | 1.0 | 1.0 |
| evals | 5 / 5 | 5 / 5 |
| assertions | 23 / 23 | 26 / 26 |

## eval 別

| id | 名前 | pass | assertions | tokens | tool calls | time (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | pr-url-default-mode | 1.0 | 7/7 | 16403 | 5 | 43.9 |
| 2 | push-mode | 1.0 | 9/9 | 16276 | 3 | 73.7 |
| 3 | invalid-finding-reply-rationale | 1.0 | 4/4 | 15858 | 4 | 41.0 |
| 4 | repo-mismatch-abort | 1.0 | 2/2 | 14257 | 2 | 21.1 |
| 5 | review-url-scope | 1.0 | 4/4 | 15305 | 3 | 39.1 |

## 観察

- iteration-1 に続き全ケース pass。新たに加えた push-mode の 3 assertion（push 後に Copilot 再依頼タイミングを 3 択で確認 / 「CI 完了後」は `gh pr checks` 成功後に依頼 / 「今すぐ」は CI を待たず依頼）も満たした。
- GraphQL/REST の取得手順で `--paginate` とページング処理に言及し、ページネーション修正がスキルに反映されていることを確認した。
- 返信 → 解決の順序、未解決のみ対象、全レビュアー対象、モード未指定で commit/push しない、repo 不一致で中断、といった既存の不変条件は維持された。
- push が発生したときに Copilot 再依頼のタイミング（今すぐ / CI 完了後 / 依頼しない）をユーザーに確認する方針が push-mode の手順に正しく現れた。
