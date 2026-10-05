# レビューツールの選択と再レビュー依頼

このスキルは、レビューに対応した後、AI レビュアーに再レビューを依頼する。
姉妹スキルの pr-review-handle と pr-finalize-loop は、同じ解決規則を使う。

## 設定の解決

次の優先順位で、最初に設定されている値を使う。
受け付ける値は `copilot`・`claude-code`・`codex`・`none` の 4 つだけで、それ以外の値なら、警告なしにデフォルトの値を使うことはせず止まる。

1. pr-finalize-loop の `--review-tool <tool>`
2. 環境変数 `SKILLS_REVIEW_TOOL`
3. `.config/skills/shoji9x9/skills.yml` の `skills.common.review_tool`
4. デフォルトの `copilot`

| 値 | 意味 |
| --- | --- |
| `copilot`（デフォルト） | GitHub Copilot。`requested_reviewers` API に bot の login を渡して依頼する |
| `claude-code` | Claude Code。PR のトップレベルのコメントで mention して依頼する |
| `codex` | OpenAI Codex。PR のトップレベルのコメントで mention して依頼する |
| `none` | AI レビュアーに再レビューを依頼しない。人だけがレビューするリポジトリ向け |

- どれも設定されていなければ、デフォルトの `copilot` を使い、そのことを利用者に知らせる。
- pr-review-handle は CLI のオプションを持たないが、環境変数から下は同じ優先順位を使う。
- 設定ファイルを作ったり追記したりするのは、利用者の了承を得てからにし、既存の内容は変えない（`references/conventions.md` の設定ファイルの扱いと同じ）。
  ファイルを作るのは副作用なので、まず知らせ、了承を得てから、作るか追記する。
  設定が無いまま起動したときは、デフォルトの `copilot` で進めながら設定を作るかを確かめ、確かめずに書き込まない。
- 了承を得たら、ファイルが無ければ `.config/skills/shoji9x9/` ごと作り、`skills.common.review_tool` だけを書く。
  ファイルがあれば、欠けているキーだけを `common` の節に追記する。節が無ければ親の節も足す。
  既存のキー・値・コメントは変えない。値が既にあればそれに従い、上書きしない。
- 共有のデフォルトを変えるときだけ、原本の `.config/skills/shoji9x9/skills.yml` を編集する。一時的に切り替えるなら、CLI のオプションか環境変数を使う。

```yaml
version: 1
skills:
  common:
    review_tool: copilot # copilot | claude-code | codex | none
```

### 解決は同梱スクリプトで行う（値と出所を表示してから使う）

何層もある解決の順序を頭の中でたどると、原本を読む前に環境変数の名前を推測して「未設定」と判定してしまう。
実際に、別のツールへ 3 回依頼したことがある。
着手したら同梱スクリプトを実行し、値と、それがどの層から来たかを報告してから使う。

```bash
# インストール先に合わせて、どちらかのパスで実行する（--review-tool は pr-finalize-loop だけ）
bash .agents/skills/<skill>/scripts/resolve-review-tool.sh [--review-tool <tool>]
bash ~/.claude/skills/<skill>/scripts/resolve-review-tool.sh [--review-tool <tool>]
```

出力は `value=<tool>` と `source=<cli|env|config|default>` の 2 行である。
受け付けない値なら、デフォルトの値を使わずに exit 2 で止まる。そのときは、値がどの層から来たかを添えて報告する。
`source=default` のときは、上に書いたとおり、デフォルトの値を使うことを利用者に知らせる。

## ツールごとの再レビュー依頼

依頼を出す条件とタイミング、依頼した後の待ち方（上限のあるポーリング）、進行中のレビューの扱いは、各スキルの `SKILL.md` の流れに従う。
ここでは、どう依頼し、依頼が成立したことをどう確かめるかだけを、ツールごとに定める。

`copilot` 以外の bot がレビューやコメントを投稿するときの login は、導入した GitHub App によって変わるので、決まった名前を前提にしない。
HEAD がレビュー済みかの判定と、レビューが進行中かの検出には、ツール固有の login に依存しない次の 3 つのシグナルを使う。

- 現在の HEAD に、PR の作成者以外のレビューが届いた。
- レビューするエージェントの bot がコメントした。
- レビュー用の check-run がある。

pr-finalize-loop は、これを `SKILL.md` の「レビュー進行中の検出」の節で詳しく書いている。
pr-review-handle は専用の節を持たないので、これらのシグナル（直近の push より後に現れた、作成者以外のレビューと bot のコメント）を直接使う。

### copilot

`requested_reviewers` API に bot の login を渡して依頼する。すでに依頼中でも、同じ結果になる。

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/requested_reviewers \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

- 依頼に使う login は `[bot]` の付いた `copilot-pull-request-reviewer[bot]` である。
  表示名の `Copilot` と、slug の `copilot-pull-request-reviewer` は渡さない。`Copilot` を渡すと 200 が返るのに警告なしに無視され、slug を渡すと 422 になる。
