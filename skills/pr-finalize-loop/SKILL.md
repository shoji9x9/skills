---
name: pr-finalize-loop
description: 作成済み GitHub PR の CI エラー解消とレビュー指摘対応を、CI が成功しレビュー指摘が尽きるまで自律ループで回すスキル。PR URL を受け取り、CI 失敗の修正・レビュースレッドの返信/解決・commit/push・設定したレビューツール（Copilot/Claude Code/Codex/none）への再レビュー依頼を反復する。ループ中はユーザー確認を挟まず自律動作するが、人間判断を要する指摘だけは確認し、反映後にループへ戻る。`--max-iterations`（既定 5）で無限ループを防ぐ。レビュー対応単体は姉妹スキル pr-review-handle が担う。「PR を最後まで解決して」「CI とレビュー指摘がなくなるまで回して」「PR の CI とレビューを収束させて」「pr-finalize-loop」で必ず発動する。
argument-hint: "<PR URL> [--max-iterations <N>] [--wait-ci-before-review]"
license: MIT
---

# Pr Finalize Loop

作成済みの GitHub PR を、**CI が成功し未解決のレビュー指摘が無くなるまで自律的に収束させる**。CI 失敗の修正・レビュー指摘への返信と解決・commit/push・設定したレビューツールへの再レビュー依頼という決まった往復を、人手で何度も繰り返す代わりにループで回す。PR 自体の作成はこのスキルの対象外（別途行う）。

この往復は「直す → push → CI とレビューが再び走る → また直す」を収束まで続けるもので、止め時を誤ると無限に回る。
だから本スキルは **(1) ループ中はユーザー確認を挟まず自律で進める、(2) 例外として人間判断を要するレビュー指摘だけは確認して反映後に復帰する、(3) 最大反復回数・行き詰まり検知という安全弁で必ず停止する** の 3 点を固定する。
レビュー対応 1 回分の確認・返信・解決の作法は姉妹スキル [[pr-review-handle]] と同じで、本スキルはそれを自律ループとして束ねる。

## 使い方

```text
pr-finalize-loop <PR URL> [--max-iterations <N>] [--wait-ci-before-review]
```

- `<PR URL>`（必須）: `https://github.com/<owner>/<repo>/pull/<番号>`。番号だけが渡された場合は現在の repo の PR とみなす
- `--max-iterations <N>`（任意, 既定 5）: ループの最大反復回数。無限ループ防止の安全弁。1 反復＝「状態取得 → CI/レビューを直す → commit/push → 再実行待ち」の 1 周
- `--wait-ci-before-review`（任意, 既定オフ）: push 後の再レビュー依頼を、CI 再実行の完了を待ってから出す。**既定（オフ）では push 直後に CI 完了を待たず依頼し、CI とレビューを並行させる**（収束を速める。レビュー進行中＝設定ツールの自動レビュー・別エージェントとも＝は保留する）。壊れた HEAD にレビューを促したくない場合だけ指定する
- ループ中はユーザー確認を挟まず自律で進める（唯一の例外は後述「自律性ポリシー」の人間判断を要するレビュー指摘）

例: `pr-finalize-loop https://github.com/<owner>/<repo>/pull/6` / `pr-finalize-loop 6 --max-iterations 3` / `pr-finalize-loop 6 --wait-ci-before-review`

- 自然文でも発動する:「PR を最後まで解決して」「CI とレビュー指摘がなくなるまで回して」「PR の CI とレビューを収束させて」。

## 前提

- **ツール**: `gh`（GitHub CLI。`gh api graphql` / `gh pr checks` / `gh run view` を含む）, `git`
- **前提スキル**: なし（レビュー対応の作法は [[pr-review-handle]] と共通だが、本スキルは自律版を内蔵し単体で動く）
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要（CI を直すための修正で対象リポジトリのランタイムが要ることはある）。

## ブランチ運用・commit 規約の参照

ブランチ運用・commit 規約はリポジトリごとに異なる。解決手順（設定ファイル → 標準ドキュメント探索 → ユーザー確認）と設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは [`references/conventions.md`](references/conventions.md) を参照する。
`--amend` / force push をしない・関連ファイルだけを stage する・長い commit 本文は `git commit -F <file>` で渡す、といった汎用の操作メカニクスは規約解決の結果に依らず常に守る。

