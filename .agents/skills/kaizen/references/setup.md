# kaizen セットアップガイド

インストールした後の初回だけ実行する。kaizen が自動で回る状態にするための設定をまとめる。

## 3 つの Hook の役割

Hook からエージェント自身を呼び出して LLM を動かすことはできないので、役割を 3 つに分ける。

- タスク終了時の Hook（記録の役）: センチネルファイル `.kaizen/.pending-extract<agent suffix>.<session key>` を残し、未抽出の活動があることを記録する。
  センチネルは session 単位で、中身に解消のための識別情報（transcript のパス・エージェント・session id）を持つ。
- コミット前の PreToolUse のチェック（実行の役）: このプロジェクトに対する `git commit` を捕まえ（コマンド行から外部のリポジトリに対するものと分かる場合は対象外）、まず lifecycle の整合を検査する。
  - 未抽出のセンチネルがあり、Hook から transcript のパスを取得できる場合は、checkpoint より後だけを走査する。候補が 0 件だと確かめられたらそのまま通し、候補がある・形式が分からない・timeout のときは `kaizen --current` を促す。
  - commit を止める動作は、すべてのエージェント（Claude Code / Codex / Copilot）で機能する。transcript を渡さない Copilot では、候補 0 件のときに通す動作だけを使わず、安全側（`kaizen --current` を促して止める）として扱う。
- セッション開始時の Hook（参照を注入する役）: `.kaizen/` の未適用（`status: pending`）の学びの要約を stdout に出し、エージェントのコンテキストに参照データとして渡す。
  これで、過去の学びを踏まえて作業を始められる（KEDB 照合の起点）。
  - Claude Code は、SessionStart の stdout をコンテキストに注入する。
  - Codex は、plain text の stdout を extra developer context として追加する（[Codex Hooks — SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart)）。
  - Copilot は、注入されるかがドキュメントからは分からない。注入されれば役に立ち、されなくても害は無い、という扱いにする。

> echo による行動のリマインダーや、`AGENTS.md` への文章での指示は、エージェントの行動を確実には変えられず、守られない確率が高い。そのため主な起動の手段にはしない。詳細は末尾の「使わない方式」を参照する。

Hook の設定がすでにある場合は、上書きしない。既存の設定を更新するかを、ユーザーに確認する。

## 手順

### 1. 対象エージェントの確認

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

### 2. 設定するエージェントをユーザーに確認

対象のエージェントが明示されていない場合だけ、AskUserQuestion で確認する。

### 3. 基底ドキュメントにエージェントの自己設定編集の制約を追記する（既存なら除く）

プロジェクトの基底ドキュメントに、下の「エージェントの自己設定編集について」の節がまだ無ければ追記する（すでにあれば何もしない）。

- 基底ドキュメントは、常に読み込まれる指示のドキュメントである。マルチエージェントの構成では `AGENTS.md` で、それが無ければ実際に使っている `CLAUDE.md` / `.github/copilot-instructions.md` である。
  定義と判断は、`multiagent-setup` の `references/component-selection.md`「基底ドキュメントとは」で定義する。
- この内容は特定のエージェントに固有ではなく、すべてのエージェントに関わる一般原則なので、スキルの中ではなく基底ドキュメントに置く。
- kaizen は配布するスキルなので、この追記をインストールの手順に含めて、インストール先のプロジェクトにも伝える。
  `AGENTS.md` を持たないプロジェクト（`CLAUDE.md` だけ、`.github/copilot-instructions.md` だけ）でも、その基底ドキュメントに追記すれば伝わる。

基底ドキュメントに追記する内容は、次のとおりである。

```markdown
## エージェントの自己設定編集について

コーディングエージェントは自身の設定ファイルの編集が制限される場合がある（自己改変ガード）。
設定ファイルを書き換える作業（kaizen の Hook セットアップ等）でブロックされたら、適用すべき内容を
一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` 等での適用を依頼する。

**ブロックされないこともある。** ガードが効くかは版と権限モードに依るので、
**権限・検査を緩める設定変更は、止められるかどうかに関わらず人に確認する。**
下表の可否は前提にせず、その場で実測した結果を優先する。

| エージェント | 自己設定ファイル | 編集可否 |
|------------|---------------|---------|
| Claude Code | `.claude/settings.json` と `~/.claude/settings.json` | **版と権限モードで変わる。前提にせず実測する**（ある版 × `defaultMode: auto` では確認なく両方書けた。1 環境 1 回の実測なので「可」の側にも一般化しない） |
| Codex | `.codex/config.toml` / hooks | 現状は可（ただし credentials/auth/profile 等の上書きは制限） |
| GitHub Copilot | `.github/agents/`（指示） | 不可（ハードブロック） |
| GitHub Copilot | `.github/hooks/`（フック） | 可（手動承認ガードの設定を推奨） |
```

### 4. 各エージェントに 3 つの Hook を設定する

> 設定ファイルを編集するときの注意: この手順は、`.claude/settings.json` などのエージェントの設定ファイルを編集する。Step 3 のとおり、自己改変ガードで止められることも止められないこともあるので、できるかどうかを前提にせず、実際の結果で分ける。
>
> - 止められたら、適用する JSON を一時ファイルに書き出し、ユーザーに `! cp <tmp> .claude/settings.json` での適用を頼む。Codex（`.codex/hooks.json`）と Copilot（`.github/hooks/...`）は直接編集できる。
> - 止められずに書けた場合は、そのまま適用してよい（この手順が足すのは、PreToolUse のチェックなど検査を増やす変更である）。ただし、既存の設定を保ったまま hook のキーを増やせたときに限る。
>   `permissions` を緩める変更や、既存の hook（他のスキルのチェック等）の削除・置き換えが含まれるなら、止められなくても人に確認する（Step 3 の「権限・検査を緩める設定変更は、止められるかどうかに関わらず人に確認する」）。
>   書いた後は差分を見て、検査を増やす変更だけになっていることを確かめる。

タスク終了時の Hook、PreToolUse のチェック、参照を注入するフックは、どれもスキルに同梱したスクリプトの実体（`kaizen-stop-mark.sh` / `kaizen-precommit-gate.sh` / `kaizen-context-inject.sh`）をフックから直接参照する。プロジェクトへのコピーは要らない。

これらのスクリプトは、`.kaizen/` を、いま作業している作業ツリーの root を基準に解決する。そのため、フックがサブディレクトリの cwd で起動しても、センチネルが別の場所に作られたり、取り違えたりしない。

- 解決の順は、Hook の payload の `cwd` からたどった git root、プロセスの cwd からたどった git root、`$CLAUDE_PROJECT_DIR`、cwd である。
- git root を使うのは、`$CLAUDE_PROJECT_DIR` と同じリポジトリ（本体かその worktree）だと、共有の git ディレクトリが一致することで確かめられたときだけである。入れ子になった別のリポジトリへ cd した状態でフックが起動しても、そこには書かない。
- git worktree で作業している場合も、コミットする側のリポジトリの `.kaizen/` に書く（セッションを始めた場所が worktree の外でも、チェックと抽出側の書き込み先が分かれない）。

制御ファイル（センチネル・checkpoint・抽出完了マーカー）の探索と解消は、リポジトリのすべての作業ツリーに広げてある。

- 置き場所は作業ディレクトリから決まるので、セッションが共有のツリーで始まって worktree で続くと、センチネルを立てたツリーと `git commit` を実行するツリーが分かれる。
  自分のツリーの `.kaizen/` しか見ない形だと、worktree での commit がチェックを通り抜け、そのことは出力にも終了コードにも現れない。
- チェックは、`git worktree list` が返すすべてのツリーの `.kaizen/` から、センチネル・マーカー・checkpoint を探す。`kaizen-extract-done.sh` は、同じ範囲からセンチネルを消す。
- `kaizen-extract-done.sh` は、削除が空振りしたら stderr に警告を出す。`rm -f` は対象が無くても正常に終わるので、終了コードだけでは「解消した」と「解消するものが無かった」を区別できない。
  警告が出たら、抽出の対象にしたセッションと、`--session-id` / `--sentinel-suffix` が一致しているかを確かめる。

まず、kaizen の scripts ディレクトリを特定する。`<KAIZEN_SCRIPTS_DIR>` は、いま読み込んでいる kaizen スキル本体（この `setup.md` の 1 つ上＝`../`）の直下の `scripts/`（＝`../scripts/`）の絶対パスである。
インストール先（エージェント・スコープ）で場所が違うので、下のスニペットで主な置き場所を調べ、最初に見つかったパスを `<KAIZEN_SCRIPTS_DIR>` として、下の JSON の該当箇所を実際のパスに置き換える。
どこにも無ければ、実際の kaizen のインストール先の `scripts/` を使う（特定できなければユーザーに確認する）。

```bash
for d in .agents/skills/kaizen/scripts .claude/skills/kaizen/scripts \
         .github/skills/kaizen/scripts \
         "$HOME/.claude/skills/kaizen/scripts" "$HOME/.codex/skills/kaizen/scripts"; do
  [ -d "$d" ] && (cd "$d" && pwd) && break
