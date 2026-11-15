# PR の Claude によるレビュー

`.github/workflows/claude-review.yml` が、PR の差分を `anthropics/claude-code-action` でレビューし、指摘を PR に書く。
このワークフローは、配布スキル `pr-finalize-loop` に同梱した雛形 `skills/pr-finalize-loop/assets/claude-review.yml` のバイト単位の複製である。直すときは両方を同じ内容にする（`scripts/skills/pr-finalize-loop/claude-review-workflow.test.ts` が一致を確かめる）。
必須チェックではない。マージを止めるのは、ルールセットの必須チェックと code scanning の規則だけである（`AGENTS.md`「ブランチ運用」）。

## 起動

| イベント | 対象 | effort |
| --- | --- | --- |
| `pull_request`（`opened`・`synchronize`・`ready_for_review`・`reopened`） | 同じリポジトリのブランチの PR。draft・fork・Dependabot の PR は除く | リポジトリ変数 `CLAUDE_REVIEW_EFFORT`。無ければ `high` |
| `workflow_dispatch` | 入力の `pr` の PR。入力の `sha` が PR の今の HEAD と一致し、HEAD が同じリポジトリのブランチで、PR が open で、Dependabot の PR でないときだけ | 入力の `effort`。空なら `pull_request` と同じ |

`workflow_dispatch` は、push せずに返信だけをしたときなど、同じ HEAD をもう一度レビューさせるときに使う。書き込み権限を持つ人だけが起動できる。

```bash
sha="$(gh pr view <番号> --json headRefOid --jq .headRefOid)"
gh workflow run claude-review.yml -f pr=<番号> -f sha="$sha" -f effort=medium
```

スキル（`pr-finalize-loop`・`pr-review-handle`）を `review_tool: claude-code-action` で使うときは、同梱のスクリプト `claude-review-action.sh` の `request` で依頼する。
`request` は、同じ HEAD の run が進行中か済んでいれば依頼しない。手順は `pr-finalize-loop` の [`references/review-tool.md`](../skills/pr-finalize-loop/references/review-tool.md)「claude-code-action」にある。

### 投稿しない実行（`dry_run`）

プロンプトや設定を変える前後で、同じ commit の指摘を比べるときは、`-f dry_run=true` を付けて起動する。
変えたプロンプトを試すには、変えたブランチを `--ref` に渡す。
エージェントへの入力は、commit に加えて、起動した時点の PR のスレッド・コメント・前回の目印（`since.diff` を作るか）で決まる。
前後の比較は、その間にスレッドとコメントが変わらない PR（下の測定用の draft PR など）で行う。

```bash
gh workflow run claude-review.yml --ref <プロンプトを変えたブランチ> -f pr=<番号> -f sha="$sha" -f effort=high -f dry_run=true
```

- PR には何も書かず、目印も書かない。投稿の前と同じ資格情報の検査を通した結果（structured output）を、artifact `claude-review-result` に残す（30 日）。
- run-name の先頭は `Claude review (dry run)` になる。`claude-review-action.sh` の `check` は run-name が `Claude review PR #<番号> <SHA>` の run だけを数えるので、`dry_run` の run は HEAD のレビューの判定に入らない。
- `concurrency` の group も分けるので、`dry_run` の run は投稿するレビューを取り消さない。同じ PR の `dry_run` の run どうしは取り消し合うので、1 回ずつ終わるのを待ってから起動する。
- 対象の検査（PR が open で、入力の SHA が PR の今の HEAD）は、`dry_run` でも同じに当てる。merge 済みの PR の commit を測るには、その commit と当時の base を指す一時ブランチで draft PR を作る。
  base を一時ブランチにした draft PR は、CI の対象（base が `main` の PR）に入らない。このワークフローの `pull_request` の run は作られるが、job は draft を除く条件で skipped になる。