## レビューツールの選択

push 後などに再レビューを依頼する AI レビュアーは設定で選ぶ。設定キー（`skills.common.review_tool`、
既定 `copilot`）とツールごとの依頼・成立確認の具体手順は [`references/review-tool.md`](references/review-tool.md) を参照する。
値は `copilot` / `claude-code` / `codex` / `none`。**`none` の場合は再レビュー依頼を一切行わず、収束・完了判定から
「HEAD がレビュー済み」条件を外す**（CI 全成功かつ未解決スレッド無しで完了）。以降の本文で「レビュー依頼」と言うときは
設定した `review_tool` への依頼を指す。

## 自律性ポリシー

- **ループ中は確認なしで自律実行する。** CI 失敗の修正・レビュー指摘の返信/解決・commit/push・レビューツールへの再依頼を、ユーザーに逐一確認せず進める。
- **唯一の例外＝人間判断を要するレビュー指摘**: 妥当性がコードだけでは判断できない／修正方針が複数あり影響が大きい／設計判断が絡む指摘は、勝手に直さず・誤った解決もせず、その 1 件だけユーザーに判断を仰ぐ。**判断を反映したら（修正 or 不要の根拠を返信して解決）ループに戻り、収束まで続ける**（この確認で打ち切らない）。
- **着手前のハード前提チェック**（満たさなければ着手せず中断・報告）。自律で commit/push するため、対象を取り違えると危険ゆえに必ず先に確認する:
  - PR が OPEN である（`MERGED` / `CLOSED` なら仕上げ対象なしとして報告して終了。head ブランチが消えていることがあるため最初に判定する）
  - 現在の repo と PR の owner/repo が一致する
  - 現在のローカルブランチが PR の head ブランチと一致する

## 基本フロー

着手前のハード前提チェックを通過したら、`iteration = 1` から `--max-iterations`（既定 5）まで以下を繰り返す。

1. **状態取得**（この段階ではレビュー依頼をしない。待機の間隔・上限は後述「ポーリングと待機」に従う）
   - CI: `gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast` で完了を待つ（いずれかが失敗した時点で抜ける）。push 直後にチェック未登録で `no checks` と即時に返ることがあるため、その場合は間隔を空けて数回まで再確認する
   - 未解決レビュースレッド: 後述の GraphQL を `--paginate` で全取得し `isResolved == false` で絞る（**全レビュアーが対象**。著者で絞らない）
   - 現在の HEAD がレビュー済みかを判定する（後述「HEAD のレビュー済み判定」）
   - レビュー進行中の検出: 現在の HEAD への未消化のレビュー依頼（PR 作成時・push 時の**自動依頼**を含む）や進行中のレビューエージェントがないかを確認する
     （後述「レビュー進行中の検出」）。進行中なら依頼せず上限つきで結果を待ち、到着分を反映してから判定する
   - レビュー内容との整合検証: HEAD への非著者レビューがコメントを生成しているのに reviewThreads から取得できない場合は反映ラグとみなし、
     間隔を空けて再取得する（後述「レビュー内容との整合検証」）
2. **収束判定（依頼より先に評価する）**: CI が全成功 **かつ** 未解決スレッドが無い **かつ** 現在の HEAD がレビュー済み **かつ** レビュー内容との整合検証を通過 → **完了**。サマリーを報告して終了する。**既に CI・レビューが揃った PR はこの時点でレビュー依頼もせず無害に終わる**。
   **`review_tool: none` の場合は「HEAD がレビュー済み」を条件にせず**、CI 全成功かつ未解決スレッド無しで完了とする（以降の依頼手順もスキップ）
   - CI 全成功 かつ 未解決スレッド無しだが **HEAD が未レビュー**の場合のみ（`review_tool: none` を除く）、後述「レビュー進行中の検出」を通過してから、設定したレビューツールにレビューを依頼して上限つきで待つ（後述「再レビュー依頼」）。レビューが付けば次反復で拾い、上限までに付かなければレビュー未着のまま完了として、その旨を明記して報告する