done
```

> フックの起動は cwd に依存させない。Stop / PreToolUse のフックは、エージェントが `cd` したサブディレクトリの cwd を引き継いで起動することがある。
> このとき `bash <KAIZEN_SCRIPTS_DIR>/...` が相対パスだと、スクリプトそのものが見つからず起動に失敗する。そのため、`<KAIZEN_SCRIPTS_DIR>` は絶対パスにする（上の `cd … && pwd` が絶対パスを返す）。
> プロジェクトの中に置いていて、絶対パスを書き込みたくない場合は、コマンドの前に `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}` を付けて root を基準に解決する（このリポジトリの `.claude/settings.json` 等はこの形）。
> これはスクリプト本体の場所を解決するための前置きで、書き込み先の `.kaizen/` は、各スクリプトが上のとおり作業ツリーを基準に別に解決する。

3 つの hook は、エージェントごとに同じファイルにマージする（重要）。

- 4-1〜4-3 の JSON は、エージェントごとに同じ 1 つの設定ファイルに対するキーの一部を示している。
  設定ファイルは、Claude Code が `.claude/settings.json`、Codex が `.codex/hooks.json`、Copilot が `.github/hooks/kaizen-session.json` である。
  各ブロックをそのままファイルに書き込んで置き換えると、先に設定した hook のキーが上書きされ、1 つしか残らない。
- 既存の設定（他のスキルの hook を含む）を保ったまま、3 つの hook のキーを同じファイルの中にマージする。
  3 つのエージェントとも、`hooks` オブジェクトの下にイベントのキーを並べる。
  Claude Code と Codex は同じ構造（イベント→（任意の `matcher`＋）`hooks` 配列→`type: command`）である。`matcher` は任意で、省くとすべてに一致する。Copilot は、加えてトップレベルに `version` を持つ。
- Codex の `matcher` は正規表現で、PreToolUse は `Bash` に限る。SessionStart は `startup` / `resume` / `clear` / `compact` のすべてでマーカーを管理する必要があるので、省いてすべてに一致させる。`Stop` も matcher が無視されるので省く。
- Codex は、設定ファイルをマージしただけでは Hook を実行しない。3 つの定義をマージした後、4-4 の信頼の手順まで済ませる。

#### 4-1. タスク終了時の Hook（センチネルの記録だけ）

##### Claude Code — Stop (`.claude/settings.json`)

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-stop-mark.sh"
          }
        ]
      }
    ]
  }
}
```

