---
name: pr-review-handle
description: GitHub PR のレビューコメント対応を `gh` で標準化するスキル。PR URL / PR 番号 / レビュー URL を受け取り、未解決レビュースレッドの確認・指摘の妥当性判断・必要な場合のみ修正・返信・解決（resolve）までを段階的に進める。全レビュアー（Copilot を含む）が対象。「レビューに対応して」「Copilot のレビューを処理して」「レビューコメントを解決して」「pr-review-handle」や、`--push` を伴う依頼で必ず発動する。ブランチ作成や Issue 着手は姉妹スキル issue-start が担う。
argument-hint: "<PR URL | 番号 | レビュー URL> [--push]"
license: MIT
---

# PR Review Handle

GitHub PR のレビューコメント対応を `gh` で標準化する。ブランチ運用・commit 規約は後述「ブランチ運用・commit 規約の参照」で解決する。

レビューコメントは「指摘を確認し、妥当なら直し、直さないなら理由を述べ、いずれにせよ返信して議論を閉じる」までが 1 セットだ。返信や解決を忘れるとレビュアーは対応状況を追えない。このスキルはその一連を取りこぼさないために、確認 → 判断 → （必要時のみ）修正 → 返信 → 解決の順を固定する。

## 使い方

```text
pr-review-handle <PR URL | 番号 | レビュー URL> [--push]
```

- 対象指定: PR URL / PR 番号（現在の repo）/ レビュー URL（`...#pullrequestreview-<review-id>`。そのレビューのコメントに絞る）

- `--push` 未指定: 全スレッドの返信・解決まで行い、ファイル修正があっても commit / push はしない。ファイル修正があれば変更ファイル一覧と「commit が必要なこと」「`--push` で再実行できること」を通知して止まる。修正がなく返信・解決だけで終わる場合は、後述「レビュー対応後の Copilot 再レビュー依頼」の確認まで行う
- `--push`: 上記に加え、関連ファイルだけを stage し論理単位で commit、push する。完了条件（後述「レビュー対応後の Copilot 再レビュー依頼」）を満たしてから締める

`--push` は commit・push の実行をユーザーが明示的に委譲した合図。指定がない限り commit しない。`--push` なしで止めた後にユーザーが commit / push を指示した場合も、push が発生した時点で同じ完了条件を適用する。

例: `pr-review-handle 6` / `pr-review-handle 6 --push` / `pr-review-handle https://github.com/<owner>/<repo>/pull/6#pullrequestreview-4414201665`

- 自然文でも発動する:「レビューに対応して」「Copilot のレビューを処理して」「レビューコメントを解決して」。

## 前提

- **ツール**: `gh`（GitHub CLI。`gh api graphql` を含む）, `git`
- **前提スキル**: なし
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

## ブランチ運用・commit 規約の参照

ブランチ運用・commit 規約はリポジトリごとに異なる。解決手順（設定ファイル → 標準ドキュメント探索 → ユーザー確認）と設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは [`references/conventions.md`](references/conventions.md) を参照する。
`--amend` / force push をしない・関連ファイルだけを stage する・長い commit 本文は `git commit -F <file>` で渡す、といった汎用の操作メカニクスは規約解決の結果に依らず常に守る。

## 基本フロー

1. 入力から owner / repo / PR 番号（あれば review-id）を抽出する
2. 現在の repo と PR の owner / repo が一致するか確認する
   - 一致しない場合は、以降の取得・返信・解決を行わず中断し、ユーザーに確認する
3. 現在のブランチが PR の head ブランチか確認する
   - `gh pr view <番号> --repo <owner>/<repo> --json headRefName,baseRefName,url`
   - ズレている場合は警告し、このブランチのまま進めてよいかユーザーに確認する（修正対象を取り違えないため）
4. 未解決レビュースレッドを取得する（後述の GraphQL）。各スレッドから `threadId` / 先頭コメントの `databaseId` / 本文 / `path` / `line` / 著者を得る
   - **全レビュアーが対象**。著者では絞らず、`isResolved == false` で絞る
   - 既に解決済みのスレッドはスキップする
   - レビュー URL で review-id が渡された場合は、そのレビューのコメントに絞る
5. 各未解決スレッドについて、以下を 1 件ずつ行う:
   1. 該当 `path` の `line` 付近を Read し、指摘内容を**コードの事実に照らして評価**する
   2. 妥当で修正が必要か判断する
      - 妥当かつ要修正 → 対象ファイルを修正する
      - 不要 → なぜ直さないかの根拠を用意する（例: 既に別の仕組みで緩和済み、指摘が事実と異なる、設計判断として意図的）
   3. スレッドに**返信**する。修正したなら修正内容、しないならその根拠を、コメントの言語に合わせて簡潔に書く
   4. 返信した後にスレッドを**解決**する