3. **CI 失敗の修正**: 失敗したチェックのログを取得（後述）し、原因をコードの事実に照らして分析して修正する。直せない／同じ失敗が前反復から改善しない場合は「行き詰まり」（後述「停止条件」）へ
4. **レビュー指摘の解消**（1 スレッドずつ）
   1. 該当 `path` の `line` 付近を Read し、指摘内容を**コードの事実に照らして評価**する
   2. 妥当かつ要修正 → 対象ファイルを修正する。不要 → 直さない根拠を用意する（例: 既に別の仕組みで緩和済み、指摘が事実と異なる、設計判断として意図的）
   3. スレッドに**返信**してから**解決**する（順序厳守。返信していないスレッドは解決しない）
   4. **人間判断を要する場合**は、ここで修正も解決もせずユーザーに判断を仰ぐ。判断を反映して返信・解決したうえでループを続ける
5. **commit / push**: 手順 3・4 を**両方終えてから**まとめて行う。レビュー対応・CI 修正で触ったファイルだけを stage し、論理単位で conventional commit、push する（無関係な変更を混ぜない）。コード修正が無ければ commit/push はしない
6. **push 後の追従**（`review_tool: none` の場合はこの手順ごとスキップ）: push 直後の新しい HEAD は未レビューなので、レビューが確実に走る状態にする。まず push に連動した**自動レビュー**が発生していないかを確認する
   （後述「レビュー進行中の検出」。`copilot` はタイムラインの Copilot 宛 `review_requested` イベント、`claude-code` / `codex` は進行中の bot レビュー／コメント）。発生していればスキルからは依頼せず、そのレビュー結果を次反復で拾う。
   自動レビューが無い場合のみレビューツールへ再依頼する。依頼は**モードを問わず**後述「レビュー進行中の検出」を通過してから行う。**既定では CI 完了を待たずに依頼**し、CI 再実行の完了は次反復冒頭の手順 1 で待つ（CI とレビューが並行して進む）。
   `--wait-ci-before-review` 指定時のみ、push による CI 再実行の完了を待ってから、新しい HEAD が未レビューであれば依頼する。
   リポジトリに別のレビュー bot（CI から起動される auto-review 等）が**存在するだけ**では、それをレビューツール依頼の代替とみなして省略しない（進行中の場合の保留・再評価は検出に従う。保留は省略ではない）。HEAD がレビュー済みなら依頼しないのは収束判定どおり。**HEAD が未レビューのまま**依頼自体を省略してよいのは、ユーザーが明示的に指示した場合だけ
7. **行き詰まり検知**: この反復で「コード修正もレビュー対応も新たに行えなかった」かつ「CI 失敗が前反復と同じで改善していない」場合は停止する（後述「停止条件」）
8. `iteration` を 1 増やす。`--max-iterations` に達したら停止する

## 停止条件

いずれの場合も、終了時に **CI 状態・残った未解決スレッド・反復回数・停止理由**を要約して報告する。未解決スレッドを残して終わる場合でも、**虚偽の解決（中身に対応せず resolve）はしない**。

- **完了**: CI が全成功し、未解決スレッドが無く、HEAD がレビュー済み（またはレビュー出現待ちが上限に達した）。`review_tool: none` では HEAD レビュー済みを問わず CI 全成功かつ未解決スレッド無しで完了
- **最大反復到達**: `--max-iterations`（既定 5）に達した。残っている CI 失敗・未解決スレッドを明示する
- **行き詰まり**: 同じ CI 失敗が改善せず、新たに打てる手が無い。失敗内容と「どうすれば直せそうか」を報告する
- **仕上げ対象なし**（着手前に中断）: PR が OPEN でない（`MERGED` / `CLOSED`）
- **前提不一致**（着手前に中断）: repo 不一致 / 現在ブランチが PR の head と不一致

人間判断を要するレビュー指摘での確認は**停止条件ではない**（判断反映後にループへ戻る）。

## ポーリングと待機

待機は必ず**上限を設けて**行う（無限待ちと過剰ポーリングの両方を避ける）。具体の間隔・回数はリポジトリの CI 所要時間に応じて調整してよい。

