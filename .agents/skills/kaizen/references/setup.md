# kaizen セットアップガイド

インストール後・初回のみ実行する。kaizen を「自動で回る」状態にするための設定をまとめる。

## 3 つの Hook の役割

Hook からエージェント自身を呼び出して LLM を動かすことはできないため、役割を 3 つに分ける:

- **タスク終了時 Hook（記録役）**: センチネルファイル `.kaizen/.pending-extract<agent suffix>.<session key>` を残し、「未抽出の活動がある」ことを記録する。センチネルは **session 単位**で、中身に解消用の同定情報（transcript パス・エージェント・session id）を持つ。
- **コミット前 PreToolUse ゲート（実行役）**: このプロジェクト宛ての `git commit` を捕捉し（コマンド行から外部リポジトリ宛てと分かるものは対象外）、まず lifecycle 整合を検査する。
  未抽出センチネルがあり Hook から transcript パスを取得できる場合は、checkpoint との間だけを走査する。候補ゼロを検証できたときは自動通過し、候補あり・形式不明・timeout は `kaizen --current` を促す。
  全エージェント（Claude Code / Codex / Copilot）で commit のブロックは機能する。transcript を提供しない Copilot は候補ゼロの自動通過だけを使わず、安全側の従来フローへ戻る。
- **セッション開始時 Hook（参照注入役）**: `.kaizen/` の未適用（`status: pending`）の学びダイジェストを stdout に出力し、エージェントのコンテキストへ「参照データ」として供給する。これにより過去の学びを踏まえてタスクに着手できる（KEDB 照合の入口）。
  Claude Code は SessionStart の stdout を context へ注入する。
  Codex は plain text の stdout を extra developer context として追加する（[Codex Hooks — SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart)）。
  Copilot は注入可否がドキュメント上不明確なため、効けば加点・効かなくても無害というベストエフォート。

> echo による行動リマインダーや `AGENTS.md` への散文の指示は、エージェントの行動を確定的に変えられず守られない確率が高いため主トリガーにはしない。詳細は末尾「使わない方式」を参照。

既に Hook 設定が存在する場合は、上書きせず、既存設定を更新するかユーザーに確認する。

## 手順

### 1. 対象エージェントの確認

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

### 2. 設定するエージェントをユーザーに確認

AskUserQuestion で確認する。対象エージェントが明示されていない場合のみ確認する。

### 3. 基底ドキュメントにエージェントの自己設定編集の制約を追記する（既存なら除く）

プロジェクトの**基底ドキュメント**（常時ロードされる指示ドキュメント。マルチエージェント構成では `AGENTS.md`、
それが無ければ実際に使っている `CLAUDE.md` / `.github/copilot-instructions.md`。
定義と判断は `multiagent-setup` の `references/component-selection.md`「基底ドキュメントとは」を single source of truth として参照する）に、
以下の「エージェントの自己設定編集について」節が**まだ無ければ追記する**（既にあれば何もしない）。
これは特定のエージェント固有ではなく全エージェントに関わる一般原則のため、スキル内ではなく基底ドキュメントに置く。
kaizen は配布スキルなので、この追記をインストール手順に含めることでインストール先プロジェクトにも伝播させる。
AGENTS.md を持たない下流（`CLAUDE.md` のみ／`.github/copilot-instructions.md` のみ）でも、その基底ドキュメントへ追記することで伝播が効く。

追記する内容（基底ドキュメント）:

```markdown
## エージェントの自己設定編集について

コーディングエージェントは自身の設定ファイルの編集が制限される場合がある（自己改変ガード）。
設定ファイルを書き換える作業（kaizen の Hook セットアップ等）でブロックされたら、適用すべき内容を
一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` 等での適用を依頼する。

