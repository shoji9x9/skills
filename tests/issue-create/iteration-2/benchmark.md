# issue-create ベンチマーク（iteration-2）

## 方法論

- **モード**: with_skill のみ（ドライラン）
- **分離**: eval ごとにバックグラウンド subagent
- **安全性**: リモート変更操作（`gh issue create`）は未実行。`.github/ISSUE_TEMPLATE/` への同梱テンプレのコピーも未実行（尋ねるところまで）。読み取り専用（`gh repo view` / `gh issue list`）とテンプレ read のみ許可。
- **備考**: baseline（no-skill）は省略。`issue-start` の方法論に倣う。
- **iteration-1 からの変更**: テンプレ正本をスキルへ同梱（`assets/issue-templates/`）。実行時はインストール先 `.github/ISSUE_TEMPLATE/` を優先・尊重し、無ければ同梱を使用。`.github` へのコピー導入はユーザー確認後・既存は上書きしない。新挙動検証用に eval 5 を追加。

## サマリー

| 指標 | 値 |
| --- | --- |
| pass_rate | 1.0 |
| evals | 5 / 5 |
| assertions | 22 / 22 |

## eval 別

| id | 名前 | pass | assertions | tokens | tool calls | time (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | bug-report | 1.0 | 7/7 | 16212 | 6 | 64.6 |
| 2 | feature-request | 1.0 | 5/5 | 14374 | 6 | 59.7 |
| 3 | vague-clarify | 1.0 | 3/3 | 13311 | 5 | 44.3 |
| 4 | task-fallback | 1.0 | 3/3 | 15871 | 8 | 67.0 |
| 5 | no-template-ask-copy | 1.0 | 4/4 | 15689 | 6 | 60.4 |

## 観察

- テンプレがあるリポジトリ（eval 1/2）では同梱ではなくインストール先 `.github/ISSUE_TEMPLATE/` を優先採用し、固有テンプレを尊重した。
- テンプレが無いリポジトリ（eval 5）では同梱 `assets/issue-templates/` をひな型に使い、`.github` へのコピー導入を自動では行わずユーザーに確認、既存上書き禁止（`cp -n`）も明示した。
- タスク（eval 4）はインストール先・同梱の双方に該当テンプレが無いことを確認した上で汎用構成へフォールバックした。
- 曖昧な依頼（eval 3）では推測で本文を埋めず質問し、承認なしに起票しなかった。
- 全起票ケースで多行本文を `--body-file` で渡すコマンドを提示し、承認前に `gh issue create` を実行しなかった。
