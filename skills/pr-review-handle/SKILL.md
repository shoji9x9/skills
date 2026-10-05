---
name: pr-review-handle
description: GitHub PR のレビューコメント対応を `gh` で標準化するスキル。PR URL / PR 番号 / レビュー URL を受け取り、未解決レビュースレッドの確認・指摘の妥当性判断・必要な場合のみ修正・返信・解決（resolve）までを段階的に進める。全レビュアー（Copilot を含む）が対象。「レビューに対応して」「Copilot のレビューを処理して」「レビューコメントを解決して」「pr-review-handle」や、`--push` を伴う依頼で必ず発動する。ブランチ作成や Issue 着手は姉妹スキル issue-start が担う。
argument-hint: "<PR URL | 番号 | レビュー URL> [--push]"
license: MIT
---

# PR Review Handle

GitHub PR のレビューコメントへの対応を `gh` で標準化する。ブランチ運用と commit の規約は、後述の「ブランチ運用・commit 規約の参照」に従って決める。

レビューコメントへの対応では、指摘を確かめて、妥当なら直すか、直さない理由を述べる。どちらの場合も、返信して議論を閉じるまでが 1 セットである。
返信や解決を忘れると、レビュアーは対応の状況を追えない。
このスキルはこの一連を抜けなく行うために、手順の順序を固定する。確認・判断・修正（必要なときだけ）・返信・解決の順である。

## 使い方

```text
pr-review-handle <PR URL | 番号 | レビュー URL> [--push]
```

- 対象の指定: PR の URL、PR の番号（現在の repo）、レビューの URL（`...#pullrequestreview-<review-id>`。そのレビューのコメントに絞る）のどれか。
- `--push` を付けないとき: すべてのスレッドに返信して解決するところまで行い、ファイルを直しても commit と push はしない。
  - ファイルを直したら、変えたファイルの一覧と、commit が要ることと、`--push` を付けて実行し直せることを知らせて止まる。
  - 直したファイルが無く、返信と解決だけで終わるなら、後述の「レビュー対応後の再レビュー依頼」の確認まで行う。
    ただし `review_tool: none` では再レビューを依頼しないので、この確認を省いて完了する。
- `--push` を付けたとき: 上に加えて、関係するファイルだけを stage し、論理的な単位で commit して push する。
  後述の「レビュー対応後の再レビュー依頼」の完了条件を満たしてから終える。`review_tool: none` では、再レビューを依頼するかの確認そのものが要らない。

`--push` は、commit と push の実行を利用者が明示して任せた合図である。指定が無い限り commit しない。
`--push` を付けずに止まった後で利用者が commit と push を指示したときも、push した時点で同じ完了条件を当てる。

例: `pr-review-handle 6` / `pr-review-handle 6 --push` / `pr-review-handle https://github.com/<owner>/<repo>/pull/6#pullrequestreview-4414201665`

自然文でも発動する（「レビューに対応して」「Copilot のレビューを処理して」「レビューコメントを解決して」）。

## 前提

- ツール: `gh`（GitHub CLI。`gh api graphql` を含む）、`git`
- 前提スキル: なし
- MCP: なし
- シェル: bash（POSIX 互換シェル）。コマンド例は bash で書いているので、Windows では WSL や Git Bash などの bash 環境で実行する
- ランタイム: 要らない（node・pnpm・python など）

## ブランチ運用・commit 規約の参照

ブランチ運用と commit の規約はリポジトリごとに違う。
決め方（設定ファイル、よく使われる文書の探索、利用者への確認の順）と、設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは、[`references/conventions.md`](references/conventions.md) にある。
どの規約に決まっても、次の操作の決まりは常に守る。`--amend` と force push をしない。関係するファイルだけを stage する。長い commit の本文は `git commit -F <file>` で渡す。

## 基本フロー

1. 入力から owner・repo・PR の番号を取り出す。review-id があれば、それも取り出す。
2. 現在の repo と、PR の owner・repo が一致するかを確かめる。
   - 一致しなければ、この先の取得・返信・解決をせずに止まり、利用者に確認する。
