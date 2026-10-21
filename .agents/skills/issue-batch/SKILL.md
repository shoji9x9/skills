---
argument-hint: <setup | prepare <Issue URL | 番号>... | run <Issue URL | 番号>...> [options]
description: 複数の GitHub Issue を依存を考えた順（依存が無ければ入力順）に、Issue ごとの隔離 worktree・独立 branch / PR で連続処理し、実装、ローカルレビュー、検証、必要なブラウザ回帰、Kaizen、PR 収束、merge（GitHub の auto-merge／エージェントが PR の状況を実測してから merge、のいずれかを選択）、Issue close、deployment、branch cleanup まで追跡するスキル。初回は `issue-batch setup` で無人実行ポリシーとマージ方式を確定する。`issue-batch prepare` は run の前に判断を決めて Issue に記録し、実行順の run のプロンプトを示す。「複数 Issue をまとめて処理」「Issue を順番に最後まで」「issue-batch」や `run` / `setup` / `prepare` を伴う依頼で必ず使う。
license: MIT
name: issue-batch
---
# Issue Batch

複数の Issue を 1 件ずつ順に処理する。依存先の Issue を依存元より先に処理し、それ以外は入力の順で前の Issue から処理する。各 Issue は、独立した branch と PR、隔離した worktree を持つ。そのため、1 件が失敗しても、他の作業ツリーに影響しない。

## 使い方

```text
issue-batch setup

issue-batch prepare <Issue URL | 番号>...

issue-batch run <Issue URL | 番号>... \
  [--browser-test-env <環境名>] \
  [--max-local-review-iterations <N>] \
  [--max-pr-iterations <N>] \
  [--wait-ci-before-review | --no-wait-ci-before-review] \
  [--merge-mode <auto|agent>] \
  [--merge-method <squash|merge|rebase>] \
  [--max-deployment-fix-iterations <N>] \
  [--stop-on-blocked]
```

- 公開するサブコマンドは `setup`・`prepare`・`run` だけである。引数なしの呼び出し、サブコマンドを省いた Issue の指定、知らないサブコマンドでは、usage を示して、何も変更する前に停止する。
- `setup` は、引数と `run` 用の option を受け付けない。`prepare` と `run` には 1 件以上の Issue が必要である。`prepare` は `run` 用の option を受け付けず、option は `run` の後ろでだけ解釈する。
- URL と番号を混ぜて渡せるが、すべての Issue が現在のリポジトリと同じ owner/repo でなければならない。
- 1 つの Issue に 1 つの branch と 1 つの PR を対応させる。stacked PR と、複数の Issue を 1 つの PR にまとめることは対象外である。

## 前提

- ツール: `gh`、`git` と、現在のコーディングエージェントの非対話のレビュー機能
- 前提スキル: `git-worktree`、`issue-start`、`kaizen`、`pr-finalize-loop`。画面に影響がある場合は `browser-test`
- 設定: `.config/skills/shoji9x9/issue-batch.jsonc`（扱いは `references/config-files.md`）。レビューツールの決定は pr-finalize-loop に任せる（例外を当てるかを決めるために値を読むだけで、固定も受け渡しもしない）。`browser-test` の設定は参照するが、書き写さない
- Node.js: 設定ファイルを読むのに使う（同梱の `scripts/skill-config/skill-config.mjs`）
- シェル: bash。Windows では WSL や Git Bash などを使う

前提スキルを読めない場合や、設定が足りない場合は、取り決めを推測せずに停止する。`run` の途中で設定の質問を始めず、`issue-batch setup` を案内する。

## モード

### setup

`references/project-config.md` を読み、リポジトリごとの無人実行のポリシーを、対話で確定する。Issue・branch・PR・merge・deployment は操作しない。
書いた設定は、run の前に base branch に入れる必要がある（preflight が確かめる）。そのことを利用者に案内し、設定を無人で commit・push しない。

### prepare

run の途中で判断待ちの `BLOCKED` にならないよう、run の前に利用者の判断が要るものを決めてもらい、決まった内容を Issue にコメントで記録する。
最後に、実行の順に Issue を並べた `issue-batch run` のプロンプトを示す。branch・worktree・PR・manifest は作らず、担当者も割り当てない。
手順・コメントの形・プロンプトの形は `references/prepare.md` で定義する。実行する前に、`references/prepare.md` と `references/orchestration.md` の両方を最後まで読む。

### run

実行する前に、`references/project-config.md` と `references/orchestration.md` の両方を最後まで読む。次の順で進める。

