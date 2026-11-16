# 進捗の表示（`--progress`）

`--progress` を付けると、作業の量を最初に見積もり、手順が進むたびに進捗をエージェントの statusline に出す。
進捗は概算で、一定の時間ごとには更新しない。`--progress` が無いときは、この文書の手順を行わない。

## 見積もり

基本フローの step 3（Issue の取得）の後に、選んだモードで行う手順を並べ、1 つずつを単位に数える。
単位は次のとおりである。モードで行わない手順は数えない。

| 単位 | 数 |
| --- | --- |
| Issue の確認（step 1〜3） | 1 |
| ブランチの用意（step 4〜7） | 1 |
| 現状の確認（step 8） | 1 |
| 調査 | 1 |
| 実装 | 変更の単位（ファイルか、まとまった変更）ごとに 1。調査の前は 3 と置く |
| 確認（テスト・リント） | 1 |
| commit | 1 |
| 受け入れ条件の突き合わせ、push、PR の作成 | 1 つずつ |

たとえば `--acceptance` は step 4〜8 を飛ばすので、ブランチの用意と現状の確認を数えない。`--branch-only` は step 9 で終わるので、調査より後を数えない。

調査を終えて実装の単位の数が分かったら、全体の数を 1 回だけ見積もり直す。完了した数は減らさない。

## 更新のしかた

手順が変わるたびに、完了した数と、これから始める手順の名前を書く。
最後の手順を終えたら、完了した数を全体の数と同じにし、手順の名前を `完了` にする。

### Claude Code・GitHub Copilot CLI での更新

同梱の `scripts/progress.mjs` を、このスキルのディレクトリの絶対パスで実行する。

```bash
node <このスキルのディレクトリ>/scripts/progress.mjs set --done <完了した数> --total <全体の数> --label <これから始める手順>
```

セッションの ID は、エージェントがシェルに渡す環境変数（Claude Code の `CLAUDE_CODE_SESSION_ID`、Copilot CLI の `COPILOT_AGENT_SESSION_ID`）から取る。
`set` の終了コードごとに、次のように扱う。

| 終了コード | 意味 | 扱い |
| --- | --- | --- |
| 0 | 書いた | 作業を続ける |
| 1 | ファイルを書けない | 進捗を出さずに作業を続ける |
| 2 | 引数の誤り（値の形・未知の名前・重複・`--session` で渡した ID の形） | stderr を読んで引数を直し、1 回だけやり直す。それでも 2 なら、進捗を出さずに作業を続ける |
| 3 | 環境変数のセッションの ID が無いか、形が違う | 引数を直しても変わらないので、やり直さずに進捗を出さずに作業を続ける |

進捗は補助なので、書けないことを理由に作業を止めない。引数の誤りは直せるので、やり直さずに進捗を止めたままにしない。

進捗のファイルは `${XDG_STATE_HOME:-~/.local/state}/issue-start/progress/<セッションの ID>.json` に置く（環境変数 `ISSUE_START_PROGRESS_DIR` で変えられる）。
セッションごとに 1 ファイルで、作業の後も消さない。`set` は、実行したディレクトリの branch もファイルに記録する。
statusline は今のセッションのファイルだけを読み、記録した branch が今の branch と同じときだけ進捗を出す。
そのため、同じセッションで別の branch の作業に移ると、前の作業の進捗は出なくなる。

### Codex での更新

Codex の statusline は外部のコマンドもファイルも読めないので、`progress.mjs` を使わない。
代わりに、手順が変わるたびに `update_plan` で計画を更新する。単位は上の見積もりと同じにし、完了した単位を `completed`、これから始める単位を `in_progress` にする。
`update_plan` を使えない環境では、進捗を出さずに作業を続ける。

## statusline の設定