3. 現在のブランチが PR の head ブランチかを確かめる。
   - `gh pr view <番号> --repo <owner>/<repo> --json headRefName,baseRefName,url,headRefOid` で取得する。`headRefOid` は、後述の「スレッド外に置かれた指摘」でレビューを絞るのに使う。
   - 違っていたら警告し、このブランチのまま進めてよいかを利用者に確認する。直す対象を取り違えないためである。
   - PR の持ち主（作成者か担当者）が自分かを確かめる。
     判定の方法と、自分の login を取得できないときの扱いは、[`references/pr-ownership.md`](references/pr-ownership.md) で定義している。
     `not-owner` なら、作成者と担当者を示して、次の 3 つから利用者に選んでもらってから進む。

     | 選択 | 扱い |
     | --- | --- |
     | 続行 | 通常どおり、修正・返信・解決を行う。`--push` を付けたなら commit と push もする |
     | 返信だけ | 返信はするが、ファイルの修正・resolve・commit・push はしない。他の人が対応中のスレッドを閉じない。返信には判断と根拠だけを書き、直していないのに「修正した」「対応済み」と書かない |
     | 中止 | 何もせずに止まる |

4. 未解決のレビュースレッドを取得する（後述の GraphQL）。各スレッドから、`threadId`、先頭のコメントの `databaseId`、本文、`path`、`line`、作成者を得る。
   - すべてのレビュアーを対象にする。作成者では絞らず、`isResolved == false` で絞る。
   - 解決済みのスレッドは飛ばす。
   - レビューの URL で review-id を渡されたら、そのレビューのコメントに絞る。
5. スレッドの外にある指摘を取得する（後述の「スレッド外に置かれた指摘（レビュー本文・トップレベルコメント）」）。
   指摘はスレッドだけでなく、レビューの本文（`reviews[].body`）と PR のトップレベルのコメント（`issues/<番号>/comments`）にも書かれる。
   そのため、スレッドが 0 件でも、両方を切り詰めずに読む。これらの指摘には返信するスレッドが無いので、PR のトップレベルのコメントで返す。
6. 未解決のスレッドごとに、次を 1 件ずつ行う。
   1. 該当する `path` の `line` の付近を読み、指摘がコードの事実と合うかを評価する。
   2. 妥当で、直す必要があるかを判断する。
      - 妥当で直す必要があれば、対象のファイルを直す。
      - 直さないなら、その根拠を用意する（例: 別の仕組みですでに対処している、指摘が事実と違う、設計の判断として意図している）。
   3. スレッドに返信する。直したなら直した内容を、直さないならその根拠を、コメントと同じ言語で簡潔に書く。
   4. 返信した後で、スレッドを解決する。
7. すべてのスレッドと、スレッドの外（レビューの本文とトップレベルのコメント）の指摘を処理したら、モードに応じて終える（各モードの動きは「使い方」にある）。

返信していないスレッドは解決しない。必ず、返信してから解決する。
解決はレビュアーへの「対応した」という合図なので、根拠を示さずに閉じると、議論の経緯を追えなくなる。

## gh メカニクス

作成者の login は API によって書き方が違う（REST では `Copilot`、GraphQL では `copilot-pull-request-reviewer`）。
すべてのレビュアーを対象にするので作成者で絞る必要は無いが、特定のレビュアーだけを扱うときはこの違いに注意する。

### 未解決スレッドの取得（GraphQL・全ページ取得）