1. 全体 preflight を、何かを変更する前に済ませる。確かめるのは次のものである。
   - 入力の正規化と重複
   - repo、Issue、PR の状態
   - Issue の担当者と、再開する PR の持ち主（自分以外なら BLOCKED）
   - 依存関係と、既存の branch・PR・worktree
   - 設定、認証と権限、レビュー機能
   - Kaizen が transcript を特定できるか、browser-test が安全か
   - setup の設定が base branch に入っているか
   - 依存から決める実行の順（依存先を先にし、それ以外は入力の順で前の Issue を先にする）
   - run の前に利用者の判断が要るもの（複数の案・決まっていない方針・試していない機構を約束した受け入れ条件・対象から外す候補にする不確実性の高い Issue）。1 回の確認にまとめて、変更の前に決めてもらう。全体を停止するときは確認せず、停止の報告に載せる。
     `prepare` が Issue に記録した決定は読んで使い、同じ判断を確認し直さない
2. `/tmp` に run manifest を作る。記録するのは、入力の順・実行の順・Issue の URL・状態・branch・worktree・PR の URL・試験の結果・停止の理由・飛ばした理由・対象から外した理由・判断待ちの項目・自分で判断して進めたもの（`self_decisions` の下の 4 つの欄と `others`）だけである。秘密の値と、変わる環境の URL は書かない。
3. preflight で `EXCLUDED`・`SKIPPED`・`BLOCKED` にした Issue は、この手順から後を行わず、残りの Issue を進める（`references/orchestration.md`「全体 preflight」の最後の段落）。
   依存のある Issue は、同じ文書の「全体 preflight」の 6 の条件を満たしてから着手する。
   呼び出し元の worktree を checkout せず、Issue ごとに一意な隔離した worktree を `git-worktree` の取り決めで用意して、セッションを移す。
   branch を作る前に、その Issue の担当者を確かめ、自分を割り当てて読み直す（`references/orchestration.md`「issue-start への handoff」の 1。割り当てができなければ、branch も worktree も作らない）。
   置き場所は `git-worktree setup` の決定に従う。Issue ごとに worktree を移るので、リポジトリの中に置く必要がある。
4. 各 Issue を実行の順に `issue-start` の取り決めで実装し、次に進める。
   現在のエージェントのローカルレビュー、必要な検証、browser-test、`kaizen extract --current --record-pending`、commit・push・PR の作成である。
   Claude Code では、範囲を渡すために、ローカルレビューの前に変更を commit する（`references/orchestration.md`「ローカルレビュー」）。
   ローカルレビューは、変更が小さいことを理由に省かない。省いてよい条件の一覧と、省いたときの記録は、`references/orchestration.md`「ローカルレビュー」で定義する。
   最後のローカルレビューの後に生じた変更も push の前にレビューする。Kaizen の学びと、Hook が commit のたびに足す記録は例外とし、PR のレビューに任せる。`review_tool` が `none` なら例外を当てず、読めなければ push の前に BLOCKED にする（`references/orchestration.md`「ローカルレビューの後に生じた変更」）。
5. PR は `pr-finalize-loop` に渡して収束させる。AI のレビューの依頼は、`pr-finalize-loop` にまとめる。
6. head の SHA を固定し、決めた merge mode で merge する。`auto` は GitHub の auto-merge に任せ、`agent` は PR の状況を実際に確かめてから merge する。
   `pr-finalize-loop` が使った `review_tool` が `local` なら、どちらの mode でも、固定した SHA を手元でレビューした記録があることを確かめてから merge する（`references/orchestration.md`「merge、close、deployment」の 1）。
   実際に PR が `MERGED`、Issue が `CLOSED` で、対象の deployment がその SHA で成功し、名前が完全一致した branch を片付けたことを確かめてから、`DONE` にする。

状態を変える前に、毎回 GitHub と git の実際の状態を取得し直す。manifest の記憶だけで判断しない。

## 反復と既定動作

値は、CLI で明示した option、setup で決めた設定の順に決める。CLI で上書きしても、設定ファイルは書き換えない。

- ローカルレビューの上限: setup の値。最初の候補は 1
- PR の収束の上限: setup の値。最初の候補は 5
- CI の待機: setup の値。最初の候補は false（CI とレビューを並行して進める）
- run の途中で BLOCKED や FAILED になった後に続けるか: setup の値。最初の候補は true。`--stop-on-blocked` で、その run だけ止める側に上書きする。使う場面は `references/orchestration.md`「全体 preflight」の最後の段落で定義する
- merge mode: setup の値。最初の候補は `auto`。`--merge-mode` で、その run だけ上書きする
- merge の準備ができるまで待つ上限: setup の値（`merge_ready_timeout_minutes`）。`agent` mode でだけ使い、CLI での上書きは無い。`agent` に決まったのに設定に無ければ、推測せずに停止する
- deployment の修正の上限: `--max-deployment-fix-iterations` があれば、その run だけ上書きする

BLOCKED や FAILED の影響が Issue の隔離した worktree の中だけで済む場合は、デフォルトの方針に従って次の Issue に進む。
止まった Issue に依存する Issue は、`references/orchestration.md`「全体 preflight」の 6 のとおりに扱う。依存先を理由に `BLOCKED` にした Issue では、全体も run も止めない。
認証、権限、repo の不一致、共有の設定の誤りなど、全体に影響する失敗では、option に関わらず全体を停止する。