##### Codex — Stop (`.codex/hooks.json`)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-stop-mark.sh -codex"
          }
        ]
      }
    ]
  }
}
```

詳細な形式は [Codex Hooks ドキュメント](https://learn.chatgpt.com/docs/hooks) を参照する。

##### GitHub Copilot — sessionEnd (`.github/hooks/kaizen-session.json`)

```json
{
  "version": 1,
  "hooks": {
    "sessionEnd": [
      {
        "type": "command",
        "bash": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-stop-mark.sh -copilot",
        "cwd": ".",
        "timeoutSec": 5
      }
    ]
  }
}
```

詳細な形式は [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) を参照する。

#### 4-2. コミット前の PreToolUse のチェック（自動で実行する主な手段）

`git commit` を捕まえ、lifecycle の不整合か、処理していない学びの候補があれば止めて、エージェントに `kaizen --current` の実行を促す。
Claude Code / Codex / Copilot のどれも、ツールの実行前に起動して止められる Hook（PreToolUse / preToolUse）を持つので、すべてのエージェントで機能する。

判定は、スキルに同梱した `kaizen-precommit-gate.sh` が行う。

- commit でない呼び出しは、Bash の組み込みの事前の絞り込みだけで終わり、jq / python / git を起動しない。
- commit のときだけ `kaizen-status-check.sh` を実行し、未抽出のセンチネルがあるときだけ `kaizen-candidate-scan.sh` が `transcript_path` の未処理の範囲を走査する。
- 時間は、チェック全体で 1 つの締め切り（デフォルトは 8 秒）で区切る（後の「チェックの締め切りとフックの timeout」）。
- 走査の結果は、`0` が候補あり、`1` が検証したうえで 0 件、`2` が不明である。`1` のときだけそのまま通し、候補あり・読めない形式・jq が無い・timeout のときは、exit code 2 と stderr で止める。

走査の判定には、次の決まりがある。

- `user correction` の判定に使うのは、文字列の `content` と `text` 要素だけで、`tool_result` 要素は除く。
  Claude Code はツールの結果も `role: "user"` のレコードに載せるので、つなげて読むと、ツールの出力の本文にある修正の語（「ではなく」等）を拾い、実際には無いユーザーの修正で commit が止まる。
  同じ分岐で tool error を取り出す処理が `tool_result` に絞っているのと、対称にしてある。
- 未知の `type` は、名前ではなく構造で区別する。会話を運ぶ入れ物（`message` / `payload` / `content`）を持たないレコードは候補の判定に関係しないので読み飛ばし、持つものだけを `2`（判定できないので止める）にする。
  - 不正な JSON は `fromjson` の失敗として別に見つけるので、この読み飛ばしとは区別できる。
  - 既知の入れ物（`response_item` / `event_msg`）は例外で、`payload` がまるごと欠けていても読み飛ばさず、`2` にする。subtype が欠けた場合と同じ不正な形を、形によって「止める」と「通す」に分けないためである。
  - 型名を 1 つずつ許可する形にすると、エージェントが内部のレコードを 1 種類増やすたびに、候補が 0 件のセッションでも判定できないと判定されてしまい、止まったままになる。
- 止める理由に載せる候補の根拠は、カテゴリ（`user correction` / `tool error` / `repeated edit`）と transcript の行番号だけで、transcript の本文は出さない。
  止められたエージェントは自分のセッションの transcript を読めるので、位置さえ分かれば内容は自分で取得できる。stderr は端末のスクロールバックやログに残るので、秘密の値をそこに出さない。
- 候補が 0 件のときは、transcript のレコードの形式から Claude Code / Codex を見分け、そのエージェントで、かつ自分のセッションの `.pending-extract<suffix>.<session key>` だけを消す。

##### 止めるのは自分のセッションのセンチネルだけ

commit を止めるかどうかは、自分のセッションのセンチネルだけで決める。他のセッションのセンチネルが残っていても、commit は通して知らせるだけにする。

- 学びを抽出できるのは、そのセッションで何が起きたかを知っている当人だけである。他のセッションの分を引き受けさせると、記録の確かさが「読んだ人の推測」に変わる。止めた相手が解消できないなら、止める意味が無い。
- センチネルは作業ツリーの単位で立ち、読み取りしかしていないセッションでも Stop フックが立てる。そのため、1 つの作業ツリーで複数のセッションを動かすと、互いを止めたままにしていた。

チェックの終了コードは次のとおりである。`0` は通す。`1` は通すが警告がある（他のセッションのセンチネルが残っている）。`2` は止める。

- PreToolUse を止めるのは `2` だけで、ほかの 0 以外は「止めない失敗」として stderr が表示される（[Claude Code](https://code.claude.com/docs/en/hooks) / [Codex](https://learn.chatgpt.com/docs/hooks) の両方で確かめた）。
- Copilot だけは違い、`preToolUse` は timeout 以外の 0 以外をすべて拒否する。
  [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) には、次のようにある。
  "a non-zero exit (other than exit 2) denies the tool call with `Denied by preToolUse hook (hook errored)`"
  警告の exit 1 がそのまま commit の拒否になり、しかも理由が hook errored になって案内が届かない。
  そのため Copilot のフックには第 1 引数に `-copilot` を渡し、チェックは警告を exit 0 で返す（`kaizen-stop-mark.sh` と同じ suffix の決まり）。
- key を持たない古い形式のセンチネルは、持ち主を特定できないので、自分の側として扱う（止める）。

Copilot では、lifecycle の検査の警告が届かない（既知の制約）。

- 警告は 0 以外で終えることで表示させる仕組みなので、0 以外がすべて拒否になる Copilot では、`-copilot` で exit 0 にするしかなく、その結果 stderr も表示されない。
- 止める（exit 2）動作は Copilot でも機能するので、`applied-to` の不整合など、止める側の検査は働く。
  届かないのは「止めないが知らせたい」警告だけで、これに当たるのは「`type` が機構なのに `applied-to` がドキュメントだけ」の 1 種類である。
- Copilot を主に使うプロジェクトでは、`kaizen-status-check.sh` を lefthook や CI からも実行して、警告を表示する別の方法を用意する（起動の方法は [`checks.json`](../checks.json)。人のコミットもこの方法でだけ検査される）。

自分のセッションの分が止める理由でなくなったら、他のセッションの未解決のセンチネルも、同じ差分の走査にかける（センチネルが transcript のパスと session id を持ち、そのセッションの checkpoint も残っているため）。候補が 0 件だと確かめられたものは、そこで解消する。

- 走査に使えるのは、チェックの締め切りの残りだけである。打ち切った分はそのまま残し、打ち切ったことを出力する（警告なしに諦めると、すべて見たうえで報告していると読めてしまうため）。
- 前回と同じ結論になる走査はくり返さない。候補が残っている（打ち切りも同じ）センチネルは解消されないので、そのままだと commit のたびに同じ範囲を走査し直し、締め切りの残りを使い切る。
  - チェックは、走査の結論を、それを決めた入力（transcript の大きさ・checkpoint・走査ツール・`jq`）と一緒に、センチネルの隣の `.kaizen/.extract-checkpoint.<session key>.foreign-scan` に残す。入力がどれも変わっていなければ走査せず、省いたことを出力する。
  - transcript は追記だけなので、大きさが変わっていなければ、前回と同じ結論になる。打ち切ったものは、前回より長い時間を使えるときだけ走査し直す。
  - 判定できない（走査ツールの exit 2）結果は、一時ファイルの作成の失敗など、一時的な失敗と区別できないので残さず、毎回走査し直す。
  - 省くのは「解消しない」側の結論だけである。解消（センチネルの削除）は、走査ツールがその場で候補 0 件を確かめたときに限るので、キャッシュが commit を通すかどうかを左右することはない。

##### 他のセッションのセンチネルは保持期間で回収する

放置されたセンチネルには解消できる人がいないので、時間で回収する方法を持つ。
チェックは commit のたびに、他のセッションのセンチネルのうち、1 行目の UTC のタイムスタンプから保持期間を過ぎたものを消す（自分のセッションの分と古い形式は対象外）。

- 消しても学びは失われない。センチネルは「未抽出である」という印で、transcript は残る（後から `kaizen extract` で読み直せる。失うのは印だけ）。
- 基準は時間だけにする。「判定できないので消す」にはしない。実際に未抽出の学びがある場合と区別できなくなるからである。
- 対応する checkpoint は消さない。持ち主が戻ってきたときの差分の走査の起点で、消すと全体の走査に戻る。

保持期間のデフォルトは 7 日である（1 週間あれば、持ち主が自分で抽出する機会があるという想定）。プロジェクトの `.kaizen/config` で変えられる。

```ini
# 他セッションのセンチネルを回収するまでの日数。既定 7。`never` で回収しない。
foreign_sentinel_retention_days = 14
```

- 1 行に 1 つ `KEY=VALUE` で書く。`#` から行末まではコメントで、前後の空白は無視する。同じキーが複数あれば、最後の定義を使う。
- 不正な値はデフォルトの値として扱い、そのことを stderr に出す（警告なしに扱うと、設定したつもりの日数で回収されていると読めてしまうため）。
- このファイルは制御ファイルではなくプロジェクトの設定なので、`.gitignore` に入れずにコミットする。