`threadId`（解決に要る）、解決の状態、先頭のコメントの `databaseId`（返信に要る）をまとめて取得できる。
未解決のスレッドは 1 ページに収まらないことがあるので、`first: 50` のように 1 回だけ取得すると、50 件を超えた分を取りこぼす。
`pageInfo` と `endCursor` を含めて、`--paginate` で全ページを取得する。

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <番号>) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { databaseId author { login } path line body }
          }
        }
      }
    }
  }
}'
```

`--paginate` は、`pageInfo { hasNextPage endCursor }` と `$endCursor` の変数があれば、全ページを自動でたどる。
取得した `nodes` から、`isResolved == false` のスレッドだけを 1 件ずつ処理する。
未解決のスレッドの数は、PR ごとに見れば実用上は限られるので、全件を取得してよい。
件数が多くなりうる一覧は、指定した件数で警告なしに打ち切らずにページングを処理する。途中で終えてよいなら、終える条件を書いて順に処理する。
返信先には、先頭のコメントの `databaseId` を使う。

スレッドへの反映が遅れることに注意する。レビューが submit された直後は、レビュー（`reviews`）は取得できるのに、`reviewThreads` へのコメントの反映が遅れることがある（実測）。
直近の、作成者以外のレビューの `comments.totalCount` と、取得できたスレッドを突き合わせる。Copilot なら、レビューの本文の「generated N comments」でも件数を確かめられる。
合わなければ、間隔を空けて再取得する。未解決のスレッドが 0 件というだけで「指摘なし」と判断しない。

### スレッド外に置かれた指摘（レビュー本文・トップレベルコメント）

指摘が書かれる場所はスレッドだけではない。集める対象は次の 3 つである。

1. レビュースレッド（`reviewThreads`）
2. レビューの本文（`reviews[].body`）
3. PR のトップレベルのコメント（`issues/<番号>/comments`）

2 と 3 は `reviewThreads` にも `comments.totalCount` にも現れない。
そのため、未解決のスレッドが 0 件で、作られたコメントが 0 件でも、対応していない指摘が残っていることがある。実測で見つかった形は次の 2 つである。

- レビューの本文: Copilot は、確信度の低い指摘を本文の `<details>` の中に `### Comments suppressed due to low confidence (N)` として入れ、ヘッダには `Comments generated: 0 new` と書く。
  本文の冒頭には、`### 🟡 Not ready to approve` のような総合の判定も入る。
- トップレベルのコメント: Claude の GitHub Action（`review_tool: claude-code`）は、総評と軽い指摘をトップレベルのコメントに置き、`reviews[].body` を空、`state` を `COMMENTED` にする。
  この形では、指摘がスレッドにも本文にも現れない。

```bash
# 2 つ目: レビューの本文
gh api --paginate repos/<owner>/<repo>/pulls/<番号>/reviews \
  --jq '.[] | select(.commit_id=="<headRefOid>") | {id, user: .user.login, state, body}'

# 3 つ目: トップレベルのコメント（本文は切り詰めない）
gh api --paginate repos/<owner>/<repo>/issues/<番号>/comments \
  --jq '.[] | {id, login: .user.login, type: .user.type, created_at, updated_at, body}'
```

- トップレベルのコメントは切り詰めずに読む。
  mention で依頼済みかを判定するときは、同じ API を `body: .body[:60]` に切り詰めて取得する（[`references/review-tool.md`](references/review-tool.md)）。
  その取得を指摘の収集に使い回さない。切り詰めた後ろにある指摘を取りこぼす。
- 対象は、自分（PR の作成者。このスキルが書いた依頼のコメントや対応の記録を含む）以外の投稿すべてである。
  `select(.user.type=="Bot")` で bot に絞らない。人のレビュアーが総評をトップレベルに置くこともあるので、絞ると取りこぼす。
  `.user.type` は bot か人かを区別するためだけに使い、集める対象の絞り込みには使わない。
- 特に `review_tool` が mention で依頼する方法（`claude-code`・`codex`）のときは、レビュアーが総評と指摘をトップレベルのコメントに置くものとして読む。`reviews[].body` が空でも指摘はある。
- 2 と 3 の指摘には返信するスレッドが無く、`resolve` もできない。
  PR のトップレベルのコメントで、対象の箇所・判断・根拠・実測した結果を書いて返す。直した場合も、見送った場合も残す。
  指摘の側には対応の記録が残らないので、このコメントだけが証跡になる。
- 総合の判定（`Not ready to approve` など）が残るときは、どの指摘に基づくのか、直したのか見送ったのかを報告に書く。

### レビュー URL 指定時のコメント取得（REST）