## 安全制約

- 課金・通知・データの作成や変更や削除・ログインの待ち・禁止した操作の解除は、無人では実行しない。必要なら、preflight で BLOCKED にする。
- `--admin`、commit の `--amend`、ローカルの `git rebase`、force push を使わない。deployment を直すときは、同じ feature branch に最新の base を merge する。
  ここで禁じているのは git の履歴の書き換えで、`--merge-method rebase`（GitHub の rebase merge）とは別のものである。
- merge mode に関わらず、merge の要求を送ったこと（auto-merge の有効化や、merge queue への投入を含む）を完了の根拠にしない。
  成功した古い workflow run や、同じ名前の workflow の別の SHA も、根拠にしない。
- `agent` mode でも、required check が完了して成功したことと、mergeable であることを確かめてから merge する。
  完了していない check を待たずに merge しない。`--admin` や、branch protection を一時的に外すことで、無理に merge しない。
- merge・close・deployment の条件がすべて成り立つ前に、branch を削除しない。glob ではなく、確かめた完全一致の ref だけを扱う。
- dirty か BLOCKED の worktree は削除しない。`git worktree remove --force` も使わない。絶対パスと残りの作業を、最終報告に残す。
  commit を記録する Hook が書いた記録だけで dirty なら、次の Issue の branch に引き継いで clean にしてから片付ける（`references/orchestration.md`「worktree に残った記録の引き継ぎ」）。
- run を始めた後は、利用者に確認を送らない。前提スキル（`issue-start`・`pr-finalize-loop`）が「利用者に確認する」と定める箇所も同じである。
  `pr-finalize-loop` には `--defer-decisions` を渡し、人の判断が要る指摘を判断待ちとして受け取る（`references/orchestration.md`「pr-finalize-loop への handoff」）。
  判断が要るものを「無人実行」を理由に飛ばさず、結果を作り上げず、BLOCKED（判断待ち）として記録し、`continue_on_blocked` に従って次の Issue に進むか run を止める（依存先を理由に BLOCKED にした Issue では止めない）。記録の形は `references/orchestration.md`「判断の扱い」に、続けるかは同じ文書の「全体 preflight」の最後の段落にある。
- `kaizen extract --current --record-pending` が現在の transcript を特定できないエージェントでは、候補が 0 件であることを確かめられない。
  transcript を提供しないエージェント（例: Copilot）はこれに当たるので、run が何かを変更する前に BLOCKED にする。検出できるふりをして続けない。

## 最終報告

実行の順に並べた表で、Issue・入力の順・最終状態・branch・worktree・PR・local review・tests・browser・Kaizen・merge・Issue close・deployment・cleanup・停止の理由・飛ばした理由・対象から外した理由を示す。
表の後に、「判断待ち」と「自分で判断して進めたもの」の一覧を必ず載せる。0 件でも、無いことを書く。
`SKIPPED` と `EXCLUDED` の Issue も表に載せる。`EXCLUDED` の対象から外した理由には、当たった兆候と利用者の選択か、外した依存先の番号を書く。
判断待ちは、Issue ごとに論点・選択肢・推奨・決まった後に残る作業を示す。自分で判断して進めたものは、判断・根拠・覆すときに戻る工程を示す。
自分で判断して進めたものには、次の 4 つの欄を必ず載せる。それぞれ 0 件でも、無いことを書く。
守っていない規約とその理由、速度や反復の回数を理由に直さなかった指摘、見送った指摘のうち Issue にしていないもの、Issue の対象から外した形とその根拠である。
preflight で Issue ごと外した `EXCLUDED` は、表の「対象から外した理由」にだけ書き、4 つ目の欄には載せない。
4 つの欄は run 全体で 1 組にし、各項目に Issue の番号と手戻りの大きさ（大・中・小）を添える。各欄の中は、迷った度合いの大きいものから並べる。
迷った度合いは、manifest に記録した手戻りの大きさで測る。
どの欄にも当たらない判断は、4 つの欄の後に、Issue の番号と手戻りの大きさを添えて同じ並べ方で載せる。
これらの欄は、run の間に manifest の同じ欄へ記録したものから作る（`references/orchestration.md`「判断の扱い」）。
`DONE` は、次のすべてを確かめた場合だけ使う。PR が `MERGED`、Issue が `CLOSED`、deployment が成功したか根拠があって対象外である、local と remote の branch を削除した。
worktree に残った記録の引き継ぎ先が merge されずに run が終わると、その Issue は `BRANCH_CLEANUP` のまま残る（`references/orchestration.md`「worktree に残った記録の引き継ぎ」の 5）。
その Issue は `DONE` にせず `BLOCKED` として載せ、worktree の絶対パスと残りの作業を書く。