##### 解消コマンドの案内

止める理由（と、他のセッションについての警告）には、残っているセンチネルごとに、そのまま実行できる `kaizen-extract-done.sh` のコマンド（センチネルが持つ transcript のパス・エージェント・session id 入り）を並べる。
立てた本人が戻らなくても、引き受ける人がいれば、抽出して解消できるようにするためである。

案内は、記録された transcript の状態で 3 つに分ける。

- 実在するが読めない（権限・ファイルシステムの状態）場合だけ、`<transcript>` を埋める必要がある。抽出せずに解消する方法は出さない。
- 実在しない（剪定・削除・移動）場合と記録が無い場合は、探しても見つからないことがある。そのため、transcript 無しの解消コマンドも並べる（出さないと、解消する手段の無いまま止まり続ける）。

確かめる元の情報は次のとおりである。

- Claude Code の Hook の入力と handler の `if` は、[Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) を原本とする。
- Codex の matcher・`transcript_path`・exit code は、[Codex Hooks reference](https://learn.chatgpt.com/docs/hooks) を原本として確かめ直す。
- Copilot は、[GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) を原本とする。

同じセッションで複数回 commit しても、前回の抽出の後に増えた活動を毎回検査する。

- 抽出の完了時に、`kaizen-extract-done.sh` が checkpoint を transcript の終わりまで進める。そのため、Stop フックがターンの終わりごとにセンチネルを立て直しても、次の commit で走査されるのは、その位置より後の未処理の範囲だけになる。
- 新しい活動が無ければ、候補 0 件として自動で通る。1 本のブランチで複数回 commit しても、最初の commit までの活動しか抽出されない、という取りこぼしは起きない。

ただし、そのセンチネルに対応する抽出完了マーカー `.kaizen/.extract-done.<session key>` があり、かつそのセッションの checkpoint が無い間は、チェックを通す。
マーカーもセンチネルも session 単位なので、あるセッションの抽出の完了が、他のセッションの未抽出の印を隠すことはない。

- マーカーは、抽出の完了時に checkpoint を記録できなかった場合（transcript を渡されない・読めない・書き込みに失敗した）だけ、`kaizen-extract-done.sh` が記録する。
  差分の走査の起点が無いと、commit のたびに全体を走査することになり、止まったままになる。それを避けるための安全策である。セッションの開始時に、SessionStart のフック（`kaizen-context-inject.sh`）が、自分のセッションの分だけを消す。
- checkpoint を記録できたときはマーカーを書かず、既にあるマーカーも無効にする（残すとチェックが通してしまい、checkpoint より後の活動を取りこぼす）。
- 逆に、マーカーを書くときは古い checkpoint を消す。残すと、チェックがマーカーを尊重せず（上の条件）、古い起点から同じ候補を見つけて止まり続ける。抽出をやり直しても同じ状態に戻るので、安全策が機能しない。
- key を持たない古い形式のセンチネルだけは、マーカーで通す。key の無い checkpoint は 1 つのファイルで、そのセンチネルの transcript を指しているとは限らず、「新しい活動がある」根拠にできないためである。
- 複数のエージェントや複数のセッションが同時に動く場合は、抽出の完了時に、チェックが表示する `--sentinel-suffix` / `--session-id` 付きのコマンドを使い、他のセンチネルを消さない。

> 運用上の注意: チェックは、`git commit` を含む Bash の呼び出し全体を、実行の前に止める。
>
> - ただし、コミット先のリポジトリがこのプロジェクトの外だとコマンド行から分かる形（`git -C <外部dir>` / `--git-dir=<外部dir>`）は、チェックの対象外で、そのまま実行できる（テストの fixture として使い捨てのリポジトリにコミットする形。同じリポジトリの別の worktree に対するものは対象になる）。
> - コミット先がコマンド行から決まらない形（`cd <dir> && git commit`・パスの指定なし・変数の展開や glob を含むパス）は、判定できないものとして止める。
> - この対象外の判定は、Hook の入力からコマンド行を構造として取り出せた場合に限る。`jq` も `python3` も無く、生の JSON の照合に機能を減らして動く環境では判定せず、外部に対する形も止める。
> - `--work-tree` はリポジトリではなく作業ツリーだけを差し替える（`git --work-tree=<外部dir> commit` はプロジェクトのリポジトリにコミットされる）ので、それだけでは対象外にならない。`cd` と相対パスを一緒に使う形も、`git` が動く cwd が決まらないので、判定できないものとして扱う。
> - 逆に、コミット先のリポジトリが外部でも、`--work-tree` がプロジェクトの中を指す形（`git --git-dir=<外部dir>/.git --work-tree=<プロジェクト> commit`）は止める。コミットされる内容はこのプロジェクトの作業ツリーそのもので、抽出を求めている活動に当たるからである。
>
> そのため、`git add` などのコミットの前の準備や、センチネルの削除・マーカーの記録（`bash <KAIZEN_SCRIPTS_DIR>/kaizen-extract-done.sh`）を `git commit` と同じコマンドにまとめると、それらは実行されないまま止められる。
>
> - コミットの前の準備は、必ず `git commit` と別のコマンドに分ける。コミットした後は、`git log` / `git show` で対象が実際に入ったかを確かめる。
> - 同じ理由で、`git commit -F <msg>` のメッセージファイルを、`git commit` と同じコマンドの中の heredoc で作らない（止められたときに作られず、後の `-F` がファイルが無くて失敗する）。メッセージは別のコマンドで先に作り、使う直前にあることを確かめる。
> - 論理的なコミットを続けて分けるときは、各 `git commit` が成功したことを確かめてから、次を stage する。失敗したコミットは stage を残すので、次のコミットに巻き込まれ、無関係な変更が混在したり、誤ったラベルが付いたりする。
> - 通常は `kaizen --current` がセンチネルを消すので、手で消す必要はない。

##### チェックの締め切りとフックの timeout

フックが timeout で打ち切られると、チェックは commit を止められない。

- Claude Code は、timeout に達した command hook を、止めたものとして扱わない。
  [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) には、次のようにある。
  "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call. The call continues through the normal permission flow"
- Copilot も、timeout のときだけ通す（[GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)）。
- exit 2 で止めるはずの commit が、チェックが遅いとき（transcript が大きい長いセッション）ほど通り抜ける。

そのためチェックは、lifecycle の検査、自分のセッションの分の走査、他のセッションの分の走査を、開始からの経過時間で 1 つの締め切りに収める。

- 自分のセッションの分までで締め切りに当たったら、判定できないものとして止める（exit 2）。他のセッションの分は、打ち切ったことを出力して残す（もともと止めない処理である）。
- 締め切りのデフォルトは 8 秒で、環境変数 `KAIZEN_PRECOMMIT_DEADLINE_SECONDS`（2〜3600 の整数。不正な値はデフォルトとして扱い、stderr に出す）で変えられる。
  フックのコマンドの前に、`KAIZEN_PRECOMMIT_DEADLINE_SECONDS=20 bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh` のように付ける。

フックに timeout を付けるなら、締め切りより十分に長くする（目安は締め切りに 10 秒以上を足した値で、デフォルトの 8 秒なら 20 秒以上）。

- 締め切りの後にも、checkpoint の記録・センチネルの一覧・案内の出力が少し残るためである。締め切りを延ばしたら、timeout も同じだけ延ばす。
- 締め切りが短すぎると、走査が終わらず、自分のセッションの分で毎回止まる（通り抜けはしない）。
- `timeout` コマンドの無い環境では走査をせず、自分のセッションの分を止める。そのため、締め切りで区切れないのは lifecycle の検査 1 つだけになる。

各エージェントの PreToolUse（Bash ツールの実行前）に登録する。

##### Claude Code — PreToolUse (`.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh",
            "if": "Bash(git commit *)"
          }
        ]
      }
    ]
  }
}
```

この例は `timeout` を持たないので、Claude Code のデフォルト（600 秒）になる。ほかのフックに合わせて `timeout` を付けるなら、上の「チェックの締め切りとフックの timeout」に従って、締め切りより十分に長くする（短いと、打ち切られた commit が警告なしに通り抜ける）。

Claude Code の handler の `if` は、commit でない呼び出しでスクリプトそのものを起動しないための、最初の絞り込みである。
`if` に対応しない古い版では、このフィールドを省き、スクリプトの中の事前の絞り込みを代わりに使う。複合した Bash のコマンドでは、permission rule が安全側として handler を起動することがあるので、スクリプト側の厳密な判定も残す。

##### Codex — PreToolUse (`.codex/hooks.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh"
          }
        ]
      }
    ]
  }
}
```

##### GitHub Copilot — preToolUse (`.github/hooks/kaizen-session.json`)

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "matcher": "bash",
        "bash": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh -copilot",
        "cwd": ".",
        "timeoutSec": 20
      }
    ]
  }
}
```

