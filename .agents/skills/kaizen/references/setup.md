# kaizen セットアップガイド

インストール後・初回のみ実行する。kaizen を「自動で回る」状態にするための設定をまとめる。

## 3 つの Hook の役割

Hook からエージェント自身を呼び出して LLM を動かすことはできないため、役割を 3 つに分ける:

- **タスク終了時 Hook（記録役）**: センチネルファイル `.kaizen/.pending-extract*` を残し、「未抽出の活動がある」ことを記録する。
- **コミット前 PreToolUse ゲート（実行役）**: `git commit` を捕捉し、未抽出センチネルが残っていればコミットをブロックしてエージェントに `kaizen --current` を促す。
  エージェントが抽出を終えるとセンチネルが消え、再試行した commit が通る。コミットを実際にブロックするため確定的に効き、全エージェント（Claude Code / Codex / Copilot）の PreToolUse で機能する。
- **セッション開始時 Hook（参照注入役）**: `.kaizen/` の未適用（`status: pending`）の学びダイジェストを stdout に出力し、エージェントのコンテキストへ「参照データ」として供給する。これにより過去の学びを踏まえてタスクに着手できる（KEDB 照合の入口）。
  Claude Code は SessionStart の stdout が確実に context へ注入される。Codex / Copilot は注入可否がドキュメント上不明確なため、効けば加点・効かなくても無害というベストエフォート。

> echo による行動リマインダーや `AGENTS.md` への散文の指示は、エージェントの行動を確定的に変えられず守られない確率が高いため主トリガーにはしない。詳細は末尾「使わない方式」を参照。

既に Hook 設定が存在する場合は、上書きせず、既存設定を更新するかユーザーに確認する。

## 手順

### 1. 対象エージェントの確認

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

### 2. 設定するエージェントをユーザーに確認

AskUserQuestion で確認する。対象エージェントが明示されていない場合のみ確認する。

### 3. AGENTS.md にエージェントの自己設定編集の制約を追記する（既存なら除く）

`AGENTS.md` に以下の「エージェントの自己設定編集について」節が**まだ無ければ追記する**（既にあれば何もしない）。これは特定のエージェント固有ではなく全エージェントに関わる一般原則のため、スキル内ではなくプロジェクトの `AGENTS.md` に置く。kaizen は配布スキルなので、この追記をインストール手順に含めることでインストール先プロジェクトにも伝播させる。

追記する内容（`AGENTS.md`）:

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
これらのスクリプトは `.kaizen/` をプロジェクトルート基準（`$CLAUDE_PROJECT_DIR`、未設定なら git ルート）で解決するため、フックがサブディレクトリ cwd で起動しても迷子のセンチネルや取り違えが起きない。

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
> なお各スクリプト内の `.kaizen/` 参照も同じ基準（`$CLAUDE_PROJECT_DIR`、未設定なら git ルート）で解決するため、起動後の書き込み先も cwd に依存しない。

**重要（3 つの hook を同一ファイルにマージする）**: 4-1〜4-3 の JSON は、エージェントごとに**同じ 1 つの設定ファイル**
（Claude Code=`.claude/settings.json` / Codex=`.codex/hooks.json` / Copilot=`.github/hooks/kaizen-session.json`）に対するキー断片を示す。
各ブロックをそのままファイルに書き込んで置き換えると、先に設定した hook キーが上書きされて 1 つしか残らない。
既存の設定（他スキルの hook 含む）を保持したまま、3 つの hook キーを**同一ファイル内にマージ**すること
（3 エージェントとも `hooks` オブジェクト配下にイベントキーを併置する。Claude Code と Codex は同じ構造＝イベント→（任意の `matcher`＋）`hooks` 配列→`type: command`。`matcher` は任意で、省略すると全マッチ。Copilot は加えてトップレベルに `version` を持つ）。
Codex の `matcher` は正規表現で、値は公式例に従う（PreToolUse=`Bash`、SessionStart=`startup|resume`、`Stop` は matcher が無視されるため省略）。

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

