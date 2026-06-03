---
description: GitHub PR のレビューコメント対応を `gh` で標準化するスキル。PR URL / PR 番号 / レビュー URL を受け取り、未解決レビュースレッドの確認・指摘の妥当性判断・必要な場合のみ修正・返信・解決（resolve）までを段階的に進める。全レビュアー（Copilot を含む）が対象。「レビューに対応して」「Copilot のレビューを処理して」「レビューコメントを解決して」「pr-review-handle」や、`--push` を伴う依頼で必ず発動する。ブランチ作成や Issue 着手は姉妹スキル issue-start が担う。
license: MIT
name: pr-review-handle
---
# PR Review Handle

GitHub PR のレビューコメント対応を `gh` で標準化する。ブランチ運用・commit 規約は `AGENTS.md` の「ブランチ運用」に従う。

レビューコメントは「指摘を確認し、妥当なら直し、直さないなら理由を述べ、いずれにせよ返信して議論を閉じる」までが 1 セットだ。返信や解決を忘れるとレビュアーは対応状況を追えない。このスキルはその一連を取りこぼさないために、確認 → 判断 → （必要時のみ）修正 → 返信 → 解決の順を固定する。

## 入力

- 次のいずれかで対象 PR を指定する:
  - PR URL（`https://github.com/<owner>/<repo>/pull/<番号>`）
  - PR 番号のみ（現在の repo を対象にする）
  - レビュー URL（`https://github.com/<owner>/<repo>/pull/<番号>#pullrequestreview-<review-id>`）
- 任意モード（省略可）:
  - `--push`: 一連の対応後に commit・push まで行う

モードが明示されていない場合は **commit 手前で停止し、変更内容をユーザーに通知する**（commit / push はしない）。

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
6. 全スレッドを処理したら、モードに応じて締める（下表）

**返信していないスレッドは解決しない。** 必ず「返信 → 解決」の順を守る。解決はレビュアーへの「対応済み」の合図であり、根拠の提示なしに閉じると議論の経緯が追えなくなる。

## モード別フロー

| モード | 挙動 |
| --- | --- |
| 省略時 | 全スレッドの返信・解決まで行い、ファイル修正があっても **commit / push はしない**。変更ファイル一覧と「commit が必要なこと」「`--push` で再実行できること」をユーザーに通知して止まる |
| `--push` | 上記に加え、関連ファイルだけを stage し、論理単位で commit、push する。push 後は **Copilot 再レビュー依頼のタイミングをユーザーに確認**して依頼する（後述） |

`--push` は commit・push の実行をユーザーが明示的に委譲した合図として扱う。指定がない限り commit しない。

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
未解決スレッド数は PR 単位で実用上限定的なので全件取得してよい（大量になりうる一覧は
`AGENTS.md`「API 取得のページネーション」のとおり逐次処理・早期終了する）。
先頭コメントの `databaseId` を返信先に使う。

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
- 修正方針が複数あり影響が大きい、妥当性がコードだけでは判断できない、設計判断が絡む場合は、勝手に直さずユーザーに確認する
- 修正は「妥当かつ必要」と判断した場合のみ行う

## commit の扱い（`--push` 時）

- commit message は conventional commits 規約（`feat:` / `fix:` / `docs:` など）に従う。このリポジトリでは commitlint と lefthook の commit-msg フックで検証される
  - commitlint の body は **1 行 100 文字以内**。長い本文は `git commit -F <file>` で渡す
- 無関係な変更を同じ commit に混ぜない。レビュー対応で触ったファイルだけを stage する
- commit 時は lefthook の pre-commit と、設定されていれば kaizen のコミット前ゲートが走る。ゲートでブロックされた場合は指示に従って `kaizen --current` を実行してから再 commit する
- commit の `--amend` と force push は行わない

## push 後の Copilot 再レビュー依頼

push が発生したとき（`--push` 指定の有無を問わない。push していなければ何もしない）、
**Copilot 再レビュー依頼のタイミングをユーザーに確認する**。GitHub 側の自動レビュー設定があっても
push 後に Copilot レビューが始まらないことがあるため、このスキルから明示的に依頼する。
CI が長い場合は CI と並行でレビューしたいこともあるので、タイミングは固定せず次の 3 択で選んでもらう。

- **今すぐ依頼**: CI の完了を待たず、すぐ Copilot に再依頼する（CI と並行でレビュー）。
- **CI 完了後に依頼**: CI の成功を確認してから依頼する（壊れた変更でレビューを促さない）。
- **依頼しない**: 再依頼しない。

### 「CI 完了後に依頼」を選んだ場合のみ、先に CI を待って確認する

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- 全チェックの完了まで待ち、すべて成功なら終了コード 0、いずれか失敗なら非 0 で終わる。
- 失敗した場合は **依頼を出さず**、失敗内容をユーザーに通知して止まる（先に CI を直す）。
- push 直後はチェック未登録で `no checks` と即時に返ることがある。その場合は数秒待ってから再確認する。

### Copilot へレビューを再依頼する

「今すぐ依頼」ならそのまま、「CI 完了後に依頼」なら CI 成功の確認後に実行する:

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/requested_reviewers \
  -f "reviewers[]=Copilot"
```

- 依頼用の reviewer login は `Copilot`（Bot）。既に依頼中でも冪等に扱える。
- 依頼が失敗した場合（Copilot レビューが未設定など）は、その旨をユーザーに通知する。
- 依頼後、Copilot が requested_reviewers に登録されたことを確認してユーザーに通知する。

## 追加確認が必要な条件

以下のときだけ処理を止めてユーザーに確認する。

- 現在の repo と PR の owner / repo が一致しない
- 現在のブランチが PR の head ブランチと異なる
- 指摘の妥当性がコードだけでは判断できない
- 修正方針が複数あり、実装に大きく影響する
- push 後の Copilot 再レビュー依頼のタイミング（今すぐ / CI 完了後 / 依頼しない）

## 例

- `pr-review-handle https://github.com/<owner>/<repo>/pull/6`
- `pr-review-handle 6 --push`
- `pr-review-handle https://github.com/<owner>/<repo>/pull/6#pullrequestreview-4414201665`
