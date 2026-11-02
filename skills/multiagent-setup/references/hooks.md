# Hooks セットアップガイド

## エージェント別設定ファイル

| エージェント | 設定ファイル | イベントの例 |
|------------|------------|------------|
| Claude Code | `.claude/settings.json` の `hooks` セクション | SessionStart, PreToolUse, PostToolUse, Stop |
| Codex | `.codex/hooks.json` または `.codex/config.toml` の `[hooks]` テーブル | SessionStart, PreToolUse, PostToolUse, Stop |
| Copilot | `.github/hooks/*.json`（ファイル名は任意）。`.claude/settings.json` の Hook も実行する（後述） | sessionStart, preToolUse, postToolUse, sessionEnd |

イベントの一覧、入力の JSON、exit code の意味はエージェントごとに違い、バージョンが上がると増える。
上の列は例なので、使うイベントは各エージェントの公式のリファレンスで確かめる。

- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)

## Copilot は Claude Code の設定ファイルの Hook も実行する

Copilot CLI は、`.github/hooks/*.json` に加えて、`.claude/settings.json` と `.claude/settings.local.json` の Hook も読んで実行する
（[GitHub Copilot hooks configuration](https://docs.github.com/en/copilot/reference/hooks-configuration)）。
`.claude/settings.json` の Hook だけを止める設定は無い。`disableAllHooks` は、すべての Hook を止める。

そこで、Copilot の Hook は `.github/hooks/` に置き、`.claude/settings.json` の Hook は Copilot から呼ばれても誤った動作をしないように作る。

- `.claude/settings.json` に登録するスクリプトは、Copilot の入力を見分けたら何もせずに exit 0 で終える。Copilot 用の処理は、`.github/hooks/` に登録した側が行う。
  何もせずに終えないと、同じ処理が 2 回行われるうえ、Claude Code 用の終了コードと振る舞いが Copilot に届く。
  Copilot の `preToolUse` は、exit 2 以外の 0 以外をすべて拒否として扱う。Stop は、Copilot では応答が終わるたびに実行される（`agentStop`）。
- Copilot の入力は、次の 2 つがどちらも成り立つときに Copilot と判定する。片方だけでは判定しない。
  Claude Code の呼び出しを Copilot と見誤ると、Claude Code のチェックが何もせずに通り、誤りが外から見えないためである。
  - 入力の最上位に `timestamp` がある。Copilot はイベント名の書き方（`preToolUse`・`PreToolUse`）に関わらず入れる。
    Claude Code の入力の共通の項目には無い（[Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)）。
  - 環境変数 `COPILOT_CLI` が空でない。Copilot CLI 1.0.105 が Hook のプロセスに `COPILOT_CLI=1` を渡すことを実測した（公式のリファレンスには記載が無い）。
    `CLAUDE_PROJECT_DIR` の有無では見分けられない。同じ実測で、Copilot も Hook に `CLAUDE_PROJECT_DIR` を渡していた。
    Copilot のシェルから Claude Code を起動すると `COPILOT_CLI` を引き継ぎうるので、1 つ目の条件と組み合わせて判定する。
- Copilot だけを使うプロジェクトでも、Hook は `.github/hooks/` に置く。`.claude/settings.json` を読まない Copilot のバージョンでも動くようにするためである。

## フックスクリプトの配置

- スキルに同梱の Hook（`kaizen`・`git-worktree` など）は、スキルに同梱のスクリプトを、各エージェントの設定ファイルから直接参照する。
  どこから参照するかと手順は、各スキルのセットアップの手順に従う。
  `.agents/hooks/scripts/` には複製しない（複製すると、スキルを更新しても反映されない）。
- プロジェクトに固有の Hook は `.agents/hooks/scripts/` に置き、各エージェントの設定ファイルからそのパスを参照する。
  こうすると、複数のエージェントで同じスクリプトを共有できる。

```text
.agents/hooks/scripts/
  pre-tool.sh         # ツール実行前の共通処理
  session-start.sh    # セッション開始時の共通処理
  ...
```

## 作成手順

```bash
# スクリプトディレクトリを作成する
mkdir -p .agents/hooks/scripts

# スクリプトを作成し実行権限を付与する
chmod +x .agents/hooks/scripts/<script>.sh

# 各エージェントの設定ファイルで .agents/hooks/scripts/<script>.sh を参照する
```

## 削除手順

各エージェントの設定ファイルから該当するフックの設定を削除し、不要になったスクリプトを `.agents/hooks/scripts/` から削除する。