| エージェント | 自己設定ファイル | 編集可否 |
|------------|---------------|---------|
| Claude Code | `.claude/settings.json` | 不可（ハードブロック。bypass でも確認が出る） |
| Codex | `.codex/config.toml` / hooks | 現状は可（ただし credentials/auth/profile 等の上書きは制限） |
| GitHub Copilot | `.github/agents/`（指示） | 不可（ハードブロック） |
| GitHub Copilot | `.github/hooks/`（フック） | 可（手動承認ガードの設定を推奨） |
```

### 4. 各エージェントに 3 つの Hook を設定する

> **設定ファイル編集時の注意**: この手順は `.claude/settings.json` などエージェントの設定ファイルを編集する。Step 3 の表のとおり、Claude Code はこれを直接編集できない（自己改変ガード）。
> ブロックされたら、適用すべき JSON を一時ファイルに書き出し、ユーザーに `! cp <tmp> .claude/settings.json` での適用を依頼する。Codex（`.codex/hooks.json`）/ Copilot（`.github/hooks/...`）は直接編集できる。

タスク終了時 Hook・PreToolUse ゲート・参照注入フックは、いずれもスキルにバンドルされたスクリプトの実体（`kaizen-stop-mark.sh` / `kaizen-precommit-gate.sh` / `kaizen-context-inject.sh`）をフックから直接参照する。プロジェクトへのコピーは不要。
これらのスクリプトは `.kaizen/` を**いま作業している作業ツリーの root** 基準で解決するため、フックがサブディレクトリ cwd で起動しても迷子のセンチネルや取り違えが起きない。
解決順は、Hook payload の `cwd` から辿った git root → プロセスの cwd から辿った git root → `$CLAUDE_PROJECT_DIR` → cwd。
git root を採用するのは `$CLAUDE_PROJECT_DIR` と同じリポジトリ（本体かその worktree）だと共有 git ディレクトリの一致で確かめられたときだけで、ネストした別リポジトリへ cd した状態でフックが起動しても、そこへは書かない。
git worktree で作業している場合も**コミット対象のリポジトリ側**の `.kaizen/` を見る（セッションの起点が worktree の外でも、ゲートと抽出側の参照先が分かれない）。

**まず kaizen scripts ディレクトリを特定する。** `<KAIZEN_SCRIPTS_DIR>` は、いま読み込んでいる kaizen スキル本体（この `setup.md` の 1 階層上＝`../`）直下の `scripts/`（＝`../scripts/`）の絶対パス。
インストール先（エージェント・スコープ）により場所が異なるため、下のスニペットで主要な配置を確認し、最初に存在したパスを `<KAIZEN_SCRIPTS_DIR>` として下記 JSON の該当箇所を実際のパスへ置き換える。
**どれにも無ければ、実際の kaizen インストール先の `scripts/` を使う（特定できなければユーザーに確認する）。**

```bash
for d in .agents/skills/kaizen/scripts .claude/skills/kaizen/scripts \
         .github/skills/kaizen/scripts \
         "$HOME/.claude/skills/kaizen/scripts" "$HOME/.codex/skills/kaizen/scripts"; do
  [ -d "$d" ] && (cd "$d" && pwd) && break