- リポジトリ変数 `CLAUDE_REVIEW_SKIP` で一時停止している間は、`dry_run` の run もエージェントを起動せずに成功で終わり、artifact `claude-review-result` を残さない。
- `dry_run` の run も、使用量を artifact `agent-usage-review-claude` に残す。配布スキル `agent-usage` の collect は、それを対象の PR のレビューの費用として数えるので、測定の費用がレビューの費用に含まれる。
- job `Review` の check-run は、`--ref` に渡したブランチの HEAD の commit に付く。そのブランチの PR の checks に現れるので、測定の run が失敗すると、その PR の checks も失敗に見える。測定の run の失敗は、その PR の CI の失敗として扱わない。
- 同じ run を再実行すると、artifact `claude-review-result` を前の試行と同じ名前で上げられず、job が失敗する。測定をやり直すときは、新しい run を起動する。

`workflow_dispatch` は、ワークフローがデフォルトブランチに入るまで起動できない（GitHub の仕様）。
コメントで起動する `issue_comment` は使わない。secret のある job を、PR のコメントから誰でも動かせてしまうからである。

同じ PR のレビューは、イベントごとに 1 つだけ動く（`concurrency`）。新しい push が来ると古い `pull_request` のレビューが、新しい依頼が来ると古い `workflow_dispatch` のレビューが取り消される。
`workflow_dispatch` の依頼は、動いている `pull_request` のレビューを取り消さない。SHA を誤った依頼が、正しいレビューを止めないようにするためである。

## 結果の読み方

行に付けられる指摘はインラインコメントに、それ以外は総評のコメントに書く。どちらも `github-actions[bot]` が投稿する。
総評のコメントの 1 行目は、次の形の目印である。

```text
<!-- claude-review sha=<レビューした commit の完全な SHA> findings=<指摘の件数> open=<総評に書いた指摘の件数> effort=<effort> run=<run の ID> -->
```

- `findings` は、行の指摘と総評の指摘を合わせた件数である。0 件のときも、目印を書いた総評を投稿する。
- `open` は、行に付けずに総評に書いた指摘の件数である。行の指摘はスレッドの解決で追えるが、総評の指摘は追えないので分けて数える。
  手元のレビューの記録（配布スキル `pr-finalize-loop` の `local-review-record.sh`）の `open` と同じ考え方である。
- レビューが失敗・時間切れ・取り消しになった回は、目印を書かない。HEAD の SHA と一致する目印が無ければ、その HEAD はレビューし終えていない。
- 目印を書かない回は、ほかに 2 つある。`CLAUDE_REVIEW_SKIP` で一時停止した回は、run が成功で終わり、Summary に一時停止と書く。
  対象外の PR（draft など）で job を飛ばした回は、run と job の conclusion が `skipped` になる。目印を待つ側は、run の conclusion と Summary でこの 2 つを見分ける。
- 目印は、`github-actions[bot]` が書いたコメントの 1 行目だけを読む。人が同じ形を書いたコメントと、総評の本文の中の同じ形は、目印として扱わない。
- run の一覧では、`run-name` の `Claude review PR #<番号> <SHA>` で、どの PR のどの commit の run かを見分ける。

check-run（名前 `Review`）は、`workflow_dispatch` の run では起動した ref の HEAD の commit に付く（`--ref` を省くとデフォルトブランチ）。PR の HEAD をレビューしたかの判定には使わない。

## 2 回目からのレビュー

ワークフローは、エージェントを起動する前に次のものを作業ツリーの `.claude-review-input/` に書き、エージェントに読ませる。

- 前回の目印の SHA から HEAD までの差分（`since.diff`）。前回の目印が無ければ作らず、エージェントは base からの差分（`full.diff`）を全体として読む。
  差分は PR が変えたファイルに絞った目安で、base 側の変更を含むことがある（PR が触れたファイルへの base 側の変更や、PR の base のブランチを変えた後など）。PR の変更の範囲は `full.diff` で確かめるよう、README で伝える。
  前回の commit が履歴に無いとき（rebase して force push した後は、checkout が前回の commit を取得しないので、ふつうはこの場合に当たる）と、base のブランチと共通の祖先が無いときは作らない。
- レビューのスレッド（解決済みかと、作成者の返信）と、トップレベルのコメント

プロンプトは、解決済みの指摘と、作成者が理由を添えて直さないと返信した指摘を、新しい根拠なしに出し直さないよう指示する。
公式のプラグイン（`/code-review:code-review`）は使わない。Claude が既にコメントした PR ではレビューを止める手順を持つので、2 回目からのレビューが飛ばされうるからである。
`anthropics/claude-plugins-official` の `plugins/code-review` の手順を読んで確かめた範囲では、テストの不足を観点に挙げず、バグを探す担当が差分の外を読まない。Bash と書き込みの権限も要る。