詳細なフォーマットは [Codex Hooks ドキュメント](https://developers.openai.com/codex/hooks) を参照すること。

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

詳細なフォーマットは [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) を参照すること。

#### 4-2. コミット前 PreToolUse ゲート（自動実行の主トリガー）

`git commit` を捕捉し、未抽出センチネルが残っていればコミットをブロックして、エージェントに `kaizen --current` の実行を促す。Claude Code / Codex / Copilot のいずれも「ツール実行前に発火し、ブロックできる」Hook（PreToolUse / preToolUse）を備えるため、全エージェント共通で機能する。

判定はスキルにバンドルされたスクリプト（`kaizen-precommit-gate.sh`）が行う。`git commit` を含み、かつ `.kaizen/.pending-extract*` が存在するときだけ **exit code 2 + stderr** でブロックする。
この方式は Claude Code・Codex とも「exit 2 でブロックし stderr をエージェントへ渡す」と明記されており、JSON 出力スキーマの差を避けられる。
ただし抽出完了マーカー `.kaizen/.extract-done` が存在する間はセンチネルがあっても素通りする。
マーカーは抽出完了時に `kaizen-extract-done.sh` が記録し、セッション開始時に SessionStart フック（`kaizen-context-inject.sh`）が削除する。
これにより、Stop フックがターン終了ごとにセンチネルを再装填しても、同一セッション内で既に抽出済みなら後続の commit を再ブロックしない。

> **運用上の注意（git commit を含む呼び出しは全体がブロックされる）**: ゲートは `git commit` を含む Bash 呼び出し**全体**を実行前にブロックする。
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
            "command": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh"
          }
        ]
      }
    ]
  }
}
```

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
        "bash": "bash <KAIZEN_SCRIPTS_DIR>/kaizen-precommit-gate.sh",
        "cwd": ".",
        "timeoutSec": 5
      }
    ]
  }
}
```

> Copilot の `preToolUse` はブロックできるが、stderr/理由をエージェントのコンテキストへ渡せるかはドキュメント上不明確。
> 最低限コミットはブロックされるため、エージェントは失敗に反応して `kaizen --current` を実行する余地が残る。
> 挙動は [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) で確認すること。

#### 4-3. セッション開始時 参照注入フック（過去の学びをコンテキストへ供給）

セッション開始時に `.kaizen/` の未適用（`status: pending`）の学びダイジェストを stdout に出力し、エージェントのコンテキストへ「参照データ」として供給する。`AGENTS.md` への散文の指示より確実に `.kaizen/` を参照させられる（KEDB 照合の入口）。

これは「kaizen を実行せよ」という**行動リマインダーではなく**、過去の学びの**中身そのものを供給する**点が echo リマインダーと異なる（末尾「使わない方式」参照）。判定はバンドルスクリプト（`kaizen-context-inject.sh`）が行い、pending な学びがあるときだけダイジェストを出力し、無ければ何も出さず exit 0 で抜ける。
このスクリプトはダイジェスト出力に加えて、抽出完了マーカー `.kaizen/.extract-done` を削除する役割も担う（セッション開始 = 前セッションのマーカーの失効点。これにより新しいセッションでは再びコミット前ゲートが効く）。ただし stdin の `source` が `compact`（自動圧縮。同一セッションの継続）のときはマーカーを残す。source を取り出せない場合は削除側（ブロックが増える安全側）に倒す。

> **注入可否の但し書き**（PreToolUse ゲートの stderr 注入と同じ）:
> Claude Code の `SessionStart` は stdout が context へ確実に注入される。
> Codex / Copilot のセッション開始フックは stdout を context へ注入できるかドキュメント上不明確なため、効けば加点・効かなくても無害というベストエフォート。

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
        "matcher": "startup|resume",
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

詳細なフォーマットは [Codex Hooks ドキュメント](https://developers.openai.com/codex/hooks) を参照すること。

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

詳細なフォーマットは [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) を参照すること。

### 5. `.gitignore` にセンチネル・抽出完了マーカーを追加する

kaizen の Hook（タスク終了時のセンチネル記録・抽出完了マーカー記録）は、`.kaizen/` 直下に一時的な制御ファイルを作る。これらはコミット対象ではないため、プロジェクトの `.gitignore` に以下を追加する（既にあれば何もしない）:

```gitignore
# kaizen のセンチネル・抽出完了マーカー（Hook / 抽出完了時に作成する一時ファイル）
# ルートだけでなく、万一サブディレクトリに迷子で作られた場合も除外する（二重の防御）。
**/.kaizen/.pending-extract*
**/.kaizen/.extract-done
```

`.kaizen/` ディレクトリそのものはコミット対象（学びの共有・履歴追跡のため。`references/apply.md`「`.kaizen/` の Git 管理」参照）で、除外するのはこの 2 つの制御ファイルだけ。追加しないと、Stop フックが残すセンチネル（`.pending-extract*`）や抽出完了マーカー（`.extract-done`）が誤ってコミットされうる。

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