6. 全スレッドを処理したら、モードに応じて締める（各モードの挙動は「使い方」を参照）

**返信していないスレッドは解決しない。** 必ず「返信 → 解決」の順を守る。解決はレビュアーへの「対応済み」の合図であり、根拠の提示なしに閉じると議論の経緯が追えなくなる。

## gh メカニクス

著者の login は API で表記が異なる（REST では `Copilot`、GraphQL では `copilot-pull-request-reviewer`）。全レビュアー対象のため著者で絞る必要はないが、特定レビュアーだけ扱う場合はこの差に注意する。

### 未解決スレッドの取得（GraphQL・全ページ取得）

`threadId`（解決に必要）・解決状態・先頭コメントの `databaseId`（返信に必要）をまとめて得られる。
**未解決スレッドは 1 ページに収まらないことがある**ため、`first: 50` のような単発取得は 50 件超で取りこぼす。
`pageInfo`/`endCursor` を含め、`--paginate` で全ページ取得する。

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

`--paginate` は `pageInfo { hasNextPage endCursor }` と `$endCursor` 変数があれば全ページを自動でたどる。
得た `nodes` から `isResolved == false` のスレッドだけを 1 件ずつ処理する。
未解決スレッド数は PR 単位で実用上限定的なので全件取得してよい（大量になりうる一覧は、
指定件数で暗黙に打ち切らずページングを処理し、十分なら早期終了の条件を明示して逐次処理する）。
先頭コメントの `databaseId` を返信先に使う。

**スレッド反映ラグに注意**: レビュー submit 直後は、レビュー自体（`reviews`）は取得できるのに `reviewThreads` への
コメント反映が遅れることがある（実測）。直近の非著者レビューの `comments.totalCount`（Copilot はレビュー本文の
「generated N comments」でも確認できる）と取得できたスレッドを突き合わせ、不整合なら間隔を空けて再取得する。
未解決スレッド 0 件だけを根拠に「指摘なし」と判断しない。

### レビュー URL 指定時のコメント取得（REST）

review-id が渡された場合、そのレビューのインラインコメントに絞る。コメントが多い PR で取りこぼさないよう `--paginate` で全ページ取得する:

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<番号>/reviews/<review-id>/comments
```

得たコメント `id` を、上の GraphQL の `databaseId` と突き合わせて対象スレッドを特定する。

### 返信（REST）

スレッドの先頭コメント `id`（= `databaseId`）に対して返信する:

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/comments/<comment-id>/replies \
  -f body="<返信本文>"
```

### 解決（GraphQL）