## レビューの観点と手順

プロンプトの原本は、ワークフローの `Run Claude Code` の段の `prompt` である。手元の `/code-review` が挙げ、このワークフローが挙げ損ねた誤りの分類から、次の観点と手順を置いている。

- 観点: 不具合・セキュリティ・規約との食い違いに加えて、次の 4 つを挙げる。文書・コメントと実装の食い違い（文書どうしを含む）・条件や入力の状態の抜け・記録の項目の抜け・テストが固定していない分岐である。
- 差分の外: 差分で変えた名前・見出し・設定のキー・取り決めの語を Grep で検索し、それを参照する他のファイル（文書・テスト・設定）を読む。
- 確かめ: 指摘の候補ごとに、根拠のファイルと行を開いて確かめてから出す。項目やテストが無いことの指摘は、それを求める記述の行と、探した範囲を根拠にする。

エージェントのツールは、作業ツリーの中を読むこと（`Read`・`Grep`・`Glob`）だけに限ったままである。差分の外を読む手順のために、Bash やサブエージェントは与えない。

## リポジトリ変数

どれも未設定で動く。設定は `gh variable set <名前> --body <値>` か、リポジトリの Settings の Variables で行う。

| 名前 | 値 | 未設定のとき |
| --- | --- | --- |
| `CLAUDE_REVIEW_SKIP` | `on`・`true`・`yes`・`1` のどれかなら、レビューを一時停止する | レビューする |
| `CLAUDE_REVIEW_EFFORT` | `pull_request` のレビューの effort（`low`・`medium`・`high`・`xhigh`・`max`） | `high` |
| `CLAUDE_REVIEW_MODEL` | エージェントのモデル（例: `opus`） | `claude-code-action` のデフォルトのモデル |
| `CLAUDE_REVIEW_MAX_TURNS` | エージェントの往復の上限（1〜999） | 60 |

値の形が違うと、job はエージェントを起動せずに失敗する。値は `claude_args` に入るので、別の引数を足せる形（空白・引用符）を受け付けない。

effort は、`claude_args` の `--effort` で Claude Code に渡す。`claude-code-action` は、`claude_args` のうち自分で扱わない引数を SDK にそのまま渡す（action の `base-action/src/parse-sdk-options.ts`）。
effort がエージェントの振る舞いに反映されたことは、run のログでは確かめられない。ワークフローが `show_full_output` を有効にしないので、ログにはエージェントの設定もツールの呼び出しも出ない。

資格情報は、週次のワークフローと同じ secret の `CLAUDE_CODE_OAUTH_TOKEN` を使う。

## 費用

1 回のレビューは、手元のセッションと同じ Claude のプランの上限から使用量を使う。週次のワークフローとも、同じ上限を共有する。
上限に当たると、レビューも週次のワークフローも失敗する。PR が多い日は、`CLAUDE_REVIEW_SKIP` で一時停止する。

使用量を抑えるために、次の上限を置く。

- エージェントの段の `timeout-minutes` は 15 分、job は 25 分である。
- `--max-turns`（`CLAUDE_REVIEW_MAX_TURNS`）で往復の回数を限る。上限に達した回は失敗として扱い、目印を書かない。
- 同じ PR の古い HEAD のレビューは取り消す。

1 回のレビューの目安は、所要 5 分以内・費用 1 USD 相当以内である。プロンプトや上限を変えたら、`dry_run` で同じ commit を変更の前後に測り、指摘の件数とあわせてこの目安に収まるかを確かめる。

1 回の使用量は、artifact `agent-usage-review-claude` に残す（90 日）。中身は、最後の result のうち数値の項目とモデルの名前だけである。`dry_run` の run も残す（「投稿しない実行（`dry_run`）」）。
形は配布スキル `agent-usage` の collect が読む形（`claude-execution-output.json` と `meta.json`）に合わせている。
所要時間・往復の回数・費用の見積もりは、run の Summary にも出す。同じ run を再実行すると、同じ名前の artifact を上げられないので、前の試行の使用量だけが残る。

## 危険と対策