done
```

> **フック起動は cwd 非依存にする。** Stop / PreToolUse フックは、エージェントが `cd` したサブディレクトリの cwd を継承して起動することがある（Issue #53 / `.kaizen/2026-06-16-relative-path-hook-cd-stray-sentinel.md`）。
> このとき `bash <KAIZEN_SCRIPTS_DIR>/...` が相対パスだとスクリプト自体が見つからず起動に失敗するため、`<KAIZEN_SCRIPTS_DIR>` は**絶対パス**にする（上の `cd … && pwd` が絶対パスを返す）。
> 絶対パスをハードコードしたくないプロジェクト内配置では、コマンドを `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}` で前置して root 基準に解決する（このリポジトリの `.claude/settings.json` 等はこの形）。
> これはスクリプト**本体の在り処**を解決するための前置きで、書き込み先の `.kaizen/` は各スクリプトが上記のとおり作業ツリー基準で別に解決する。

**重要（3 つの hook を同一ファイルにマージする）**: 4-1〜4-3 の JSON は、エージェントごとに**同じ 1 つの設定ファイル**
（Claude Code=`.claude/settings.json` / Codex=`.codex/hooks.json` / Copilot=`.github/hooks/kaizen-session.json`）に対するキー断片を示す。
各ブロックをそのままファイルに書き込んで置き換えると、先に設定した hook キーが上書きされて 1 つしか残らない。
既存の設定（他スキルの hook 含む）を保持したまま、3 つの hook キーを**同一ファイル内にマージ**すること
（3 エージェントとも `hooks` オブジェクト配下にイベントキーを併置する。Claude Code と Codex は同じ構造＝イベント→（任意の `matcher`＋）`hooks` 配列→`type: command`。`matcher` は任意で、省略すると全マッチ。Copilot は加えてトップレベルに `version` を持つ）。
Codex の `matcher` は正規表現で、PreToolUse は `Bash` に限定する。SessionStart は `startup` / `resume` / `clear` / `compact` のすべてでマーカー管理が必要なため省略して全マッチとし、`Stop` も matcher が無視されるため省略する。
Codex は設定ファイルをマージしただけでは Hook を実行しない。3 つの定義をマージした後、4-4 の信頼手順まで完了させる。

#### 4-1. タスク終了時 Hook（センチネル記録のみ）

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

詳細なフォーマットは [Codex Hooks ドキュメント](https://learn.chatgpt.com/docs/hooks) を参照すること。

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

詳細なフォーマットは [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) を参照すること。

#### 4-2. コミット前 PreToolUse ゲート（自動実行の主トリガー）

`git commit` を捕捉し、lifecycle 不整合または未処理の学び候補があればブロックして、エージェントに `kaizen --current` の実行を促す。Claude Code / Codex / Copilot のいずれも「ツール実行前に発火し、ブロックできる」Hook（PreToolUse / preToolUse）を備えるため、全エージェント共通で機能する。

判定はスキルにバンドルされた `kaizen-precommit-gate.sh` が行う。非 commit は Bash 組み込みの prefilter だけで終了し、jq / python / git を起動しない。
commit のときだけ `kaizen-status-check.sh` を実行し、未抽出センチネルがあるときだけ `kaizen-candidate-scan.sh` が `transcript_path` の未処理範囲を最大 8 秒で走査する。
走査結果は `0` = 候補あり、`1` = 検証済みゼロ、`2` = 不明。`1` だけが自動通過し、候補あり・読めない形式・jq 不在・timeout は **exit code 2 + stderr** でブロックする。
ブロック理由に載る候補の根拠は、カテゴリ（`user correction` / `tool error` / `repeated edit`）と **transcript の行番号**だけで、transcript の本文は出さない。
ブロックされたエージェントは自分のセッションの transcript を読めるため、位置さえ分かれば内容は自分で取得できる。stderr は端末のスクロールバックやログに残るので、秘密値をそこへ流さない。
候補ゼロでは transcript のレコード形式から Claude Code / Codex を識別し、**そのエージェントかつ自セッション**の `.pending-extract<suffix>.<session key>` だけを削除する。別エージェント・別セッションのセンチネルが残っていれば commit は通さず、所有者側の抽出を待つ。
自セッション分がブロック要因でなくなったら、**他セッションの未解決センチネルも同じ差分走査に掛ける**（センチネルが transcript パスと session id を持ち、そのセッションの checkpoint も残っているため）。
候補ゼロを検証できたものはそこで解消し、候補が残っているものだけがブロックする。
これが無いと、Stop フックが毎ターン立てるセンチネルのうち「一度も commit せずに終わったセッション」の分が恒久ブロッカーとして残り、以後どのセッションの commit も人手の抽出なしには通らない。
走査には合計時間の上限があり、打ち切った分は fail closed のまま残して打ち切った旨を出す（黙って諦めると「全部見た上でブロックしている」と読めてしまうため）。
ブロック理由には残っているセンチネルごとに**そのまま実行できる `kaizen-extract-done.sh` のコマンド**（センチネルが持つ transcript パス・エージェント・session id 入り）を並べる。立てた本人が戻らなくても、ブロックされた側が抽出して解消できるようにするため。
Claude Code の Hook 入力と handler `if` は [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) を正本とする。
Codex の matcher・`transcript_path`・exit code は [Codex Hooks reference](https://learn.chatgpt.com/docs/hooks) を正本として再検証する。
Copilot は [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) を正本とする。
ただし、そのセンチネルに対応する抽出完了マーカー `.kaizen/.extract-done.<session key>` が存在する間は素通りする（マーカーもセンチネルも session 単位なので、あるセッションの抽出完了が他セッションの未抽出シグナルを覆い隠さない）。
マーカーは抽出完了時に `kaizen-extract-done.sh` が記録し、セッション開始時に SessionStart フック（`kaizen-context-inject.sh`）が**自セッション分だけ**削除する。
これにより、Stop フックがターン終了ごとにセンチネルを再装填しても、同一セッション内で既に抽出済みなら後続の commit を再ブロックしない。複数エージェント・複数セッションが同時稼働する場合、抽出完了時はゲートが表示する `--sentinel-suffix` / `--session-id` 付きコマンドを使い、他のセンチネルを削除しない。

> **運用上の注意（git commit を含む呼び出しは全体がブロックされる）**: ゲートは `git commit` を含む Bash 呼び出し**全体**を実行前にブロックする。
> ただし、**コミット先のリポジトリがこのプロジェクト外だとコマンド行から分かる形**（`git -C <外部dir>` / `--git-dir=<外部dir>`）はゲートの対象外で、そのまま実行できる（テストのフィクスチャとして使い捨てリポジトリへコミットする形。同じリポジトリの別 worktree 宛ては対象内）。
> コミット先がコマンド行から決まらない形（`cd <dir> && git commit`・パス指定なし・変数展開や glob を含むパス）は判定不能として従来どおりブロックする。
> この対象外判定は Hook 入力からコマンド行を構造として取り出せた場合に限る。`jq` も `python3` も無く生 JSON 照合へ縮退した環境では判定を行わず、外部宛ての形も従来どおりブロックする。
> `--work-tree` はリポジトリではなく作業ツリーだけを差し替えるため（`git --work-tree=<外部dir> commit` はプロジェクトのリポジトリへコミットされる）、単独では対象外にならない。`cd` と相対パスの併用も、`git` が走る cwd が確定しないため判定不能として扱う。
> 逆に、コミット先 repo が外部でも `--work-tree` がプロジェクト内を指す形（`git --git-dir=<外部dir>/.git --work-tree=<プロジェクト> commit`）はブロックする。コミットされる内容がこのプロジェクトの作業ツリーそのもので、抽出を求めている活動にあたるため。
> そのため `git add` などコミット前準備や、センチネル削除・マーカー記録（`bash <KAIZEN_SCRIPTS_DIR>/kaizen-extract-done.sh`）を `git commit` と**同一コマンドにまとめると、それらが実行されないままブロックされる**。
> コミット前準備は必ず `git commit` と別コマンドに分ける。コミット後は `git log` / `git show` で対象が実際に入ったか確認する。
> 同様に、`git commit -F <msg>` のメッセージファイルを `git commit` と同じコマンド内の heredoc で作らない（ブロック時に作られず、後続の `-F` がファイル不在で失敗する）。メッセージは別コマンドで先に作り、使用直前に存在を確認する。
> 論理コミットを連続で分けるときは、各 `git commit` の成功を確認してから次を stage する。失敗したコミットは stage を残し、次のコミットに巻き込まれて無関係な変更の混在・誤ラベルを生む。
> 通常は `kaizen --current` がセンチネルを削除するので手動削除は不要。

各エージェントの PreToolUse（Bash ツール実行前）に登録する。

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

Claude Code の handler `if` は非 commit でスクリプト自体を起動しない第一段フィルタ。`if` をサポートしない旧版ではこのフィールドを省略し、スクリプト内 prefilter をフォールバックとして使う。複合 Bash コマンドは permission rule が安全側に handler を起動する場合があるため、スクリプト側の厳密判定を残す。

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
        "bash": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh",
        "cwd": ".",
        "timeoutSec": 15
      }
    ]
  }
}
```

