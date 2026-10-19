# レビューツールの選択と再レビュー依頼

このスキルは、レビューに対応した後、AI レビュアーに再レビューを依頼する。
姉妹スキルの pr-review-handle と pr-finalize-loop は、同じ解決規則を使う。

## 設定の解決

次の優先順位で、最初に設定されている値を使う。
受け付ける値は `copilot`・`claude-code`・`codex`・`local`・`none` の 5 つだけで、それ以外の値なら、警告なしにデフォルトの値を使うことはせず止まる。

1. pr-finalize-loop の `--review-tool <tool>`（その 1 回だけ変える）
2. `.config/skills/shoji9x9/common.local.jsonc` の `review_tool`（このリポジトリで、自分だけが使う値）
3. `${XDG_CONFIG_HOME:-~/.config}/skills/shoji9x9/common.jsonc` の `review_tool`（自分のすべてのリポジトリで使う値）
4. `.config/skills/shoji9x9/common.jsonc` の `review_tool`（リポジトリの全員が使う値）
5. デフォルトの `copilot`

層と置き場所の決まりは [`config-files.md`](config-files.md) にある。

| 値 | 意味 |
| --- | --- |
| `copilot`（デフォルト） | GitHub Copilot。`requested_reviewers` API に bot の login を渡して依頼する |
| `claude-code` | Claude Code。PR のトップレベルのコメントで mention して依頼する |
| `codex` | OpenAI Codex。PR のトップレベルのコメントで mention して依頼する |
| `local` | 今使っているエージェント自身が手元でレビューし、レビューした HEAD の SHA と指摘の件数を PR に記録する。PR に投稿する AI レビュアーを使わないリポジトリ向け |
| `none` | AI レビュアーに再レビューを依頼しない。人だけがレビューするリポジトリ向け |

- どれも設定されていなければ、デフォルトの `copilot` を使い、そのことを利用者に知らせる。
- pr-review-handle は CLI のオプションを持たないが、ファイルの層から下は同じ優先順位を使う。
- 環境変数 `SKILLS_REVIEW_TOOL` は使わない。設定されていると（空の値でも）、解決は移行の手順を示して止まる。値を `common.local.jsonc` か人ごとの `common.jsonc` へ移し、環境変数を消す。
- 設定を書くのは、利用者の了承を得てからにする。設定が無いまま起動したときは、デフォルトの `copilot` で進めながら設定を作るかを確かめ、確かめずに書き込まない。
- 了承を得たら、どの層に書くかを利用者に確かめ、読み取りの `set` で書く。キーが既にあれば値を変えずに止まる（[`config-files.md`](config-files.md)「書き込みの決まり」）。
  リポジトリの全員の値は `--layer repo`、このリポジトリで自分だけが変える値は `--layer local`（`.gitignore` に `/.config/skills/shoji9x9/*.local.jsonc` が要る）、自分のすべてのリポジトリの値は `--layer user` にする。

  ```bash
  node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs set common review_tool '"copilot"' --layer local
  ```

```jsonc
// .config/skills/shoji9x9/common.jsonc（リポジトリの全員の値）
{
  "review_tool": "copilot", // copilot | claude-code | codex | local | none
}
```

### 解決は同梱スクリプトで行う（値と出所を表示してから使う）

何層もある解決の順序を頭の中でたどると、原本を読む前に設定の名前を推測して「未設定」と判定してしまう。
実際に、別のツールへ 3 回依頼したことがある。
着手したら同梱スクリプトを実行し、値と、それがどの層から来たかを報告してから使う。

```bash
# インストール先に合わせて、どちらかのパスで実行する（--review-tool は pr-finalize-loop だけ）
bash .agents/skills/<skill>/scripts/resolve-review-tool.sh [--review-tool <tool>]
bash ~/.claude/skills/<skill>/scripts/resolve-review-tool.sh [--review-tool <tool>]
```

