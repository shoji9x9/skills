# レビューツールの選択と再レビュー依頼

このスキルは、レビュー対応後に AI レビュアーへ再レビューを依頼する。どのツールに依頼するかは
`.config/skills/shoji9x9/skills.yml` の `skills.common.review_tool` で選ぶ。姉妹スキル
（pr-review-handle / pr-finalize-loop）は同じレビュアーを使う想定のため設定は `common` に置き、両者で共有する。

## 設定の解決

- `skills.common.review_tool` を読む。値は次の 4 つ:
  - `copilot`（**既定**）: GitHub Copilot。`requested_reviewers` API に bot login を渡して依頼する。
  - `claude-code`: Claude Code。トップレベル PR コメントの mention で依頼する。
  - `codex`: OpenAI Codex。トップレベル PR コメントの mention で依頼する。
  - `none`: AI レビュアーへの再依頼をしない（人間レビューのみのリポジトリ向け）。
- **未設定なら `copilot` を既定として使い**、その旨をユーザーに通知する（次回以降のために設定作成を促してよい）。
- **作成・追記はユーザー了承のうえ非破壊で行う**（`references/conventions.md` の設定ファイルの扱いと同じ要領）:
  設定ファイルの新規作成・追記はファイル作成という副作用を伴うため、**通知 → 了承 → 作成/追記**の順を守る
  （設定が無いまま起動したときは既定 `copilot` で進めつつ設定作成の要否を確認し、勝手に書き込まない）。
  了承を得たら、ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、`skills.common.review_tool` だけを書く。
  既にあれば欠けたキーだけを `common` セクション（無ければ親も）に追記し、既存のキー・値・コメントは変更しない。
  値が既にあれば尊重し上書きしない。
- 導入時に一度選ぶ想定。値を変えたいときはユーザーが正本の `.config/skills/shoji9x9/skills.yml` を直接編集する（このドキュメントではない）。

```yaml
version: 1
skills:
  common:
    review_tool: copilot # copilot | claude-code | codex | none
```

## ツール別の再レビュー依頼

依頼を出す条件・タイミング・依頼後の待機（上限つきポーリング）・進行中レビューの扱いは各 SKILL の
オーケストレーションに従う。ここでは**「どう依頼し、成立をどう確認するか」**だけをツール別に定義する。
`copilot` 以外の bot が投稿するレビュー／コメントの login は導入した GitHub App 依存で固定名を前提にしない。
HEAD レビュー済み判定・レビュー進行中の検出は、次の汎用シグナルで扱う（ツール固有の login に依存しない）:
現在の HEAD への**非著者レビューの到着**、レビューエージェントの **bot コメント**、レビュー用の **check-run**。
pr-finalize-loop はこれを「レビュー進行中の検出」節で詳述する。pr-review-handle は専用節を持たないため、
この汎用シグナル（直近の push 以降に現れた非著者レビュー／bot コメント）を直接使う。

### copilot

`requested_reviewers` API に bot login を渡して依頼する（既に依頼中でも冪等）:

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/requested_reviewers \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

- 依頼用の login は **`copilot-pull-request-reviewer[bot]`**（`[bot]` 付き）。表示名 `Copilot` や slug
  `copilot-pull-request-reviewer` を渡してはいけない（前者は 200 が返るのに無言で無視され、後者は 422）。
- 著者 login は API で表記が異なる: REST では `Copilot`、GraphQL では `copilot-pull-request-reviewer`、
  依頼用は `copilot-pull-request-reviewer[bot]`。