- **CI 完了待ち**: `gh pr checks --watch` に委譲する（gh が内部でポーリングし完了までブロックする。間隔は `--interval <秒>`）。自前の短間隔ループで叩き続けない。
- **`no checks` の再確認**: push 直後の未登録は数回まで再確認し、登録されなければ「この HEAD では CI が走らない」とみなして CI 待ちを打ち切り収束判定へ進む（CI が無いこと自体は失敗ではない）。
- **レビュー出現待ち**（`--watch` 相当が無い）: レビュー依頼後、一定間隔で未解決スレッド/レビューの有無を再取得し、上限まで待つ。上限を超えたら**その反復はレビュー未着のまま閉じ**、CI 等の作業を進める（未着を報告に残す）。
- **進行中レビューの完了待ち**: 進行中（設定ツールの自動レビュー・別エージェントとも）を検出して依頼を保留した場合も上限つきポーリングで待つ。上限までに完了しなければ進行中シグナルを無効とみなして通常の依頼判断に戻り、その旨を報告に残す（ハングしたワークフローで収束を止めない）。

## 長時間実行・コンテキストの引き継ぎ

収束は時間がかかり、途中で auto-compaction（コンテキスト圧縮）が走り得る。耐えるため、状態は GitHub の実体から取り直す。

- **各反復は GitHub の実状態から再開可能**にする（手順 1 で CI 状態と未解決スレッドを取り直す。永続化済みの返信・解決から実状態を再構築できる）。
- **反復予算（`--max-iterations`）と行き詰まり検知だけはメモリに残りやすい**。「何反復目か・直近の CI 失敗の要点」を簡潔な進捗メモに残して再開の起点にする。メモを失ったら GitHub の実状態から現況を再導出し、**残作業が無ければ完了として安全側に倒す**（予算が曖昧なら追加反復せず現況を報告して止める）。

## gh メカニクス

全レビュアーが対象のため未解決スレッドやレビューの取得時に著者で絞る必要はない。`review_tool: copilot` を使う場合、Copilot の著者 login は API で表記が異なる
（REST では `Copilot`、GraphQL では `copilot-pull-request-reviewer`、依頼用は `copilot-pull-request-reviewer[bot]`）ため、依頼・検出ではこの差に注意する（詳細は [`references/review-tool.md`](references/review-tool.md)）。

### 着手前チェック（repo / head ブランチの一致）

```bash
gh pr view <番号> --repo <owner>/<repo> --json headRefName,baseRefName,url,state
git branch --show-current
```

- `state` が `OPEN` でなければ（`MERGED` / `CLOSED`）、仕上げ対象なしとして報告して終了する。head ブランチが削除済みのこともあるため、**ブランチ一致より先に判定する**。
- 現在の repo（`gh repo view --json nameWithOwner -q .nameWithOwner`）と PR の owner/repo が一致しなければ中断する。
- `headRefName` と現在のブランチが異なれば、修正対象を取り違えるため中断する。

### CI 状態の確認

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- 全チェックの完了まで待ち、すべて成功なら終了コード 0、いずれか失敗なら非 0 で終わる。
- push 直後はチェック未登録で `no checks` と即時に返ることがある。その場合は「ポーリングと待機」に従って再確認する。

### CI 失敗ログの取得（修正の手がかり）

失敗したチェック名と、対応する GitHub Actions run の失敗ログを取得して原因を絞る:

```bash
gh pr checks <番号> --repo <owner>/<repo> --json name,state,bucket,link \
  --jq '.[] | select(.bucket=="fail")'
gh run view <run-id> --repo <owner>/<repo> --log-failed   # 失敗ジョブのログだけ表示
```

- `bucket` は `state` を `pass`/`fail`/`pending`/`skipping`/`cancel` に分類する。`fail` は `FAILURE` / `ERROR` だけでなく
  `TIMED_OUT` / `ACTION_REQUIRED` / `STARTUP_FAILURE` も含むため、`state` を直接列挙するより失敗を取りこぼさない
  （キャンセルも拾うなら `or .bucket=="cancel"`）。`link` から run-id を取る。