statusline を設定していなければ、進捗は書かれても表示されない。
`--progress` で始めるたびに、動いているエージェントの設定ファイル（下の節のうち、そのエージェントのもの）を読み、statusline が同梱のスクリプトを指しているかを確かめる。
指していなければ、設定の内容を利用者に示し、承認を得てから書く。
既に別の statusline の設定があるときは、置き換えると今の表示（今の設定が出している項目）が使われなくなることを添えて確かめる。承認を得ずに書き換えない。
利用者が断ったら、同じセッションの中では再び尋ねない。

### Claude Code の設定

`~/.claude/settings.json` の `statusLine` に、同梱のスクリプトを指定する。
stdin の JSON の形と更新の時点は、<https://code.claude.com/docs/en/statusline> にある。

```json
{
  "statusLine": {
    "type": "command",
    "command": "node <このスキルのディレクトリ>/scripts/progress.mjs statusline"
  }
}
```

### GitHub Copilot CLI の設定

`~/.copilot/settings.json` の `statusLine` に、Claude Code と同じ形で指定する。
形は `copilot help config` の `statusLine` の項にある。
表示は `/statusline` で切り替えられ、切っている間はコマンドが実行されない。
Copilot CLI が stdin に渡す JSON の形（`session_id` の名前と、それが `COPILOT_AGENT_SESSION_ID` と同じ値か）は、公式の文書でも実測でも確かめていない。
名前か値が違うと、進捗はエラーにならずに出ない。

### Codex の設定

`~/.codex/config.toml` の `[tui]` の `status_line` に、`task-progress`（`update_plan` の進捗）と `estimated-thread-cost`（費用）を足す。

```toml
[tui]
status_line = ["model-with-reasoning", "git-branch", "estimated-thread-cost", "task-progress"]
```

## 表示

同梱のスクリプトは、次の 3 行を出す。値の無い項目と行は出さない。

1. 場所: `user@host`・ディレクトリ（ホームの下は `~` で始める）・branch
2. セッション: このセッションのモデル・effort・コンテキストの使用率・費用・進捗。
   進捗は、そのセッションの進捗のファイルがあり、記録した branch が今の branch と同じときだけ出す。Issue の番号は branch の名前で分かるので出さない
3. 利用枠: プランの 5 時間と 7 日の枠の使用率と、リセットまでの残り時間。
   Claude Code が `rate_limits` を渡すとき（claude.ai の Pro・Max・Ultra のプランの利用者と、spend limit を設定した gateway を通す利用者）だけ出す。
   枠はそれぞれ単独で欠けることがあり、欠けた枠は出さない

```text
user@host:~/projects/app (feature/<番号>-<英語の短い説明>)
Opus effort:high | ctx:42% | $1.23 | [████░░░░░░] 40% 実装
5h:30%(reset 2h10m) | 7d:12%(reset 2d3h)
```

色は次のように付ける。環境変数 `NO_COLOR` があれば、色を付けない。

- 緑・黄・赤は、使用率（コンテキスト・5 時間・7 日）の状態にだけ使う。50% 未満は緑、80% 未満は黄、それ以上は赤にし、閾値はすべての使用率で同じにする
- ほかの項目には、緑・黄・赤を使わない。`user@host` とリセットまでの残り時間と区切りの `|` はグレー、ディレクトリは青、branch はマゼンタ、モデルと effort はシアンにする
- 費用と進捗には色を付けない。費用には多い・少ないを決める基準が無く、進捗の度合いはバーと割合で読めるからである

進捗率は、完了した数 ÷ 全体の数を百分率にして、小数点以下を切り捨てる。バーは 10 マスで、同じ割合で塗る。
スクリプトは書かれた数を割るだけで、作業の量を自分では測らない。

コンテキストの使用率は `context_window.used_percentage`（Claude Code）を使い、無ければ `context_window.current_context_used_percentage` を使う。
effort は、Claude Code が渡すときだけ出る。

費用は、Claude Code では USD の推定値（`cost.total_cost_usd`）、Copilot CLI では premium requests の数（`cost.total_premium_requests`）を出す。
Claude Code の推定値は、`/clear` で 0 に戻る。
