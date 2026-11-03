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
- `.claude/settings.json` の登録を Copilot が呼んだかは、次の 3 つがすべて成り立つときに判定する。1 つでも欠ければ、これまでどおり処理を続ける。
  Claude Code の呼び出しを Copilot と見誤ると、Claude Code のチェックが何もせずに通り、誤りが外から見えないためである。
  - 入力の最上位に `timestamp` がある。Copilot はイベント名の書き方（`preToolUse`・`PreToolUse`）に関わらず入れる。
    Claude Code の入力の共通の項目には無い（[Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)）。
  - 入力の最上位に `hook_event_name` がある。Copilot は入力の形を設定に書いたイベント名で選び、
    PascalCase（`.claude/settings.json` の形）の登録にだけこの項目を入れる。camelCase（`.github/hooks/` の形）の登録には入れない
    （[GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)）。
    この条件があるので、同じスクリプトを引数を変えずに `.github/hooks/` にも登録できる。そちらからの呼び出しは、判定に当たらずに処理を続ける。
    `.github/hooks/` には camelCase のイベント名で登録する。PascalCase で登録すると、その登録も判定に当たり、何もせずに終わる。
  - 環境変数 `COPILOT_CLI` が空でない。Copilot CLI 1.0.105 が Hook のプロセスに `COPILOT_CLI=1` を渡すことを実測した（公式のリファレンスには記載が無い）。
    `CLAUDE_PROJECT_DIR` の有無では見分けられない。同じ実測で、Copilot も Hook に `CLAUDE_PROJECT_DIR` を渡していた。
    Copilot のシェルから Claude Code を起動すると `COPILOT_CLI` を引き継ぎうるので、入力の条件と組み合わせて判定する。
- Copilot CLI 1.0.105 で、`.claude/settings.json`（PascalCase）と `.github/hooks/`（camelCase）に同じイベントを登録して入力を記録した。
  どちらの登録も 1 回ずつ実行され、`hook_event_name` は PascalCase の側にだけあった。`timestamp` は、PascalCase では ISO 8601 の文字列、camelCase では数値だった。
  Copilot の `Stop` の入力には、Claude Code の `last_assistant_message` が無い。
  Copilot は、信頼済みのフォルダ（Copilot の設定の `trustedFolders`）の外のリポジトリでは、どちらの登録も実行しなかった。
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