> - Copilot の `preToolUse` は止められるが、stderr や理由をエージェントのコンテキストに渡せるかは、ドキュメントからは分からない。
>   少なくともコミットは止められるので、エージェントは失敗に反応して `kaizen --current` を実行できる。
> - 第 1 引数の `-copilot` は必須である。Copilot は timeout 以外の 0 以外をすべて拒否するので、これが無いと「他のセッションのセンチネルが残っている」だけの警告（exit 1）でも commit が拒否される。
> - Copilot の matcher はツールの名前までで、コマンドの文字列では絞れないので、スクリプトの中の事前の絞り込みを使う。
> - `timeoutSec` は、チェックの締め切りより十分に長くする。デフォルトの締め切り 8 秒に、締め切りの後に残る処理の余裕を足して 20 秒にしてある（上の「チェックの締め切りとフックの timeout」）。
>   `KAIZEN_PRECOMMIT_DEADLINE_SECONDS` で締め切りを延ばしたら、`timeoutSec` も同じだけ延ばす。
> - Copilot の `preToolUse` は timeout のときだけ通し、ほかの 0 以外は拒否する（[GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)）。
>   短すぎる `timeoutSec` は、チェックを警告なしに通り抜けさせるので、止める動作が機能しなくなる。
> - 今の camelCase の `preToolUse` の payload は `toolArgs` を渡すが、`transcriptPath` を渡さない。そのため、commit でない呼び出しの速い絞り込みと commit の判定は機能するが、候補 0 件のときに通す動作は使わず、`kaizen --current` を促して止める動作になる。
> - 挙動は [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) で確かめる。

#### 4-3. セッション開始時の参照を注入するフック（過去の学びをコンテキストに渡す）

セッションの開始時に、`.kaizen/` の未適用（`status: pending`）の学びの要約を stdout に出し、エージェントのコンテキストに参照データとして渡す。
`AGENTS.md` に文章で指示するより確実に、`.kaizen/` を参照させられる（KEDB 照合の起点）。

- これは「kaizen を実行せよ」という行動のリマインダーではなく、過去の学びの中身そのものを渡すものである。この点が echo のリマインダーと違う（末尾の「使わない方式」参照）。
- 判定は同梱のスクリプト（`kaizen-context-inject.sh`）が行う。pending の学びがあるときだけ要約を出し、無ければ何も出さずに exit 0 で終える。
- このスクリプトは、要約を出すのに加えて、自分のセッションの抽出完了マーカー `.kaizen/.extract-done.<session key>` を消す役割も持つ。
  セッションの開始が、そのセッションのマーカーが無効になる時点である。これで、checkpoint を記録できずにマーカーでチェックを解除したセッションでも、新しいセッションでは再びコミット前のチェックが機能する。
- 他のセッションのマーカーは消さない。消すと、まだ動いている別のセッションが、抽出済みの活動で再び止められる。
- ただし、stdin の `source` が `compact`（自動の圧縮。同じセッションの続き）のときは、マーカーを残す。source を取り出せない場合は、消す側（止める場面が増える安全側）として扱う。

このフックは、追跡しているファイルを書き換えない（読み取りとマーカーの削除だけ）。
注入が大きくならないように古い pending を忘却する処理は、`kaizen-extract-done.sh`（抽出の完了時）が受け持つ。リポジトリを変えるつもりのない調査だけのセッションで、作業ツリーに変更を残さないためである。詳細は下の「忘却の自動実行」にある。