- `link` から run-id を取り、`--log-failed` で失敗ステップのログに絞る。原因はコードの事実に照らして判断し、推測で広範囲を書き換えない。

### 未解決スレッドの取得（GraphQL・全ページ取得）

`threadId`（解決に必要）・解決状態・先頭コメントの `databaseId`（返信に必要）をまとめて得られる。未解決スレッドは 1 ページに収まらないことがあるため `--paginate` で全ページ取得する。

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

`isResolved == false` のスレッドだけを 1 件ずつ処理する。先頭コメントの `databaseId` を返信先に使う。

### 返信（REST）

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/comments/<comment-id>/replies \
  -f body="<返信本文>"
```

### 解決（GraphQL）

返信を投稿した後にスレッドを解決する:

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "<threadId>" }) {
    thread { isResolved }
  }
}'
```

### HEAD のレビュー済み判定

現在の HEAD（最新コミット）がレビュー済みかは、`headRefOid` と各レビューが対象にした commit を突き合わせて判定する。過去コミットへのレビューはあっても最新 push が未レビュー、という状態を取りこぼさないため。

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <番号>) {
      headRefOid
      author { login }
      reviews(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } state commit { oid } }
      }
    }
  }
}'
```

- レビューは `--paginate` で**全ページ取得**する。著者除外（次項）を前提にすると、著者の返信（COMMENTED レビュー）が直近に連なった場合に
  著者以外の HEAD レビューが `last: N` の窓から押し出され得るため、単発取得では「未レビュー」と誤判定して不要な再依頼につながる。
- **PR 著者（`pullRequest.author.login`）によるレビューは判定から除外する（必須）**。レビュースレッドへの返信は REST/GraphQL 上、著者の `state: COMMENTED` レビューとして記録され、その `commit.oid` が返信後の新しい HEAD を指し得る（実測）。
  除外しないと「修正 → 返信 → push」という本スキルの標準フローを回すたびに、誰にもレビューされていない新 HEAD が「レビュー済み」と誤判定され、レビュー再依頼が漏れる。
- **著者以外**のレビューのいずれかの `commit.oid` が `headRefOid` と一致すれば、現在の HEAD はレビュー済み。一致するものが無ければ最新 HEAD は未レビュー。
- 収束判定ではこの「HEAD レビュー済み」を条件に含める（`review_tool: none` を除く）。既済みならレビュー依頼をしない（既完了 PR に余計なレビュー活動を起こさない）。

### レビュー内容との整合検証（スレッド反映ラグ）

レビュー submit 直後は、レビュー自体（`reviews`）は取得できるのに `reviewThreads` へのコメント反映が遅れることがある（実測）。
未解決スレッド 0 件だけを根拠に「指摘なし」と判定すると、コメント付きレビューを取りこぼす。

レビューの取得は「HEAD のレビュー済み判定」と同じ全ページ取得クエリを流用し、`nodes` に `comments { totalCount }` と `body` を
加えて 1 回のクエリで両方を判定する。

- HEAD への**非著者**レビューの `comments.totalCount`（Copilot はレビュー本文の「generated N comments」でも確認できる・実測）が 1 以上なのに、
  そのレビュー由来のコメントが reviewThreads から取得できない場合は反映ラグとみなす。間隔を空けて再取得し（「ポーリングと待機」の上限に従う）、
  整合が取れるまで収束判定しない。
- 上限までに整合しない場合は「スレッド未反映の可能性」を残作業として明記して報告する（黙って「指摘なし」と結論しない）。

### レビュー進行中の検出

レビュー依頼の直前（収束判定時・push 後の追従時とも）と各反復の状態取得時に必ずこの検出を行い、進行中なら依頼せず結果を待つ。
対象は別エージェントに限らず、**設定したレビューツール自身の進行中レビュー（PR 作成時・push 時の自動レビューを含む）**も含める。

- **自動依頼シグナル（タイムライン、`review_tool: copilot` の場合）**: リポジトリ設定により PR 作成時・push 時に Copilot への自動レビュー依頼が行われることがある（実測）。
  Copilot 宛 `review_requested` イベントの `created_at` を**基準時刻と比較して現在の HEAD 向けか判定**し、基準時刻以降のイベントがあり、
  かつその HEAD への非著者レビューがまだ無ければ、依頼済み・レビュー進行中とみなして新たな依頼をしない。
  mention 方式（`claude-code` / `codex`）は `review_requested` を使わないため、自動レビューは下の補助シグナル（進行中の bot レビュー／コメント）で検出する。

  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<番号>/timeline \
    --jq '[.[] | select(.event=="review_requested" and .requested_reviewer.login=="Copilot")] | last | .created_at'
  ```

  - 最新イベントの日時だけでは判定できない。**基準時刻より後**の `created_at` だけを自動依頼の根拠にし、過去の HEAD への依頼イベント
    （PR 作成時など）で「自動依頼済み」と誤判定して再依頼をスキップしない。
  - 基準時刻は、push 起点（手順 6）では **push 完了直後に記録した時刻**を使う。ループ開始時など push 時刻を記録していない場合は
    **HEAD コミットの committedDate**（`git log -1 --format=%cI`）を下限として使う（`--amend`/force push を行わない前提で push はこれ以降）。