- 成立確認: **`requested_reviewers` が空でも不成立と断定しない**（Copilot は着手時に依頼を即時消費するため
  正常でも空になり得る・実測）。タイムラインの **Copilot 宛** `review_requested` イベント（REST 表記 `Copilot`）で確認する:

  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<番号>/timeline \
    --jq '.[] | select(.event=="review_requested" and .requested_reviewer.login=="Copilot") | {created_at, requested_reviewer: .requested_reviewer.login}'
  ```

- リポジトリ設定により PR 作成時・push 時に**自動でこの依頼**が走ることがある（実測）。基準時刻より後の
  Copilot 宛 `review_requested` があり、その HEAD への非著者レビューがまだ無ければ自動依頼済み・進行中とみなし、
  重ねて依頼しない（最新イベントの日時だけで判定せず、過去 HEAD への依頼を根拠にしない）。
- 出典: `requested_reviewers` REST API <https://docs.github.com/en/rest/pulls/review-requests>、
  成立確認に使う issues timeline API（`event` / `requested_reviewer.login` 等のレスポンス形状）
  <https://docs.github.com/en/rest/issues/timeline>

### claude-code

**トップレベルの PR コメント**（インライン diff コメントではない）に `@claude review` を投稿して依頼する:

```bash
gh api --method POST \
  repos/<owner>/<repo>/issues/<番号>/comments \
  -f body="@claude review"
```

- Claude Code の GitHub App / Action が `@claude review` を検出してレビューを投稿する。`requested_reviewers` は使わない。
- **`-f`（raw-field）で渡す**。`-F`（field）だと先頭 `@` をファイル参照と解釈するため使わない。本文は固定リテラル。
- 成立確認・進行中・レビュー到着判定は各 SKILL の汎用シグナル（非著者レビュー・bot コメント・check-run）に従う。
  bot の login（例 `claude[bot]`）は導入した App 依存のため固定名を前提にしない。
- 出典: Claude Code の code review 設定 <https://support.claude.com/en/articles/14233555-set-up-code-review-for-claude-code>
  （manual trigger はトップレベルコメントの `@claude review`）、GitHub Actions
  <https://code.claude.com/docs/en/github-actions>

### codex

**トップレベルの PR コメント**に `@codex review` を投稿して依頼する:

```bash
gh api --method POST \
  repos/<owner>/<repo>/issues/<番号>/comments \
  -f body="@codex review"
```

- Codex が `@codex review` を検出してフォーマルなレビューを投稿する（👀 リアクション後にレビュー）。
  **必ず `@codex review`**（`review` 以外の mention は cloud chat 起動など別動作になる）。`requested_reviewers` は使わない。
- claude-code と同じく `-f` で渡す。成立確認・進行中・到着判定は各 SKILL の汎用シグナルに従う。
- 出典: Codex code review in GitHub <https://developers.openai.com/codex/integrations/github>

### mention 方式（claude-code / codex）の依頼は冪等でない

`requested_reviewers`（copilot）と違い、mention コメントの投稿は**冪等でない**。同じ依頼を再投稿すると
新しいレビューが重ねて起動し、余計なレビュー実行・コメントを生む。**現在の HEAD の push 以降に投稿された
`@claude review` / `@codex review` コメントが（投稿者を問わず）既にあれば、それを「この HEAD 向けに依頼済み・進行中」
とみなして再投稿しない**（copilot のタイムライン `review_requested` に相当する、この HEAD 向けの依頼済みシグナル。
人間が手動で mention した場合も依頼済みとして扱い、重複起動を避ける）。この依頼コメントは bot ではなく通常アカウントの
投稿のため、bot コメントの進行中シグナルには現れない点に注意する。依頼前に issue コメントを取得し、
`@<tool> review` コメント（投稿者を問わない）を列挙する。**列挙結果の `created_at` を push 完了時刻と比較し、
それ以降のものだけを「依頼済み」とみなす**（古い mention を誤って依頼済みと判定しないため）。
`gh api` の `--jq` は jq の `--arg` を受け取れないため、時刻比較は jq 側でなく列挙後にエージェント側で行う
（copilot 経路の `review_requested` 基準時刻比較と同じ扱い）:

```bash
gh api --paginate repos/<owner>/<repo>/issues/<番号>/comments \
  --jq '.[] | select(.body | test("^@(claude|codex) review")) | {login: .user.login, created_at, body: .body[:60]}'
```

### none

- AI レビュアーへの再レビュー依頼を**一切行わない**。未解決スレッドの返信・解決は通常どおり行う。
- 収束・完了判定から「HEAD がレビュー済み」条件を外す（CI 全成功かつ未解決スレッド無しで完了とする）。
- 再依頼の要否確認（pr-review-handle）や push 後の再依頼（pr-finalize-loop）は行わない。