出力は `value=<tool>` と `source=<cli|local|user|repo|default>` の 2 行である。
受け付けない値、設定の誤り、旧い場所の設定（`skills.yml` や `SKILLS_REVIEW_TOOL`）が残っているときは、デフォルトの値を使わずに exit 2 で止まる。そのときは、エラーの内容を添えて報告する。
設定ファイルがあるのに Node.js が無いときも、exit 2 で止まる。設定ファイルが 1 つも無ければ、Node.js なしでデフォルトの `copilot` を返す。
`source=default` のときは、上に書いたとおり、デフォルトの値を使うことを利用者に知らせる。

## ツールごとの再レビュー依頼

依頼を出す条件とタイミング、依頼した後の待ち方（上限のあるポーリング）、進行中のレビューの扱いは、各スキルの `SKILL.md` の流れに従う。
ここでは、どう依頼し、依頼が成立したことをどう確かめるかだけを、ツールごとに定める。

`copilot` 以外の bot がレビューやコメントを投稿するときの login は、導入した GitHub App によって変わるので、決まった名前を前提にしない。
HEAD がレビュー済みかの判定と、レビューが進行中かの検出には、ツール固有の login に依存しない次の 3 つのシグナルを使う。

- 現在の HEAD に、PR の作成者以外のレビューが届いた。
- レビューするエージェントの bot がコメントした。
- レビュー用の check-run がある。

`pr-finalize-loop` の `SKILL.md`「レビュー進行中の検出」に、これを詳しく書いている。
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

### local

依頼の代わりに、今使っているエージェント自身が PR の HEAD をレビューし、その結果を PR に記録する。
手元のレビューは、指摘が 0 件だと PR に何も投稿しないことがある。記録が無いと、HEAD をレビューしたのかを GitHub の上で確かめられないので、件数に関わらず記録を残す。

1. レビューする HEAD の完全な SHA を、`gh pr view <番号> --repo <owner>/<repo> --json headRefOid --jq .headRefOid` で取得する。手元の HEAD がこれと一致することも確かめる。
   作業ツリーに commit していない変更が無いこと（`git status --porcelain` が空）も確かめる。手元のレビューの機能は、commit していない変更もレビューの対象に入れることがあり、記録の SHA が表す内容とずれる。
   どちらかを満たさなければレビューしない。HEAD が一致しなければ、push が反映されるのを待って間隔を空けて取得し直す。
   commit していない変更があれば、先に commit と push を済ませる。commit と push をしてよいかは各スキルの取り決めに従う（pr-finalize-loop は手順 5 で行う。pr-review-handle は `--push` が無ければ利用者に確かめる）。
   それでも満たさなければ、記録せずに止まる（pr-finalize-loop では「行き詰まり」）。