> 注入されるかについての但し書き（PreToolUse のチェックの stderr の注入と同じ）:
>
> - Claude Code の `SessionStart` は、stdout をコンテキストに注入する。
> - Codex は、plain text の stdout を extra developer context として追加する（[Codex Hooks — SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart)）。
> - Copilot のセッション開始のフックは、stdout をコンテキストに注入できるかがドキュメントからは分からない。注入されれば役に立ち、されなくても害は無い、という扱いにする。

##### Claude Code — SessionStart (`.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-context-inject.sh"
          }
        ]
      }
    ]
  }
}
```

##### Codex — SessionStart (`.codex/hooks.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-context-inject.sh"
          }
        ]
      }
    ]
  }
}
```

詳細な形式は [Codex Hooks ドキュメント](https://learn.chatgpt.com/docs/hooks) を参照する。

##### GitHub Copilot — sessionStart (`.github/hooks/kaizen-session.json`)

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-context-inject.sh",
        "cwd": ".",
        "timeoutSec": 5
      }
    ]
  }
}
```

詳細な形式は [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) を参照する。

#### 4-4. Codex の Hook 定義をレビューして信頼する

Codex の managed でない command Hook は、定義を設定ファイルに足しただけでは実行されない。
Codex CLI で `/hooks` を開き、`.codex/hooks.json` の参照元と、Stop / PreToolUse / SessionStart の各 command が意図した定義であることを確かめて、信頼する。
信頼されるまで Codex は対象の Hook を飛ばすので、このレビューまでを初回のセットアップの完了条件にする。

信頼は、Hook の定義の今のハッシュに対して記録される。command や matcher などの定義を変えた場合は、新しい定義としてレビュー待ちに戻るので、変えた後も `/hooks` でレビューし直して信頼する。
`--dangerously-bypass-hook-trust` は、事前に Hook を検査した一時的な自動化のためのもので、プロジェクトの恒久的なセットアップを済ませる代わりには使わない。

詳細は [Codex Hooks ドキュメント「Review and trust hooks」](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) を参照する。

#### 4-5. 忘却の自動実行（Hook の設定は不要）

`kaizen-extract-done.sh`（抽出の完了時にエージェントが呼ぶ）は、センチネルを解消した後に `kaizen-forget.sh --auto` を実行する。
適用されないまま閾値の日数が過ぎ、優先度も上がらなかった pending を、`status: forgotten` にする。以後、その学びは SessionStart の注入に載らない。

Hook を新たに設定する必要はない。4-1〜4-3 の 3 つの Hook はそのままでよく、既存のインストールでもスクリプトを更新すれば有効になる。
忘却はファイルを動かさず、frontmatter の `status` を 1 行書き換えるだけで、忘却したノートは stderr に一覧で出る。

起動する位置をここにするのは、書き込むタイミングを「リポジトリを変える意思が確定した時点」にそろえるためである。

- SessionStart に置くと、リポジトリを変えるつもりのない調査だけのセッションでも、追跡しているファイルが書き換わる。
  その差分はステージされないまま残り、clean を確かめる工程（`git-worktree` の後片付け、`issue-batch` の収束）を止める。
- 抽出の完了時なら、呼び出し側はこの後に `.kaizen/` を stage して commit を実行し直すので、忘却の差分も新しいノートと同じ commit に入る。

判定の条件と呼び戻しの手順は、`references/housekeeping.md`「忘却」で定義する。閾値は、プロジェクトの `.kaizen/config` で変えられる。

```ini
# 自動忘却の有効・無効。既定 on。
forget_auto = on
# 記録からこの日数が過ぎた pending を候補にする。既定 30。
forget_after_days = 30
# この優先度までを候補にする（low | medium | high）。既定 medium。
forget_max_priority = medium
```

### 5. `.gitignore` に制御ファイルを追加する

kaizen の Hook（タスク終了時のセンチネルの記録・抽出完了マーカーの記録）は、`.kaizen/` の直下に一時的な制御ファイルを作る。これらはコミットの対象ではないので、プロジェクトの `.gitignore` に次を足す（すでにあれば何もしない）。

```gitignore
# kaizen の制御ファイル（Hook / 抽出完了時に作成する一時ファイル）
# ルートだけでなく、万一サブディレクトリに迷子で作られた場合も除外する（二重の防御）。
**/.kaizen/.pending-extract*
**/.kaizen/.extract-done*
**/.kaizen/.extract-checkpoint*
```

- `.kaizen/` ディレクトリそのものはコミットの対象で（学びの共有と履歴の追跡のため。`references/apply.md`「`.kaizen/` の Git 管理」参照）、除くのはこの 3 種類の制御ファイルだけである。
- `.kaizen/config`（コミット前のチェックのセンチネルの保持期間と、自動の忘却の閾値を置くプロジェクトの設定）は、除かずにコミットする。
- すでにこの 3 行を入れてあるプロジェクトは、追記しなくてよい。

`.extract-checkpoint.<session key>` は 4 行で、セッションをまたいで差分の走査を成り立たせる。1 行目が処理した transcript のパス、2 行目がバイト位置、3 行目が見分けたエージェント（空でもよい）、4 行目が処理した行数である。

- session 単位のファイルにするのは、同じプロジェクトで同じエージェントのセッションを 2 つ動かしたときに、走査の位置を上書きし合わないためである（session key を取れない環境では、1 つのファイルで機能を減らして動く）。
- コミット前のチェックが他のセッションの分の走査の結果を残す `.extract-checkpoint.<session key>.foreign-scan`（前の「止めるのは自分のセッションのセンチネルだけ」）も、同じパターンで除かれる。
- 2 行目と 4 行目は、走査ツールが実際に検査し終えた終わりの位置（`kaizen-candidate-scan.sh` が、検証したうえで 0 件のときに出す `scanned-bytes` / `scanned-lines`）を記録する。
  記録する側で `wc -c` を測り直すと、走査から記録までの間に追記されたレコードを、検査しないまま処理済みにしてしまう（通してしまう）。走査した位置を受け取れないときは止める。
- 3 行目は、前回の走査の後にレコードが 1 件も増えていないときに使う。レコードが無いとエージェントを判定できず、どのセンチネルを消せばよいかが分からなくなるので、確定した値を持ち越して、検証したうえで 0 件と判定する。
  3 行目を持たない古い checkpoint は判定できないので、止める。
- 4 行目は、候補の根拠を絶対行番号で出すときの起点である。これが無いと処理済みの部分を毎回読み直すことになるので、走査の量を差分に比例させるために記録する（4 行目の無い古い checkpoint では、数え直す）。

### 6. `multiagent-setup` スキルとの依存関係

`references/apply.md` の学びを適用する手順では、`multiagent-setup` スキルを使う。インストールしていなければ、先にインストールするようユーザーに案内する。

```bash
gh skill install shoji9x9/skills multiagent-setup --agent <利用するエージェント>
```