> Copilot の `preToolUse` はブロックできるが、stderr/理由をエージェントのコンテキストへ渡せるかはドキュメント上不明確。
> 最低限コミットはブロックされるため、エージェントは失敗に反応して `kaizen --current` を実行する余地が残る。
> Copilot の matcher は tool 名まででコマンド文字列を絞れないため、スクリプト内 prefilter を使う。`timeoutSec` は内部走査の 8 秒より長くし、内部 timeout を exit 2 の fail-closed に変換できる余地を持たせる。
> 現行の camelCase `preToolUse` payload は `toolArgs` を渡すが `transcriptPath` を渡さない。そのため非 commit の高速 prefilter と commit 判定は機能する一方、候補ゼロの自動通過は使わず従来の `kaizen --current` ブロックへフォールバックする。
> 挙動は [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) で確認すること。

#### 4-3. セッション開始時 参照注入フック（過去の学びをコンテキストへ供給）

セッション開始時に `.kaizen/` の未適用（`status: pending`）の学びダイジェストを stdout に出力し、エージェントのコンテキストへ「参照データ」として供給する。`AGENTS.md` への散文の指示より確実に `.kaizen/` を参照させられる（KEDB 照合の入口）。

これは「kaizen を実行せよ」という**行動リマインダーではなく**、過去の学びの**中身そのものを供給する**点が echo リマインダーと異なる（末尾「使わない方式」参照）。判定はバンドルスクリプト（`kaizen-context-inject.sh`）が行い、pending な学びがあるときだけダイジェストを出力し、無ければ何も出さず exit 0 で抜ける。
このスクリプトはダイジェスト出力に加えて、**自セッションの**抽出完了マーカー `.kaizen/.extract-done.<session key>` を削除する役割も担う（セッション開始 = そのセッションのマーカーの失効点。これにより新しいセッションでは再びコミット前ゲートが効く）。
他セッションのマーカーは消さない——消すと、まだ生きている別セッションが抽出済みの活動で再びブロックされる。
ただし stdin の `source` が `compact`（自動圧縮。同一セッションの継続）のときはマーカーを残す。source を取り出せない場合は削除側（ブロックが増える安全側）に倒す。

