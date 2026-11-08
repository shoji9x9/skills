# 週次のセルフ点検

決定論的なチェック（textlint・`check-doc-refs.ts`・`check-time-sensitive-prose.ts`・fallow・jscpd）では判定できないものを、LLM で毎週点検する。
対象は、不要物・文書の間の食い違いと重複・やりすぎな記述とチェック・回帰 eval の妥当性・効果の無い GitHub Actions・分かりにくい語と旧称である。
指摘は追跡 Issue（`Self review findings`）に載せる。直すか、決定論的なチェックに移すかは人が決める。

点検の項目と、エージェントが書く結果の形は [`self-review-procedure.md`](self-review-procedure.md) にある。

## 構成

ワークフロー `.github/workflows/self-review.yml` が、毎週火曜に実行する。手動では `workflow_dispatch` で実行できる。
費用の指標の追跡 Issue（`check-cost-metrics.yml` が同じ日に書く）を入力に使うので、その 1 時間後に置いている。時刻は [`weekly-schedule.md`](weekly-schedule.md) にある。
追跡 Issue のタイトルの日付が今日（UTC）でなければ、前の週の本文とみなして使わず、入力なしで点検する。手動で実行するときに費用の指標を入力に使うなら、同じ日に `check-cost-metrics.yml` を先に実行する。
同じタイトルの Issue は誰でも開けるので、`github-actions[bot]` が作った Issue のときだけ入力に使う。本文に仕込まれた指示に、エージェントが従うのを防ぐためである。

ジョブは 2 つに分ける。

- `review`: Claude Code（`anthropics/claude-code-action`）が手順を読み、結果を JSON に書く。
  エージェントに許すのは、リポジトリの中を読むこと（`Read`・`Grep`・`Glob`）と、結果のファイルを書くこと（`Edit`・`Write`。書き先は結果のファイルだけに限る）である。
  使えるツールそのものを `--tools` でこの 5 つに限り、サブエージェント（`Agent`）なども使えなくする。
  サブエージェントをバックグラウンドで起動したまま、エージェントが結果を待たずに終わることがあるためである。
  リポジトリの外（資格情報のある場所）は読めず、結果のファイルのほかは書けない。git も許さないので、履歴の件名とファイルの一覧は点検の前の段が入力に書き出す。
  ジョブの権限は `contents: read` と `issues: read` である
- `tracking-issue`: `review` の結果を artifact で受け取り、`scripts/weekly/self-review-issue.ts` で本文を作って、追跡 Issue を作成・更新・クローズする。
  エージェントが書き換えた作業ツリーを使わないよう、checkout し直したスクリプトだけを実行する

## 資格情報

secret `CLAUDE_CODE_OAUTH_TOKEN` に、Claude のサブスクリプションの OAuth トークンを登録する。点検にかかる使用量は、サブスクリプションの枠に数えられる。
トークンは手元の端末で `claude setup-token` を実行して作り、`gh secret set CLAUDE_CODE_OAUTH_TOKEN` で登録する。
トークンが画面に表示されるので、エージェントとの会話の中では実行しない。

## モデル

リポジトリ変数 `SELF_REVIEW_MODEL` に、エージェントのモデルの名前（`opus` などの別名か、モデルの ID。Claude Code の `--model` に渡す値）を入れる。
変数が無ければ `--model` を渡さず、`claude-code-action` のデフォルトのモデルを使う。
値は Claude Code の引数に入るので、英数字と `.`・`_`・`:`・`-` だけを受け付け、先頭は英数字に限る。ほかの文字があれば、点検せずに理由を追跡 Issue に書いて失敗させる。

```bash
gh variable set SELF_REVIEW_MODEL --body opus
gh variable delete SELF_REVIEW_MODEL
```

軽いモデルは、入力のファイルを途中までしか読まずに結果を書くことがある。
既知の食い違いを持つ文書まで読まなかった週は、その文書への指摘が無いとして失敗する（「点検できなかったときの扱い」）。
その文書より後を読み残した週は、ワークフローは失敗しないので、結果の `notes` に「点検していない」項目やファイルが無いかを人が確かめる。
読み残しが続いたら、変数でより大きいモデルを選ぶ。

## 一時停止

リポジトリ変数 `SELF_REVIEW_SKIP` を `true` にすると、点検も追跡 Issue の更新もしない。再開するときは変数を消すか `false` にする。

```bash
gh variable set SELF_REVIEW_SKIP --body true
gh variable delete SELF_REVIEW_SKIP
```

## 点検できなかったときの扱い

指摘が 0 件の週と、点検が動いていない週を区別する。

- `review` は、エージェントを動かす前に、既知の食い違いを持つ文書（どこからも参照されず、存在しないスクリプトを起動するよう書いたファイル）を作業ツリーに置く。
  名前は実行ごとに変える。結果にこの文書への指摘が無ければ、点検が機能していないものとして扱う。この文書への指摘は追跡 Issue に載せない。
  この文書で捕まえるのは、起動に失敗した実行や、何も読まずに空の結果を書いた実行である。意図して手を抜くエージェントは想定しないので、エージェントからは隠さない
- 次のときは、追跡 Issue を閉じずに、理由をコメントしてからジョブを失敗させる。追跡 Issue が無ければ、理由を本文にして作る
  - secret が未設定
  - `SELF_REVIEW_MODEL` に、モデルの名前に使わない文字がある
  - エージェントの実行が失敗した
  - 結果を受け取れない、結果の JSON の形が違う、または本文が GitHub の上限に近い（60,000 字を超える）
  - 結果に資格情報（secret の値か、`sk-ant-` で始まる文字列）がある。この週の結果は Issue に載せない
  - 既知の食い違いへの指摘が無い

点検できなかった原因は、エージェントの実行記録（全メッセージとツールの結果）で確かめる。
エージェントが動いて終わった実行では、`review` が実行記録を artifact `self-review-execution-<試行の番号>` に 14 日間残す。
時間切れで止めた実行には、実行記録が無い。claude-code-action は実行の終わりに実行記録を書くので、途中で止めると書かれない。
公開リポジトリの artifact はログインした人が読めるので、資格情報を `[REDACTED]` に伏せてから残す。
伏せるのは、Claude の OAuth token と GitHub の token の値と、資格情報の形の文字列（`sk-ant-`・`ghp_` などの GitHub の token・`github_pat_` で始まるもの）である。
伏せた後にも残っていれば、実行記録は残さず、run に警告の注釈を出す。

```bash
gh run download <run の ID> --name self-review-execution-<試行の番号> --dir <保存先>
```

## 追跡 Issue の読み方

本文の表は、項目・対象のファイル・内容・根拠・直し方の案・前回からの状態（新規・継続）を並べる。
前回との差分は、項目と対象のファイルの組で数える。同じファイルへの同じ項目の指摘は、内容が変わっても「継続」になる。
指摘にしなかったものは「点検のメモ」に畳んで載せる。

繰り返し出る指摘のうち機械的に判定できるものは、決定論的なチェック（`scripts/gates/<分類>/`）に移し、手順の項目から外す。
チェックを作る前に、`.agents/rules/check-cost-benefit.md` の基準で効果と費用を書く。

## prompt-audit

`/doctor prompt-audit`（`CLAUDE.md`・skills・agents 向け）と `/claude-api prompt-audit`（プロンプト・ツールの説明向け）は、どちらも `claude -p` で非対話で実行できる。
週次の点検には入れない。指摘の多くが、週次の点検の「文書の間の食い違いと重複」と重なり、使用量だけが増えるためである。
モデルを替えたときや、`AGENTS.md` を大きく書き換えたときに、手で実行する。