返信を投稿した後に、スレッドを解決する:

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "<threadId>" }) {
    thread { isResolved }
  }
}'
```

## 妥当性の判断ガイド

レビュー指摘を機械的に全部直すのでも、全部はねるのでもなく、コードの事実に基づいて 1 件ずつ判断する。

- 指摘がコードの現状と合致し、バグ・リスク・可読性などの**実害**があるか
- 既に別の仕組みで緩和されている場合は、修正せずその根拠を返信する
- 外部ツール / API / ライブラリの**仕様**に関する factual な指摘（特に「常に壊れる／失敗する」系）は、適用前に一次情報（公式 doc・実出力・テスト）で真偽を裏取りする。自信ありげな誤指摘をそのまま「修正」すると、それ自体がリグレッションになる
- 修正方針が複数あり影響が大きい、妥当性がコードだけでは判断できない、設計判断が絡む場合は、勝手に直さずユーザーに確認する
- 修正は「妥当かつ必要」と判断した場合のみ行う

## commit の扱い（`--push` 時）

- commit message は「ブランチ運用・commit 規約の参照」で解決した規約に従う（commit-msg 検証＝commitlint/lefthook 等がリポジトリにあればそれにも従う）
  - 検証に body の行長上限がある場合はそれを守る。長い本文は `git commit -F <file>` で渡す
- 無関係な変更を同じ commit に混ぜない。レビュー対応で触ったファイルだけを stage する
- commit 時に pre-commit フック（lefthook 等）や kaizen のコミット前ゲートが設定されていれば走る。ゲートでブロックされた場合は指示に従って `kaizen --current` を実行してから再 commit する
- commit の `--amend` と force push は行わない

## レビュー対応後の Copilot 再レビュー依頼

レビュー対応（返信・解決）を終えたら、**Copilot 再レビュー依頼の要否・タイミングをユーザーに確認する**。
GitHub 側の自動レビュー設定があっても push 後に Copilot レビューが始まらないことがあり、また
push せず返信だけで閉じたスレッドも改めて見てほしいことがあるため、このスキルから明示的に依頼する。

**この確認は作業の完了条件である。** push の有無を問わず、確認して選択に応じた処理を終えるまで
final response してはいけない。依頼に使う login や検証手順は後述「Copilot へレビューを再依頼する」を参照する。

ただし確認に先立ち、push が発生した場合は**自動レビュー依頼**が既に走っていないかをタイムラインで確認する
（リポジトリ設定により push に連動して Copilot へ自動で再依頼されることがある・実測。確認コマンドは後述
「Copilot へレビューを再依頼する」の `review_requested` イベント）。push 以降の Copilot 宛依頼イベントが既にあれば、
改めて依頼せずその旨をユーザーに伝え、依頼要否の確認は省略してレビュー結果の確認へ進む。

選べる選択肢は、リモートの HEAD が再レビュー可能な状態かで変わる。

- **push が発生した場合**（`--push`、または `--push` なしで対応後にユーザー指示で push した場合）:
  新しい HEAD を対象に、CI と並行でレビューしたいこともあるのでタイミングを固定せず次の 3 択で選んでもらう。
  - **今すぐ依頼**: CI の完了を待たず、すぐ Copilot に再依頼する（CI と並行でレビュー）。
  - **CI 完了後に依頼**: CI の成功を確認してから依頼する（壊れた変更でレビューを促さない）。
  - **依頼しない**: 再依頼しない。
- **push が発生しない場合**（返信・解決だけで終わり、コード修正もない）:
  リモートの HEAD は変わらず新たな CI 実行もないため、「CI 完了後」は出さず次の 2 択で選んでもらう。
  - **今すぐ依頼**: 既存 HEAD を対象に Copilot へ再依頼する。
  - **依頼しない**: 再依頼しない。

ただし `--push` 未指定でファイル修正があり commit / push 待ちの場合は、まだ確認しない。
未 push のコードに再レビューを促すとリモートの古い HEAD がレビュー対象になるため、
commit / push が済んでから上の「push が発生した場合」として確認する。

### 「CI 完了後に依頼」を選んだ場合のみ、先に CI を待って確認する

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- 全チェックの完了まで待ち、すべて成功なら終了コード 0、いずれか失敗なら非 0 で終わる。
- 失敗した場合は **依頼を出さず**、失敗内容をユーザーに通知して止まる（先に CI を直す）。
- push 直後はチェック未登録で `no checks` と即時に返ることがある。その場合は数秒待ってから再確認する。

### Copilot へレビューを再依頼する

「今すぐ依頼」（push の有無を問わない）ならそのまま、「CI 完了後に依頼」なら CI 成功の確認後に実行する:

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/requested_reviewers \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

- 依頼用の login は **`copilot-pull-request-reviewer[bot]`**（Bot の login、`[bot]` 付き）。既に依頼中でも冪等。
- **注意**: 表示名の `Copilot` や slug の `copilot-pull-request-reviewer` を渡してはいけない。前者は 200 が返るのに無言で無視され（未登録）、後者は 422 になる。必ず `[bot]` 付き login を使う。
- 依頼後、依頼が成立したことを**必ず確認**する。ただし **`reviewRequests`（REST の `requested_reviewers`）が空でも不成立と断定しない**。Copilot はレビュー着手時に依頼を即時消費するため、正常に成立していても空になり得る（実測）。
- 成立はタイムラインの **Copilot 宛** `review_requested` イベントで確認する（過去に別レビュアーへ依頼した履歴を誤って成立と数えないよう
  `requested_reviewer` で絞る。login は REST 表記の `Copilot`）:

  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<番号>/timeline \
    --jq '.[] | select(.event=="review_requested" and .requested_reviewer.login=="Copilot") | {created_at, requested_reviewer: .requested_reviewer.login}'
  ```

- タイムラインでも確認できず、上限つきポーリングでレビュー到着も確認できなければ、不成立としてその旨をユーザーに通知する。

## 追加確認が必要な条件

以下のときだけ処理を止めてユーザーに確認する。

- 現在の repo と PR の owner / repo が一致しない
- 現在のブランチが PR の head ブランチと異なる
- 指摘の妥当性がコードだけでは判断できない
- 修正方針が複数あり、実装に大きく影響する
- レビュー対応後の Copilot 再レビュー依頼の要否・タイミング（push 時は 今すぐ / CI 完了後 / 依頼しない、push なしは 今すぐ / 依頼しない）