> **注入可否の但し書き**（PreToolUse ゲートの stderr 注入と同じ）:
> Claude Code の `SessionStart` は stdout を context へ注入する。
> Codex は plain text の stdout を extra developer context として追加する（[Codex Hooks — SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart)）。
> Copilot のセッション開始フックは stdout を context へ注入できるかドキュメント上不明確なため、効けば加点・効かなくても無害というベストエフォート。

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

詳細なフォーマットは [Codex Hooks ドキュメント](https://learn.chatgpt.com/docs/hooks) を参照すること。

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

詳細なフォーマットは [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) を参照すること。

#### 4-4. Codex の Hook 定義をレビューして信頼する

Codex の非 managed command Hook は、定義を設定ファイルへ追加しただけでは実行されない。Codex CLI で `/hooks` を開き、
`.codex/hooks.json` の参照元と Stop / PreToolUse / SessionStart の各 command が意図した定義であることを確認して信頼する。
信頼されるまでは Codex が対象 Hook をスキップするため、このレビューまでを初回セットアップの完了条件にする。

信頼は Hook 定義の現在のハッシュに対して記録される。command や matcher などの定義を変更した場合は新しい定義としてレビュー待ちに戻るため、
変更後も `/hooks` で再レビューして信頼する。`--dangerously-bypass-hook-trust` は事前に Hook を検査する一時的な自動化用であり、
プロジェクトの永続セットアップを完了させる代わりには使わない。

詳細は [Codex Hooks ドキュメント「Review and trust hooks」](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) を参照すること。

### 5. `.gitignore` に制御ファイルを追加する

kaizen の Hook（タスク終了時のセンチネル記録・抽出完了マーカー記録）は、`.kaizen/` 直下に一時的な制御ファイルを作る。これらはコミット対象ではないため、プロジェクトの `.gitignore` に以下を追加する（既にあれば何もしない）:

```gitignore
# kaizen の制御ファイル（Hook / 抽出完了時に作成する一時ファイル）
# ルートだけでなく、万一サブディレクトリに迷子で作られた場合も除外する（二重の防御）。
**/.kaizen/.pending-extract*
**/.kaizen/.extract-done*
**/.kaizen/.extract-checkpoint*
```

`.kaizen/` ディレクトリそのものはコミット対象（学びの共有・履歴追跡のため。`references/apply.md`「`.kaizen/` の Git 管理」参照）で、除外するのはこの 3 種の制御ファイルだけ。
`.extract-checkpoint.<session key>` は処理済み transcript のパス（1 行目）・バイト位置（2 行目）・識別済みエージェント（3 行目、空可）・処理済み行数（4 行目）を保持し、セッションをまたいで差分走査を成立させる。
**session 単位のファイルにするのは、同じプロジェクトで同じエージェントのセッションを 2 つ動かしたときに走査位置を上書きし合わないため**（session key を取れない環境では単一ファイルへ縮退する）。
2 行目・4 行目は**走査器が実際に検査し終えた終端**（`kaizen-candidate-scan.sh` が検証済みゼロのときに出力する `scanned-bytes` / `scanned-lines`）を記録する。
記録側で `wc -c` を測り直すと、走査から記録までの間に追記されたレコードを検査しないまま処理済みにしてしまう（fail open）。走査済み位置を受け取れないときはブロックする（fail closed）。
3 行目は、前回の走査以降にレコードが 1 件も増えていないときに使う。レコードが無いとエージェントを判定できず、どのセンチネルを消せばよいか分からなくなるため、
確定済みの値を持ち越して「検証済みゼロ」と判定する。3 行目を持たない旧 checkpoint は判定できないので従来どおりブロックする（fail closed）。
4 行目は候補の根拠を絶対行番号で出すときの起点。これが無いと処理済み部分を毎回読み直すことになるため、走査を O(差分) に保つために記録する
（無い旧 checkpoint は数え直しへ縮退する）。

### 6. `multiagent-setup` スキルとの依存関係

`references/apply.md` の学び適用ステップでは `multiagent-setup` スキルを使用する。インストール済みでなければ事前にインストールするようユーザーに案内する:

```bash
gh skill install shoji9x9/skills multiagent-setup --agent <利用するエージェント>
```

## 使わない方式

- **echo による行動リマインダー（Stop / sessionEnd / SessionStart）**: 「コミット前に kaizen を実行せよ」のような**行動を促す散文**は、エージェントの行動を確定的に変えられず見落とされる。特に Stop / sessionEnd の stdout はセッション終了後で context に渡らない。
  - ※ 上記「セッション開始時 参照注入フック」は別物。行動を促すのではなく**過去の学びデータそのものを context に供給する**ため使う。SessionStart は（Stop / sessionEnd と違い）対応エージェントでは stdout が context に注入される。
- **`AGENTS.md` 等への散文の指示**: 守られない確率が高い。主トリガーにはしない。
- **lefthook / git pre-commit**: 確定的だが LLM を動かせず、結局リマインダー止まりで echo と同じ問題に陥る。抽出・適用はエージェントの仕事なので、コミットをブロックしてエージェントに返す PreToolUse ゲートを使う。
- **スキルの YAML フロントマター `hooks`（`SKILL.md`）**: kaizen の「常時オン・全エージェント」要件を満たせないため主トリガーにはしない。
  - フロントマター hooks は**そのスキルがアクティブな間だけ**有効で、常時オンにできない（[Claude Code skills ドキュメント](https://code.claude.com/docs/ja/skills) 参照）。
    kaizen を起動していない通常セッションのコミットをゲートできず、セッション開始時の学び注入も保証されない。
  - **Claude Code 専用**で Codex / Copilot には無い。本スキルは3エージェント共通で効かせる必要がある。
  - そのため、スキルのライフサイクルに依存しない `.claude/settings.json` / `.codex/hooks.json` / `.github/hooks/` への設定を採る。