review-id を渡されたら、そのレビューの行に付いたコメントに絞る。コメントが多い PR で取りこぼさないよう、`--paginate` で全ページを取得する。

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<番号>/reviews/<review-id>/comments
```

取得したコメントの `id` を、上の GraphQL の `databaseId` と突き合わせて、対象のスレッドを見つける。

### 返信（REST）

スレッドの先頭のコメントの `id`（`databaseId` と同じ）に返信する。
本文はバッククォートや `$` を含みうるので、quoted heredoc（かファイルを書くツール）でファイルに書き、`-F body=@<path>` で渡す。`gh api` には `--body-file` が無い。

```bash
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
<返信本文>
EOF
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/comments/<comment-id>/replies \
  -F body=@"$body_file"
rc=$?
rm -f "$body_file"
(exit "$rc")  # gh の失敗を後片付けの終了コードで隠さない
```

### 解決（GraphQL）

返信を投稿した後で、スレッドを解決する。

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "<threadId>" }) {
    thread { isResolved }
  }
}'
```

## 妥当性の判断ガイド

レビューの指摘を機械的にすべて直すことも、すべて退けることもせず、コードの事実に基づいて 1 件ずつ判断する。

- 指摘がコードの今の状態と合っていて、バグ・リスク・読みにくさなどの実害があるかを見る。
- 別の仕組みですでに対処しているなら、直さずにその根拠を返信する。
- 外部のツール・API・ライブラリの仕様についての事実の指摘（特に「常に失敗する」という指摘）は、直す前に、公式のドキュメント・実際の出力・テストで本当かを確かめる。
  自信ありげな誤った指摘をそのまま「修正」すると、その修正が新しい不具合になる。
- 直し方が複数あって影響が大きいとき、コードだけでは妥当かを判断できないとき、設計の判断が絡むときは、勝手に直さずに利用者に確認する。
- 確認を求める前に、妥当かの裏付けを取る。裏付けを取っていない指摘を、「対応するか」として利用者に上げない。
  誤った指摘なら確認そのものが要らず、人の判断を無駄に使う。確認するのは、妥当だと裏付けたうえで、なおスコープや直し方が分かれる場合だけである。
- 直すのは、妥当で必要だと判断したときだけにする。

## commit の扱い（`--push` 時）

- commit message は、「ブランチ運用・commit 規約の参照」で決めた規約に従う。リポジトリに commit-msg の検証（commitlint や lefthook など）があれば、それにも従う。
  - 検証が本文の行の長さを制限していれば、それを守る。長い本文は `git commit -F <file>` で渡す。
- 関係の無い変更を同じ commit に入れない。レビューへの対応で触ったファイルだけを stage する。
- commit すると、設定されていれば pre-commit フック（lefthook など）や kaizen の commit 前のチェックが実行される。
  チェックで止まったら、指示に従って `kaizen --current` を実行してから commit し直す。
- commit の `--amend` と force push はしない。

## レビュー対応後の再レビュー依頼

レビューへの対応（返信と解決）を終えたら、設定したレビューツールに再レビューを依頼するか、いつ依頼するかを利用者に確認する。
依頼先のツールを決める規則と、ツールごとの依頼の方法と成立の確かめ方は、[`references/review-tool.md`](references/review-tool.md) にある。
依頼先は同梱のスクリプト `scripts/resolve-review-tool.sh` で決め、値と、それがどの層（cli・env・config・default）から来たかを報告してから使う。
決める順序を推測すると層を取り違え、設定してある値を「未設定」と判定して、別のツールに依頼してしまう。手順は [`references/review-tool.md`](references/review-tool.md) にある。

GitHub の側で自動レビューを設定していても、push の後にレビューが始まらないことがある。
また、push せずに返信だけで閉じたスレッドも、もう一度見てほしいことがある。そのため、このスキルから明示的に依頼する。

この確認は作業の完了条件である。push したかどうかに関わらず、確認して、選ばれたとおりに処理し終えるまで最終の応答を返さない。
ただし `review_tool: none` では再レビューを依頼しないので、この確認を省き、返信と解決が済んだ時点で完了とする。