- 作成者の login は API によって書き方が違う。REST では `Copilot`、GraphQL では `copilot-pull-request-reviewer`、依頼に使うのは `copilot-pull-request-reviewer[bot]` である。
- `requested_reviewers` が空でも、依頼が成立しなかったとは判断しない。Copilot はレビューに着手するとすぐ依頼を消すので、正常なときも空になる（実測）。
  成立は、タイムラインにある Copilot 宛ての `review_requested` イベント（REST での表記は `Copilot`）で確かめる。

  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<番号>/timeline \
    --jq '.[] | select(.event=="review_requested" and .requested_reviewer.login=="Copilot") | {created_at, requested_reviewer: .requested_reviewer.login}'
  ```

- リポジトリの設定によっては、PR の作成時や push のときに、この依頼が自動で出る（実測）。
  基準の時刻より後に Copilot 宛ての `review_requested` があり、その HEAD に作成者以外のレビューがまだ無ければ、自動で依頼され進行中であるとみなし、重ねて依頼しない。
  最新のイベントの日時だけで判定せず、前の HEAD への依頼を根拠にしない。
- 出典は次の 2 つである。
  - `requested_reviewers` の REST API: <https://docs.github.com/en/rest/pulls/review-requests>
  - 成立の確認に使う issues の timeline API（`event` や `requested_reviewer.login` などの応答の形）: <https://docs.github.com/en/rest/issues/timeline>

### claude-code

PR のトップレベルのコメントに `@claude review` を投稿して依頼する。差分の行に付けるコメントではない。

```bash
gh api --method POST \
  repos/<owner>/<repo>/issues/<番号>/comments \
  -f body="@claude review"
```

- Claude Code の GitHub App か Action が `@claude review` を見つけて、レビューを投稿する。`requested_reviewers` は使わない。
- 本文は `-f`（raw-field）で渡す。`-F`（field）は先頭の `@` をファイルの参照として扱うので使わない。本文は決まった文字列である。
- レビューの結果がどこに置かれるかに注意する。
  このレビュアーは、総評と軽い指摘をトップレベルのコメント（`issues/<番号>/comments`）に置き、`reviews[].body` を空、`state` を `COMMENTED` にすることがある。
  行に付けたコメントが 0 件なら、`reviews[]` にレコードそのものを作らず、結果をトップレベルのコメントか check-run だけに載せることもある。
  レコードが無いことは実測で確かめた。公式のドキュメントも、指摘が 0 件なら check-run を更新し、確認のコメントを投稿する場合があると説明している。
  指摘は、各スキルの「スレッド外に置かれた指摘（レビュー本文・トップレベルコメント）」に従って集め、トップレベルのコメントは切り詰めずに読む。
- 依頼の成立、進行中かどうか、レビューが届いたかは、各スキルが使う 3 つのシグナル（作成者以外のレビュー、bot のコメント、check-run）で判定する。
  bot の login（例: `claude[bot]`）は導入した App によって変わるので、決まった名前を前提にしない。
- 出典は次の 2 つである。
  - Claude Code Review: <https://code.claude.com/docs/en/code-review>。指摘が 0 件なら check-run を更新し、確認のコメントを投稿する場合がある。手動で起動するには、トップレベルのコメントに `@claude review` と書く。
  - GitHub Actions: <https://code.claude.com/docs/en/github-actions>

### codex

PR のトップレベルのコメントに `@codex review` を投稿して依頼する。

```bash
gh api --method POST \
  repos/<owner>/<repo>/issues/<番号>/comments \
  -f body="@codex review"
```

- Codex は `@codex review` を見つけると、👀 のリアクションを付けた後で正式なレビューを投稿する。
  mention は必ず `@codex review` にする。`review` 以外を付けた mention は、cloud chat の起動など別の動作になる。`requested_reviewers` は使わない。
- 指摘が無いときは、👀 のリアクションを外し、`Reviewed commit` の短縮 SHA と「指摘なし」を書いたトップレベルの bot のコメントだけを投稿して、`reviews[]` を作らないことがある（実測）。
  短縮 SHA は GitHub API で完全な SHA に解決してから、現在の HEAD と照合する。
- claude-code と同じく、本文は `-f` で渡す。依頼の成立、進行中かどうか、届いたかは、各スキルが使う 3 つのシグナルで判定する。
- 出典: Codex code review in GitHub <https://developers.openai.com/codex/integrations/github>

### mention で依頼する方法（claude-code と codex）は、繰り返すと結果が変わる

copilot の `requested_reviewers` と違い、mention のコメントは、同じ依頼を投稿し直すと新しいレビューがもう 1 つ起動し、余計なレビューとコメントが増える。
そのため、現在の HEAD を push した後に `@claude review` か `@codex review` のコメントがすでにあれば、投稿した人に関わらず、この HEAD には依頼済みでレビューが進行中であるとみなし、投稿し直さない。
これは、copilot のタイムラインの `review_requested` にあたる、この HEAD への依頼済みのシグナルである。人が手で mention した場合も依頼済みとして扱い、レビューを重ねて起動しない。

この依頼のコメントは bot ではなく通常のアカウントが投稿するので、bot のコメントによる進行中のシグナルには現れない。
依頼する前に issue のコメントを取得し、`@<tool> review` のコメントを、投稿した人に関わらず並べる。
並べた結果の `created_at` を push が終わった時刻と比べ、それより後のものだけを依頼済みとみなす。古い mention を依頼済みと誤って判定しないためである。
`gh api` の `--jq` は jq の `--arg` を受け取れないので、時刻は jq の中では比べず、並べた後でエージェントが比べる。copilot の `review_requested` を基準の時刻と比べるときと同じ扱いである。

```bash
gh api --paginate repos/<owner>/<repo>/issues/<番号>/comments \
  --jq '.[] | select(.body | test("^@(claude|codex) review")) | {login: .user.login, created_at, body: .body[:60]}'
```

### none

- AI レビュアーには、再レビューを一切依頼しない。未解決のスレッドへの返信と解決は、通常どおり行う。
- 完了の判定から「HEAD がレビュー済み」の条件を外す。CI がすべて成功し、未解決のスレッドが無く、スレッドの外の指摘にも対応していれば完了とする。
- 再レビューを依頼するかの確認（pr-review-handle）と、push した後の再レビューの依頼（pr-finalize-loop）は行わない。