### 7. 定期実行（任意・GitHub Actions）

pending の学びは、コミット前のチェックが抽出を促す一方で、適用されるきっかけが無い。
閾値に達すれば自動の忘却が対象にするが、忘却は「適用せずに終わりにする」決着なので、適用する機会そのものを作るために、週に 1 回棚卸しする。

前提として、kaizen スキル本体がリポジトリにコミットされている必要がある。

- ワークフローは、checkout した作業ツリーの中だけを探し（`.claude/` / `.agents/` / `.github/` の下の各 `skills/kaizen/scripts/`）、見つからなければ意図して `exit 1` する。
- `~/.claude/skills/kaizen` のようなユーザーのスコープにだけ入れている場合、ランナーにはそれが無い。先にリポジトリのスコープにインストールしてコミットする（そうしないと、毎週の run が失敗し続ける）。

同梱のテンプレート `assets/kaizen-schedule.yml` を、リポジトリの `.github/workflows/` にコピーする。

```bash
# <スキル> はコピー元のインストール先（ユーザースコープからコピーしてもよい）。
mkdir -p .github/workflows
cp <スキル>/assets/kaizen-schedule.yml .github/workflows/kaizen-schedule.yml

# コピー後、スクリプト本体がリポジトリ内に在ることを確かめる。探索先はワークフローと同じ順。
# `ls -d A B C` は使わない——1 つでも欠けると非 0 で終わるため、正常な単一エージェント
# インストールでも必ず誤警告する（実測: 3 つ中 1 つ在る状態で exit 2）。
# **一致 0 件を成功に倒さない**——この検査が存在する理由そのものの状態（どこにも無い）を
# 無出力・exit 0 で通すと、毎週 run が赤くなる構成を「確認済み」と読んでコミットしてしまう。
# **ワークフローと同じく 2 本が揃っていることを見る**——レポート（`kaizen-schedule-report.sh`）と
# 追跡 Issue の照会（`tracking-issue-lib.sh`）で、片方だけ在るディレクトリは古い
# インストール。ここで片方しか見ないと、この検査は緑なのに毎週の run が探索で落ちる。
found=""
for d in .claude/skills/kaizen/scripts .agents/skills/kaizen/scripts \
         .github/skills/kaizen/scripts skills/kaizen/scripts; do
  if [ -r "$d/kaizen-schedule-report.sh" ] && [ -r "$d/tracking-issue-lib.sh" ]; then
    found="$d"
    break
  fi
done
if [ -n "$found" ]; then
  echo "OK: $found"
else
  echo "NG: スキル本体がリポジトリに無い。リポジトリスコープへインストールしてコミットする" >&2
  false
fi
```

コピーしただけでは動かない。定期実行は opt-in で、`.kaizen/config` に `schedule_enabled=on` を書いて初めて週に 1 回実行される（デフォルトは `off`）。
ワークフローを置いただけ、または配られただけで、入れた覚えのない定期実行が始まらないようにするためである。

```bash
# `.kaizen/` がまだ無いリポジトリでも通す。
mkdir -p .kaizen

# **既存の値を無条件に上書きしない。** 意図して `schedule_enabled=off` で凍結している
# リポジトリで追記すると（同じキーは後勝ちなので）無言で解除される。再実行のたびに
# 同じ行も増える。既にキーがあるなら人が読んで決める。
if grep -q '^[[:space:]]*schedule_enabled[[:space:]]*=' .kaizen/config 2>/dev/null; then
  echo "既に schedule_enabled がある。値を確認して手で直す:" >&2
  grep -n '^[[:space:]]*schedule_enabled[[:space:]]*=' .kaizen/config >&2
else
  # 最終行に改行が無いまま追記すると前の行と連結して**そのキーと schedule_enabled の
  # 両方**が壊れる（`kaizen_config_value` は行単位で読む）ので、先に改行を補う。
  if [ -s .kaizen/config ] && [ -n "$(tail -c1 .kaizen/config)" ]; then
    printf '\n' >>.kaizen/config
  fi
  printf 'schedule_enabled=on\n' >>.kaizen/config
fi
```

書いていないリポジトリでは、run は成功で終わり、step summary に `.kaizen/config に schedule_enabled=on が無い（定期実行は opt-in）` と理由が出る。

> このワークフローをすでに入れているリポジトリでスキルを更新するときも、同じ 1 行が要る。
> `schedule_enabled` のデフォルトは以前は `on` だったので、キーを書かずに動いていたリポジトリは、スキルを更新した後の最初の月曜から警告なしに止まる。
> run は成功で終わり、理由はスキップした run の step summary にしか出ないので、Issue が更新されなくなって初めて気づく。
> 更新するときは、先に `.kaizen/config` に `schedule_enabled=on` を入れてコミットする。

このワークフローは、リポジトリを変えない。pending の一覧（エージェントを使う場合はその分析も）を 1 つの Issue にまとめ、既存の追跡 Issue があれば本文を更新する。pending が 0 件になれば、その Issue を閉じる。

追跡 Issue のタイトルは `kaizen: 未適用の学び (YYYY-MM-DD)` で、実行のたびに更新した日の名前に変える。

- open な 1 つは常に「最後に棚卸しした日」を示し、閉じたものは当時の日付のまま残るので、Issue の一覧で世代を区別できる（決まったタイトルだと、手で閉じるたびに同じ名前の Issue が open と closed に並ぶ）。
- 既存の Issue は、接頭辞 `kaizen: 未適用の学び` に、末尾が空か、半角空白付きの `(YYYY-MM-DD)` が続くものだけを取得する。単純な前方一致だと、「kaizen: 未適用の学びについて相談」のような関係の無い Issue を毎週上書きしてしまう。
- 末尾が空のものも受け付けるのは、日付を入れる前に作った追跡 Issue を引き継いで、名前を変えるためである。

適用（`/kaizen apply`）は、人が開いたセッションで行う。`references/apply.md` はグループごとにユーザーの承認を求める設計で、承認を無人にすると「適用したことにする」方法ができるからである。

#### 2 つのモード

| mode | 何をするか | 必要なもの |
|------|-----------|-----------|
| `notify`（デフォルト） | pending の一覧表だけを Issue にする | なし（LLM を動かさない） |
| `agent` | エージェントに pending を読ませ、グループ分け・根本原因・適用先の提案までさせて Issue に載せる | 選んだエージェントの資格情報（secret） |

`agent` でも、エージェントは読み取りだけを行う。レポートは、ワークフローが Issue に転記する。

#### エージェントの選択