- **一次シグナル（チェックラン）**: 現在の HEAD の未完了チェックに、別エージェントのレビューを示すものがないかを見る。

  ```bash
  # review_tool: copilot のときは Copilot 自身のチェックを別エージェント判定から除外する。
  # copilot 以外（claude-code / codex / none）のときは末尾の `and .name!=...` を外し、除外しない。
  gh pr checks <番号> --repo <owner>/<repo> --json name,bucket,workflow \
    --jq '.[] | select(.bucket=="pending" and .name!="copilot-pull-request-reviewer")'
  ```

  - workflow 名・ジョブ名がレビューエージェントを示すもの（例: workflow「Claude Review」/ ジョブ `auto-review`）が `pending` なら進行中とみなす。名前はリポジトリごとに異なるため固定リストではなく名称から判断する。
  - **除外は `review_tool` で条件を変える**。`review_tool: copilot` のとき、Copilot 自身のチェック
    （チェック名 `copilot-pull-request-reviewer`・実測）は「別エージェント」ではなく **設定したレビューツールのレビュー進行中**の
    シグナルとして扱うため、上のコマンドで除外する（別エージェント判定から外す）。pending なら新たな依頼をせず完了を待つ。
  - `review_tool` が **copilot 以外**（`claude-code` / `codex` / `none`）のときは、Copilot は設定ツールではないので、
    pending の Copilot チェックは**別エージェントの進行中レビュー**にあたる。この場合は除外せず
    （jq の `and .name!="copilot-pull-request-reviewer"` を外す）進行中として扱い、保留して完了を待つ。