| 危険 | 対策 |
| --- | --- |
| fork の PR のコードを、secret のある job で読ませる | `pull_request` は fork の PR を除く。`workflow_dispatch` は HEAD のリポジトリを API で確かめてから checkout する |
| 古い HEAD をレビューして、新しい HEAD のレビューとして扱う | `workflow_dispatch` は入力の SHA と PR の今の HEAD が違えば止める。目印には、レビューした SHA を書く |
| PR の本文・コメント・差分に仕込まれた指示に、エージェントが従う | エージェントのツールを、作業ツリーの中を読むこと（`Read`・`Grep`・`Glob`）だけに限る。書くツール・Bash・Web・サブエージェントを与えない。リポジトリの設定（`.claude/settings.json` の Hook と `.mcp.json`）を読ませない |
| エージェントが資格情報を PR に書く | エージェントはリポジトリの外と `.git/` の中を読めない（下の段落）。投稿の前に、結果に資格情報の値と token の形の文字列が無いことを確かめ、あれば何も投稿しない |
| エージェントが許可していないツールを使う | `--permission-mode default` で、許可の規則に無い呼び出しを拒否する。デフォルトで auto mode を使うバージョンの `claude-code-action` は、許可の規則に無い呼び出しを安全性の判定で通しうる |
| エージェントの文章が、目印と同じ形を含む | 総評の本文の中の `<!--` を `&lt;!--` に置き換える |
| PR が `.claude-review-input/` にファイルを置き、エージェントの入力をすり替える | 入力を書く前に、そのディレクトリを消す |
| 実行記録から情報が出る | 実行記録の全体は残さず、使用量の数値だけを artifact に残す |

`claude-code-action` は、agent モードでは、`github_token` を `.git/config` の remote の URL に書き込む。
書き込むのは、action の `src/github/operations/git-config.ts` の `replaceCheckoutCredentials` である。
checkout の `persist-credentials: false` は、この書き込みを防がない。そのため、エージェントの許可の規則（`Read(./**)`）に加えて、`Read(./.git/**)` を拒否の規則に入れる。
この拒否の規則は、Read に加えて Grep と Glob にも当たる。Grep と Glob の形の拒否の規則（`Grep(./.git/**)` など）は当たらない。
手元の Claude Code 2.1.325 の `claude -p` で、この拒否の規則があると Read・Grep・Glob のどれでも `.git/config` の中を読めないことを確かめた。拒否の規則が無いと、Read でも Grep でも読めた。
作業ツリーの中から `.git/` の中を指すシンボリックリンク（`x -> .git/config` など）も、同じ拒否の規則で読めなかった。作業ツリーの外を指すシンボリックリンクは、許可の規則（`Read(./**)`）に当たらないので読めなかった。

受け入れている危険は次のとおりである。

- インラインコメントを投稿した後に総評の投稿が失敗した回を再実行すると、同じ指摘のインラインコメントが重なる。目印は残らないので、レビュー済みの判定は誤らない。
- エージェントの文章の中のメンション（`@<login>`）と外部の画像のリンクは、そのまま投稿する。エージェントが読めるのは作業ツリーの中だけなので、リンクで外に出せるのは PR の作成者が読める内容に限られる。

`claude-code-action` は、`workflow_dispatch` の run ではインラインコメントのツール（`mcp__github_inline_comment__create_inline_comment`）を用意しない。PR のイベントでないからである。
そのため、エージェントには指摘を structured output（`--json-schema`）で返させ、ワークフローの段がインラインコメントと総評を投稿する。

## このワークフローを別のリポジトリで使う

ワークフローは、このリポジトリに固有のパスとツールを使わない。別のリポジトリにそのままコピーして使える。
配布先へは、`pr-finalize-loop` に同梱した雛形として届く。導入の手順は、`pr-finalize-loop` の [`references/review-tool.md`](../skills/pr-finalize-loop/references/review-tool.md)「claude-code-action」にある。
変えるのは、リポジトリ変数と、ワークフローの `env` の `DEFAULT_EFFORT`・`DEFAULT_MAX_TURNS` だけである。
エージェントは、リポジトリのルートの `AGENTS.md`・`CLAUDE.md`・`.github/copilot-instructions.md` のうち、在るものを規約として読む。
