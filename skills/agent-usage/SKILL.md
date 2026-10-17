---
name: agent-usage
description: コーディングエージェント（Claude Code・Codex）の利用実績を、人別にリポジトリへ記録して集計するスキル。ローカルのログからモデル別・日別のトークン数と費用、1 回の指示で動き続けた時間、エージェントが止まっていた時間（人の確認中・CI 待ち・レビュー待ち・未活用）を記録し、PR のレビューの回数と費用も集める。コミットの前に Hook が記録するかを確かめ、要約は HTML、明細は CSV にする。「利用実績を記録して」「エージェントの費用を集計して」「エージェントが止まっていた時間を見たい」「agent-usage」や setup / collect / decline / report を伴う依頼で発動する。
argument-hint: "[setup | collect | decline | report | status]"
license: MIT
---

# Agent Usage

コーディングエージェントの利用実績を、リポジトリの `.agent-usage/` に人別に記録し、HTML と CSV に集計する。
目的は、費用の把握と、エージェントが止まっている時間（夜間・休日など）を見つけて、できるだけ動き続ける状態に近づけることである。

## 使い方

```text
agent-usage setup [--person-id <p-xxxxxxxx>] [--time-zone <IANA 名>] [--billing none|user]
agent-usage collect [--stage] [--no-github]
agent-usage decline
agent-usage report [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--out <dir>]
agent-usage status
```

コマンドは、このスキルのディレクトリに置いたまま `node <このスキル>/scripts/agent-usage.mjs <コマンド>` で実行する。利用者のプロジェクトへコピーしない。

- `setup`: 人の ID とタイムゾーンを決め、リポジトリに `.agent-usage/` を作る。Hook の設定は [`references/setup.md`](references/setup.md) に従う
- `collect`: ログと GitHub から、まだ記録していない分を `.agent-usage/records/` の今のブランチのファイルに足す（ブランチごとに 1 ファイル）。`--stage` は書いたファイルを stage し、今のブランチの判断を「記録する」にする
- `decline`: 今のブランチの判断を「記録しない」にする。そのブランチでは、コミットの前に確認しない
- `report`: 記録を集計し、`.agent-usage/report/<yyyyMMdd>/` に `index.html`・`usage.csv`・`intervals.csv`・`reviews.csv` を書く。同じ日に実行し直したら上書きする。期間を省けば、すべての記録を集計する
- `status`: セットアップの有無・今のブランチの判断・人の設定を表示する

## 前提

- ツール: `git`、Node.js（22 以上）、`bash`（Hook のスクリプト）
- GitHub の情報（CI・レビュー・自分の操作）を取るときだけ `gh`（GitHub CLI）。リポジトリの読み取りの権限で足りる。`gh` が無いか失敗したら、その期間の停止を「判定不能」として記録し、collect は続ける。失敗した段は collect の出力に「GitHub の取得に失敗」として出る。
  GitHub を取得するのは、origin が `<ホスト>/<owner>/<name>` の形のときだけである。
  ホストは、github.com・`GH_HOST`・`gh auth login --hostname <ホスト>` でログインしたホストのどれかに限る。
  github.com 以外のホストに、環境変数の token（`GH_TOKEN`・`GH_ENTERPRISE_TOKEN` など）だけで認証するなら `GH_HOST` を指定する。
  `GH_ENTERPRISE_TOKEN` は github.com 以外のどのホストにも返るので、環境変数の token はログインの判定に使わない。
  ポートを含むホストは、`GH_HOST` で指定したか、そのホスト名（ポート付き）で gh にログインしたときだけ取得する。
  取得しなかったときは、collect と Hook の出力に「GitHub: 取得していない」と理由が出る
- 前提スキル: なし
- MCP: なし
- 対象のエージェント: Claude Code と Codex（ローカルのログを読む）。GitHub Copilot のログは読まない

## コミットの前の確認

Hook（PreToolUse）が、デフォルトブランチ以外の `git commit` を検出する。そのブランチの判断がまだ無ければ、コミットを止めて確認を求める。
止められたら、利用者に「このブランチの作業の利用実績を記録してコミットするか」を確かめ、答えに従って次のどちらかを実行してから、もう一度コミットする。

- 記録する: `collect --stage`
- 記録しない: `decline`

利用者に確かめられない実行（無人の実行）では、どちらも選ばずに止まり、理由を報告する。記録しない側を勝手に選ばない。

「記録する」と決めたブランチでは、Hook がコミットのたびに collect を実行して、増えた明細を stage する。デフォルトブランチ（`main` など）と、`.agent-usage/` の無いリポジトリでは何もしない。

この stage は、コミットが実行される前に Hook の中で行う。
そのため、コミットが実行されなかったとき（同じコミットを別の Hook が止めた、git の `pre-commit` フックが失敗した、など）も、明細は stage されたまま残ることがある。
Claude Code と Codex は、当てはまる Hook をすべて同時に起動する（[Claude Code の Hooks reference](https://code.claude.com/docs/en/hooks)・[Codex Hooks](https://learn.chatgpt.com/docs/hooks)）。
そのため、別の Hook（kaizen のコミット前の確認など）がコミットを止めても、この Hook は起動し、collect が成功すれば stage する。

stage された明細は index に残るので、同じブランチの次のコミット（パスを指定しないもの）に入る。戻さなくてよい。
明細がコミットに入ったかは、Hook の出力ではなく、コミットしたリポジトリでコミットの後に次のコマンドを実行して確かめる。
`:/` はリポジトリの直下を起点にしたパスで、サブディレクトリから実行しても同じ範囲を見る。`--untracked-files=all` は、利用者の設定で untracked のファイルが隠れないようにする。

```bash
git status --short --untracked-files=all -- ':/.agent-usage/records'
```

出力が空でなければ、明細はまだコミットされていない（コミットが止められた、パスを指定してコミットした、など）。
記録すると決めたブランチで、出力が今のブランチの明細（ファイルの名前の決め方は [`references/records.md`](references/records.md)）だけなら、ブランチや worktree を移る前に、同じブランチでパスを指定せずにもう一度コミットして明細を入れる。
移ると、明細が移った先のコミットに入るか、`git switch` が止まるか、明細がどのコミットにも入らないまま残る。
それ以外の場合（記録しないと決めたブランチである、別のブランチの明細が出ている、今のブランチの明細かを決められない）は、コミットせずに利用者に確かめる。
記録すると決めたブランチでは、Hook がコミットのたびに `.agent-usage/records/` をまとめて stage するので、別のブランチの明細があるままコミットすると、そのコミットに入る。

## 記録と集計の取り決め

記録のファイルの構成、行の種類、費用の決め方、稼働と停止の分類、重複の除き方は [`references/records.md`](references/records.md) で定義する。
ここには書き写さない。集計の結果を説明するときや、記録を手で直すときは読む。

PR のレビューの費用（自分の GitHub Actions で実行するレビュー・Copilot・`@codex review`）の扱いと、Actions に足す手順の雛形は [`references/reviews.md`](references/reviews.md) にある。

## 注意

- 費用は API の料金に換算した推定で、サブスクリプションの請求額とは一致しない
- Claude Code は、デフォルトで 30 日を過ぎたローカルのログを消す。間が空くと記録が欠けるので、長く作業しないときは手動で `collect` する
- 2 つのブランチで同じ日に `report` を実行すると、merge で `report/<yyyyMMdd>/` が競合する。merge した後の `records/` で `report` を実行し直して解消する
- 記録に残るのは人の ID（ランダムな値）だけである。表示名は、各自が任意で `.agent-usage/config.json` の `people` に書く