| agent | 実行方法 | 資格情報（secret） | model | effort |
|-------|---------|------------------|-------|--------|
| `claude`（デフォルト） | [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) | `ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN` | `claude_args` の `--model` へ渡す | 対応する入力が無いため無視 |
| `codex` | [`openai/codex-action`](https://github.com/openai/codex-action) | `OPENAI_API_KEY` | `model` 入力 | `effort` 入力 |
| `copilot` | [Copilot CLI をプログラム的に実行](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/automate-with-actions) | `COPILOT_GITHUB_TOKEN`（Copilot を使える PAT） | `--model` | 対応する入力が無いため無視 |

`effort` を受け取るのは codex だけである。

- ほかのエージェントに指定した場合は、使わなかったことを stderr に出す（警告なしに無視すると、effort を指定したつもりの run とデフォルトの run を、出力で区別できない）。
- 入力名は、各 action の `action.yml` と、Copilot CLI のプログラム実行リファレンス（`-p` / `--model` / `-s` / `--allow-tool` / `--no-ask-user`）で確かめた。
  リファレンスは <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference> にある。
  ワークフローが固定した action の版を上げるときは、入力名を同じ元の情報で確かめ直す。

#### 設定（優先順位のある 3 つの層）

上の層ほど優先する。どの層の値を使ったかは、実行ログ（stderr）に 1 行ずつ出るので、「設定したつもりの値で動いていない」ことを run のログだけで切り分けられる。

1. `workflow_dispatch` の入力（`mode` / `agent` / `model` / `effort`）。その 1 回だけの上書きで、手で試すときに使う
2. `.kaizen/config` の `schedule_*` キー。リポジトリの意思で、コミットされてレビューを通る
3. デフォルトの値。`schedule_enabled=off`（opt-in）/ `mode=notify` / `agent=claude` で、model と effort はエージェントのデフォルトになる

```ini
schedule_enabled=on       # 定期実行の有効・無効（**既定 off**。この 1 行が無いと走らない）
schedule_mode=notify      # notify | agent（既定 notify）
schedule_agent=claude     # claude | codex | copilot（既定 claude）
schedule_model=           # 空ならエージェント側の既定モデル
schedule_effort=          # codex のみ有効
```

不正な値はデフォルトの値として扱い、そのことを stderr に出す（`.kaizen/config` のほかのキーと同じ方針）。
`schedule_enabled` はデフォルトが `off` なので、キーが無い場合も不正な値の場合も止まる（打ち間違えた設定が、有効にした証拠にならないようにする）。

#### 止め方（凍結したプロジェクト・レートリミットに近いとき）

止め方は 2 つあり、どちらかが当てはまれば止まる（一時停止は上書きではなく、追加の安全策である）。

- リポジトリ変数 `KAIZEN_SCHEDULE_SKIP`（`true` / `on` / `1` 等）。コミットを伴わない一時停止で、`gh variable set KAIZEN_SCHEDULE_SKIP --body true` で設定し、`gh variable delete KAIZEN_SCHEDULE_SKIP` で戻す
- `.kaizen/config` の `schedule_enabled=off`（または行ごと消す）。凍結したプロジェクトなど、止めた状態をリポジトリに残したいときに使う。デフォルトが `off` なので、行を消すだけでも止まる

`schedule_skip` のような、意味が逆のキーは足していない。`schedule_enabled=off` と並ぶと二重の否定になり、どちらが有効かを読み違える。止めるのは `schedule_enabled` の側にまとめる。

スキップした run は Issue を作らず、理由を step summary に出して成功で終わる（失敗にすると通知が飛び、止めたい状況で邪魔になる）。

#### 取りこぼさないための安全策

「エージェントが動かなかった」と「エージェントが何も見つけなかった」は、放っておくと同じ出力になる。そのため、次の分岐を持たせている。

- 資格情報が無い場合は、エージェントを起動せずに `notify` として動き、Issue に「未設定のため通知のみ」と書く
- pending が 0 件の場合は、`agent` を指定していても `notify` として動く（エージェントに渡す材料が無い）。既存の Issue は閉じる
- エージェントが失敗した、または何も出さなかった場合は、ジョブを失敗させず、Issue に run へのリンク付きでその旨を書く。
  判定は 2 段で、まずステップの `outcome` を見て、成功していれば出力ファイルが空でないかを見る。片方だけでは足りない。
  - `copilot` は CLI の stdout がそのままレポートになるので、レート制限などで途中で終わった run の一部の出力も空でなくなる。空でないことだけを見ると、未完成のレポートを完成品として転記する。
  - 逆に空かどうかを見ないと、正常に終わって何も出さなかった run を失敗と区別できない。
  - Issue には、この 2 つが別の文言で出る
- `kaizen-schedule-report.sh` と `tracking-issue-lib.sh` がそろったディレクトリが無い場合だけは、失敗させる。
  材料を作れないまま先へ進むと、空の Issue が「異常なし」として出てしまう。照会のスクリプトが欠けたまま進むと、追跡 Issue を取得できない。
  片方だけのディレクトリは使わない（古いインストールから照会の古い版を読まないようにする）

## 使わない方式

- echo による行動のリマインダー（Stop / sessionEnd / SessionStart）: 「コミットの前に kaizen を実行せよ」のような行動を促す文章は、エージェントの行動を確実には変えられず、見落とされる。とくに Stop / sessionEnd の stdout はセッションの終了後なので、コンテキストに渡らない。
  - 上の「セッション開始時の参照を注入するフック」は別のものである。行動を促すのではなく、過去の学びのデータそのものをコンテキストに渡すので使う。SessionStart は、Stop / sessionEnd と違い、対応するエージェントでは stdout がコンテキストに注入される。
- `AGENTS.md` 等への文章での指示: 守られない確率が高いので、主な起動の手段にはしない。
- lefthook / git の pre-commit: 確実に動くが LLM を動かせないので、結局リマインダーにとどまり、echo と同じ問題になる。抽出と適用はエージェントの仕事なので、コミットを止めてエージェントに返す PreToolUse のチェックを使う。
- スキルの YAML の frontmatter の `hooks`（`SKILL.md`）: kaizen に必要な「常に有効で、すべてのエージェントで動く」を満たせないので、主な起動の手段にはしない。
  - frontmatter の hooks は、そのスキルが有効な間だけ機能し、常に有効にはできない（[Claude Code skills ドキュメント](https://code.claude.com/docs/ja/skills) 参照）。
    kaizen を起動していない通常のセッションのコミットをチェックできず、セッションの開始時の学びの注入も保証されない。
  - Claude Code だけの機能で、Codex / Copilot には無い。このスキルは 3 つのエージェントで共通に機能させる必要がある。
  - そのため、スキルのライフサイクルに依存しない `.claude/settings.json` / `.codex/hooks.json` / `.github/hooks/` への設定を使う。