2. エージェント自身の機能でレビューする。別のエージェントに自動で切り替えない。機能を使えなければ、レビューしたことにせず止まる。
   最初のレビューは、PR の変更全体を対象にする。2 回目からは、前の記録の SHA から今の HEAD までの差分（直した commit）だけを対象にし、前の回の指摘と対応（解決したスレッドと記録の本文）をレビューに渡す。
   前の記録の SHA は、`check` の出力の `previous` を使う。コメントを手で探さない。`check` が形と書き手を確かめた記録だけから取るためである。
   `previous` が無い、`previous` が HEAD の祖先でない（rebase した）、`previous` から HEAD までに merge commit がある（ベースブランチを取り込んだ）ときは、PR の変更全体をレビューする。
   差分にベースブランチの変更が入ると、PR に無い変更まで指摘の対象になる。祖先かは `git merge-base --is-ancestor <previous> HEAD`、merge commit の有無は `git rev-list --merges <previous>..HEAD` で確かめる。
   毎回 PR の全体をレビューし直すと、直すたびに前の回と別の指摘が出て、収束しないまま反復の上限に達しやすい。
   - Claude Code: 組み込みの `/code-review` に、対象の PR の番号と `--comment` を渡す（例: `/code-review high <PR の番号> --comment`）。指摘は PR の行に付いたコメントとして投稿される（[Claude Code commands](https://code.claude.com/docs/en/commands)）。
     PR の番号を渡さないと、upstream との差分をレビューする。push した後はこの差分が空になり、PR の変更をレビューしないまま指摘 0 件になる。
     2 回目からの差分の範囲は、引数の説明（前の記録の SHA から HEAD まで）として渡す。
   - Codex: `git fetch origin <PR のベースブランチ>` の後に、`codex review --base origin/<PR のベースブランチ>`。`--base` の意味は、ローカルの `codex review --help` でも確かめる（[OpenAI Developers](https://developers.openai.com/codex/cli/reference)）。
     手元のベースブランチは古いことがあり、そのまま渡すと PR に無い変更まで差分に入る。下の Copilot CLI の `<base>` にも、同じように fetch した `origin/<PR のベースブランチ>` を渡す。
     2 回目からは、`--base` に前の記録の SHA を渡す。
   - GitHub Copilot CLI: 次のコマンドを使う（[GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically#code-review-a-branch)）。
     2 回目からは、`<base>` に前の記録の SHA を渡す。

     ```bash
     copilot -p '/review the changes on this branch compared to <base>. Focus on bugs and security issues.' -s --allow-tool='shell(git:*)'
     ```

3. 同梱のスクリプトで、記録を PR のトップレベルのコメントとして投稿する。
   PR の行に付いていない指摘（Codex・Copilot CLI の指摘のすべてと、Claude Code が差分の外の行や総評として出した指摘）は、記録を投稿する前に 1 件ずつ判断して対応（直す・見送る・判断待ち）を決める。
   指摘と対応を書いたファイルを `--details` で渡し、記録の本文に残す。直すと決めた件数と判断待ちの件数の合計を、`--open` に渡す。
   記録は PR の作成者か担当者が投稿し、トップレベルのコメントから指摘を集める処理（各スキルの「スレッド外に置かれた指摘」）は記録を読まない。
   そのため、行に付いていない指摘は、記録の `open` だけが追う。`check` は `open` が 0 の記録だけをレビュー済みと判定するので、直すと決めた指摘を残したまま収束と判定されない。
   人の判断が要る指摘は、記録の本文では「判断待ち」と書く。pr-finalize-loop の `--defer-decisions` のときは、加えて同じ指摘を、判断待ちの印（`<!-- pr-finalize-loop:deferred -->`）で始まるトップレベルのコメントで残す（pr-finalize-loop の「自律性ポリシー」）。
   `--defer-decisions` を付けない実行では、ほかの指摘と同じように、その 1 件を利用者に確かめる。

   ```bash
   bash <スキルのディレクトリ>/scripts/local-review-record.sh post --pr <PR URL> --sha <1 で取得した SHA> \
     --findings <指摘の件数> --open <直すと決めた件数と判断待ちの件数の合計> \
     --reviewer '<2 で使った機能>' [--details <指摘と対応を書いたファイル>]
   ```

   `post` が投稿しないときの終了コードと対処は、次のとおりである。
   - exit 1: 渡した SHA が PR の今の HEAD と違う。今の HEAD をレビューし直してから記録する。
   - exit 2: PR の取得か投稿に失敗した。間隔を空けて実行し直す。
   - exit 3: gh のユーザーが PR の作成者でも担当者でもない。`check` はその人の記録を読み飛ばすので、投稿しても HEAD はレビュー済みにならない。
     利用者に確かめる。自分を PR の担当者に加えない。持ち主を変える操作は利用者が決める（`references/pr-ownership.md`）。
   - exit 4: 自分の login を取得できない（ユーザーでないトークンで認証している）。この環境では記録を残せないので、`local` を使わずに止まり、その理由を報告する。
4. 行に付いた指摘は、ほかのツールのレビューと同じように、スレッドとして 1 件ずつ判断して対応する。記録の本文に書いた指摘は、3 で決めた対応のとおりに直す。
   行に付いた指摘は PR の作成者の名前で投稿されることが多く、作成者以外のレビューを見る整合検証（pr-finalize-loop の「レビュー内容との整合検証」）には入らない。
   代わりに、2 のレビューの機能が投稿したと報告した行の指摘の件数と、そのレビューが作ったスレッドの数を突き合わせ、足りなければ反映の遅れとして取得し直す。
   直して push したら、新しい HEAD は記録の SHA と一致しないので、もう一度 1 から行う。

HEAD がレビュー済みかは、次の判定で決める。exit 0 のときだけレビュー済みとし、出力の `head` が判定に使う HEAD と一致することも確かめる。

```bash
bash <スキルのディレクトリ>/scripts/local-review-record.sh check --pr <PR URL>
```

- exit 0（`status=reviewed`）は、PR の作成者か担当者が、今の HEAD の完全な SHA と `open=0` を書いた記録を残していることを表す。
- exit 1 は、レビュー済みでないことを表す。`status=not-reviewed` は、記録が無いか、前の HEAD の記録しか無い。
  `status=open` は、今の HEAD の記録に未対応の指摘が残っている。直すと決めた指摘が残っていれば、直して push し、新しい HEAD をレビューし直す。
  残りが判断待ちだけなら、ほかの判断待ちと同じように扱う（pr-finalize-loop での扱いは、そのスキルの SKILL.md にある「HEAD のレビュー済み判定」に書いてある）。
  判断待ちの指摘を後で見送ると決めたなど、コードを変えずに未対応が減ったときは、同じ SHA に `--open` を減らした記録を投稿し直す。`check` は同じ SHA の記録のうち後のものを使う。
  投稿し直す記録には、前の記録の指摘と対応を、決まった対応に直して `--details` で書く。pr-finalize-loop では、SKILL.md の手順 4 が `check` の `record`（後の記録）の本文だけを読むので、書かないと残りの指摘の内容が失われる。
- exit 2 は判定できないことを表すので、レビュー済みとも未レビューとも扱わずに取得し直す。
- 記録は PR の作成者が投稿することが多い。作成者のレビューとコメントを判定から除く規則（各スキルの「HEAD のレビュー済み判定」など）は、この記録には当てない。
  この判定が数えるのは、記録の 1 行目に書いた SHA と件数だけだからである。
- 記録を数える条件は 1 行目だけで、記録の時刻は見ない。手元のレビューは、指摘に返信して解決したエージェント自身が行うので、返信だけで終わった後にもう一度レビューしなくてよい。
  コードを変えて push したら SHA が変わるので、必ずもう一度レビューする。
- 出力の `findings` は、記録した時点の指摘の件数で、見送った指摘も数える。`findings` が 1 以上であることを、merge できない理由にしない。未対応の指摘は `open` が表す。
- 記録の 1 行目は `<!-- pr-finalize-loop:local-review sha=<40 桁の SHA> findings=<件数> open=<件数> -->` である。
  スクリプトはこの形の行だけを数える。次の記録は、理由を stderr に出して読み飛ばす。形の違う行、目印の前に空白か改行があるもの、`open` が `findings` より大きいもの、作成者でも担当者でもない人の記録である。
  本文の途中で目印を引用しただけのコメント（Quote reply など）は、記録の候補にせず、読み飛ばした件数にも入れない。
- レビューはエージェント自身が実行して終わるので、依頼の成立を待つ処理と、自分のレビューが進行中かの検出は要らない。
  PR に別のエージェントの進行中のレビューがあるかは、`claude-code`・`codex` と同じように確かめる。

### none

- AI レビュアーには、再レビューを一切依頼しない。未解決のスレッドへの返信と解決は、通常どおり行う。
- 完了の判定から「HEAD がレビュー済み」の条件を外す。CI がすべて成功し、未解決のスレッドが無く、スレッドの外の指摘にも対応していれば完了とする。
- 再レビューを依頼するかの確認（pr-review-handle）と、push した後の再レビューの依頼（pr-finalize-loop）は行わない。