- **補助シグナル（bot の進行中コメント）**: チェックランとして現れないレビューエージェント（cloud 実行等）向け。bot による直近のコメントが作業中を示していないかを見る。評価対象は**現在の反復（直近の push 以降）に作成・更新されたレビューエージェントのコメントだけ**。レビューと無関係な bot（カバレッジ等）や古いコメントは進行中の根拠にしない。

  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<番号>/comments \
    --jq '.[] | select(.user.type=="Bot") | {login: .user.login, created_at, updated_at, body: .body[:200]}'
  ```

  - Claude GitHub Action は開始時にコメントを作成し、完了時に同じコメントを「finished」表記へ**編集**する（進行中は working 表記・実測）。進行中でもタスクリストの更新等で編集され `updated_at` は進むため、**編集の有無で完了とみなさず本文の表記で判定する**。文言は実装依存で変わり得るため、特定文字列の一致ではなく本文が作業中か完了かの趣旨で判断する。
- **push 直後の空振りに注意**: push 起点の依頼（手順 6）では、別エージェントのチェックが**未登録**・開始コメントが**未投稿**のせいで両シグナルが空になり得る（`no checks` と同じ現象）。両シグナルが空でも即「進行中でない」と確定せず、間隔を空けて数回再確認してから依頼する。
- **検出時の挙動**: レビュー依頼を出さず、上限つきポーリング（「ポーリングと待機」）でチェック完了・コメントの finished 化・レビュー到着のいずれかを待つ → 完了後に「HEAD のレビュー済み判定」と「レビュー内容との整合検証」を再評価 → それでも HEAD 未レビューの場合だけ依頼する。

### 再レビュー依頼

`review_tool: none` の場合は依頼しない（この手順ごとスキップ）。それ以外では、現在の HEAD が未レビュー、かつ進行中のレビュー（設定ツールの自動レビュー・別エージェントとも）が無いときだけ依頼する（上の「HEAD のレビュー済み判定」・前述「レビュー進行中の検出」）。
push が発生した反復では、**既定では push 直後（CI 再実行の完了を待たず）に依頼**し、CI とレビューを並行させる。
`--wait-ci-before-review` 指定時のみ、push・CI 再実行の完了を待ってから依頼する（壊れた HEAD でレビューを促さない従来挙動）。
既定では CI 失敗が判明した HEAD にレビューが付き得るが、修正・再 push で新しい HEAD にレビューが再依頼されるため無害。

依頼と成立確認の具体手順は設定した `review_tool` ごとに異なる（[`references/review-tool.md`](references/review-tool.md)）:

- `copilot`: `requested_reviewers` API に `copilot-pull-request-reviewer[bot]` を渡す。成立はタイムラインの Copilot 宛 `review_requested` イベントで確認する（`requested_reviewers` が空でも即不成立としない・実測）。
- `claude-code` / `codex`: トップレベル PR コメントに `@claude review` / `@codex review` を投稿して依頼する。成立は依頼コメントの投稿と、以降の進行中 bot レビュー／コメント・レビュー到着で確認する。

- タイムライン等で確認できない場合も、上限つきポーリング（「ポーリングと待機」）でレビュー到着自体を待てば成立を確認できる。どちらでも確認できなければ不成立として報告する。
- レビューが付くまでの待機は「ポーリングと待機」の上限つきポーリングに従い、ハングさせない。

## commit の扱い

- commit message は「ブランチ運用・commit 規約の参照」で解決した規約に従う（commitlint/lefthook 等の commit-msg 検証があればそれにも従う。body の行長上限があれば守り、長い本文は `git commit -F <file>` で渡す）。
- 無関係な変更を同じ commit に混ぜない。CI 修正・レビュー対応で触ったファイルだけを stage する。既存 worktree に無関係な差分があれば巻き込まない。
- pre-commit フック（lefthook 等）や kaizen のコミット前ゲートがあれば走る。ゲートでブロックされたら指示に従って `kaizen --current` を実行してから再 commit する。
- commit の `--amend` と force push は行わない。

## 妥当性の判断ガイド

CI 失敗もレビュー指摘も、機械的に全部直すのでも全部はねるのでもなく、事実に基づいて 1 件ずつ判断する。

- レビュー指摘がコードの現状と合致し、バグ・リスク・可読性などの**実害**があるか。既に別の仕組みで緩和済みなら、修正せず根拠を返信する
- 外部ツール / API / ライブラリの**仕様**に関する指摘（特に「常に壊れる／失敗する」系）は、適用前に一次情報（公式 doc・実出力・テスト）で裏取りする。自信ありげな誤指摘をそのまま「修正」するとそれ自体がリグレッションになる
- CI 失敗は失敗ログの事実から原因を特定して直す。フレーキーが疑われる場合も、まず再実行や原因確認で切り分け、テストやコードの実バグを取り違えない
- 修正方針が複数あり影響が大きい、妥当性がコードだけでは判断できない、設計判断が絡む場合は「人間判断を要する指摘」として扱い、その 1 件だけユーザーに確認してからループに戻る

## 追加確認が必要な条件

ループ中は自律で進めるが、以下のときだけ確認する（前者 2 つは停止、最後の 1 つは確認後ループ復帰）。

- 現在の repo と PR の owner/repo が一致しない（着手前に中断）
- 現在のローカルブランチが PR の head ブランチと異なる（着手前に中断）
- レビュー指摘の妥当性がコードだけでは判断できない／修正方針が複数あり影響が大きい／設計判断が絡む（その 1 件を確認し、反映後にループへ戻る）