確認の前に、push したなら、自動レビューがすでに始まっていないかを確かめる。リポジトリの設定によっては、push に合わせて自動レビューが始まる（実測）。
`copilot` ではタイムラインの Copilot 宛ての `review_requested` イベントで、mention で依頼する方法（`claude-code`・`codex`）では現在の HEAD への進行中の bot のレビューかコメントで判定する。
判定の手順は [`references/review-tool.md`](references/review-tool.md) にある。
push が終わった直後に記録した時刻より後に自動レビューが始まっていれば、改めて依頼せず、そのことを利用者に伝える。そのうえで、依頼するかの確認を省いて、レビューの結果の確認に進む。
最新のイベントの日時だけでは判定できないので、前の HEAD への古い依頼（PR を作ったときなど）を、自動で依頼された根拠にしない。

選べる選択肢は、リモートの HEAD を再レビューできる状態かで変わる。

- push したとき（`--push` を付けたか、`--push` なしで対応した後に利用者の指示で push したとき）は、新しい HEAD を対象にする。
  CI と並行してレビューしたいこともあるので、タイミングを決め打ちせず、次の 3 つから選んでもらう。

  | 選択 | 動き |
  | --- | --- |
  | 今すぐ依頼 | CI の完了を待たずに、すぐ依頼する。CI と並行してレビューが進む |
  | CI 完了後に依頼 | CI の成功を確かめてから依頼する。失敗する変更でレビューを始めさせない |
  | 依頼しない | 依頼しない |

- push しなかったとき（返信と解決だけで終わり、コードも直していないとき）は、リモートの HEAD が変わらず、CI も新しく実行されない。
  そのため「CI 完了後」は出さず、次の 2 つから選んでもらう。

  | 選択 | 動き |
  | --- | --- |
  | 今すぐ依頼 | 今の HEAD を対象に依頼する |
  | 依頼しない | 依頼しない |

ただし、`--push` を付けずにファイルを直していて、commit と push を待っているときは、まだ確認しない。
push していないコードについて再レビューを依頼すると、リモートの古い HEAD がレビューの対象になるからである。
commit と push が済んでから、上の「push したとき」として確認する。

### 「CI 完了後に依頼」を選んだ場合のみ、先に CI を待って確認する

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- すべてのチェックが終わるまで待ち、すべて成功なら終了コード 0、どれかが失敗したら 0 以外で終わる。
- 失敗したら依頼を出さず、失敗の内容を利用者に知らせて止まる。先に CI を直す。
- push の直後は、チェックがまだ登録されておらず、すぐに `no checks` が返ることがある。
  そのときは間隔を空けて数回まで確かめ直す。それでも登録されなければ、この HEAD では CI が実行されないとみなし、そのことを利用者に伝えて依頼に進む。CI が無いこと自体は失敗ではない。

### レビューツールへ再依頼する

「今すぐ依頼」なら（push したかに関わらず）そのまま、「CI 完了後に依頼」なら CI の成功を確かめた後で依頼する。
依頼は、設定した `review_tool` のツールごとの手順（[`references/review-tool.md`](references/review-tool.md)）で行い、成立したことを確かめる。
依頼した後、上限を決めてレビューが届くのを待っても成立を確かめられなければ、成立しなかったとして利用者に知らせる。

## 追加確認が必要な条件

次のときだけ、処理を止めて利用者に確認する。

- 現在の repo と、PR の owner・repo が一致しない。
- 現在のブランチが PR の head ブランチと違う。
- 自分が PR の作成者でも担当者でもない（[`references/pr-ownership.md`](references/pr-ownership.md)。続行・返信だけ・中止から選ぶ）。
- 指摘が妥当かを、コードだけでは判断できない。
- 直し方が複数あり、実装に大きく影響する。
- レビューへの対応の後に再レビューを依頼するか、いつ依頼するか。push したときは今すぐ・CI 完了後・依頼しないから、push しなかったときは今すぐ・依頼しないから選ぶ。
  依頼先は設定した `review_tool` に従う（[`references/review-tool.md`](references/review-tool.md)。デフォルトは `copilot`）。`none` なら確認しない。
