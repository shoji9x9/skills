# branch guard hook の配線

worktree の作成手段に branch を作らせない規律（[isolation.md](isolation.md) の「branch を作らせない」）を、
散文の指示ではなく**機構**で守らせる。同梱の `scripts/git-worktree-branch-guard.sh` を各エージェントの
PreToolUse へ登録すると、branch を作る経路を捕捉して**通知だけ**する。

**ブロックはしない。** Issue に紐づかない worktree（過去の版を読む、使い捨ての検証）にも正当な用途があり、
そこで止めると回避のために hook ごと外される。止めたいのは「気付かないまま紐付けが落ちること」だけで、
それには通知で足りる。

## 何を捕捉するか

| 経路 | 捕捉する | 捕捉しない |
| --- | --- | --- |
| `EnterWorktree`（Claude Code） | `name` 指定、および `name` も `path` も無い呼び出し（名前が自動生成される） | `path` 指定（既存 worktree に入るだけ） |
| `git worktree add` | `-b` / `-B` / `--orphan`、および commit-ish も `--detach` も無い形 | commit-ish を渡す形、`--detach`、`list` / `remove` 等 |

commit-ish も `--detach` も無い `git worktree add <パス>` を捕捉するのは、git がその形で
**path の basename から branch を作る**ため（git-worktree(1) の "as a convenience, the new worktree is
associated with a new branch"）。`-b` が無いから安全、とはならない。

見るのは**コマンド位置にある `git` だけ**。語の並びのどこにでも反応させると、heredoc や
コミットメッセージ本文に現れる「`git worktree add -b`」という**文字列**にも通知が出る
（この hook を足した commit の message 自体で誤検知した）。誤検知は通知の信頼を落とすため、
取りこぼしより高くつく。

**エージェントによって捕捉できる範囲が違う。** Claude Code の PreToolUse matcher は Bash 以外の
組み込みツールにも一致するため `EnterWorktree` を捕捉できる（<https://code.claude.com/docs/en/hooks>）。
Codex / GitHub Copilot に `EnterWorktree` は存在せず、捕捉できるのは `git worktree add` の経路だけになる。

## 通知の出し方（エージェント別）

| エージェント | 出力 | 根拠 |
| --- | --- | --- |
| Claude Code | exit 0 ＋ `hookSpecificOutput.additionalContext` | <https://code.claude.com/docs/en/hooks> |
| Codex | exit 0 ＋ `hookSpecificOutput.additionalContext` | <https://learn.chatgpt.com/docs/hooks> |
| GitHub Copilot | exit 0 ＋ `permissionDecision: "ask"` ＋ `permissionDecisionReason` | <https://docs.github.com/en/copilot/reference/hooks-reference> |

Copilot の `preToolUse` 出力は permission 決定専用で `additionalContext` を持たないため、通知は
`ask` の理由に載せて人へ回す。**スクリプトは常に exit 0 で終える** —— Copilot は非 0 終了（timeout を除く）を
fail-closed の deny として扱うので、通知目的のフックが tool 呼び出しを落としてはならない。
どちらの形で出すかは payload のキー（snake_case `tool_name` か camelCase `toolName` か）で切り替わるため、
設定側で指定するものは無い。

`jq` も `python3` も無い環境では payload を構造として取り出せないため、**何も通知しない**。
ここでコマンド文字列の生照合へ縮退すると、`worktree` を含むだけの無関係な呼び出しへ通知を出し続け、
通知そのものが無視されるようになる。

## 手順

### 1. スクリプトの絶対パスを特定する

`<GUARD>` は同梱スクリプトの絶対パス。インストール先（エージェント・スコープ）で場所が違うため、
下のスニペットで確認し、以下の JSON の `<GUARD>` を実際のパスへ置き換える。
どれにも無ければ実際の git-worktree インストール先の `scripts/` を使う（特定できなければユーザーに確認する）。

```bash
for d in .agents/skills/git-worktree/scripts .claude/skills/git-worktree/scripts \
         .github/skills/git-worktree/scripts \
         "$HOME/.claude/skills/git-worktree/scripts" "$HOME/.codex/skills/git-worktree/scripts"; do
  [ -d "$d" ] && (cd "$d" && pwd) && break
done
```

**相対パスにしない。** PreToolUse フックはエージェントが `cd` したサブディレクトリの cwd を継承して
起動することがあり、相対パスだとスクリプト自体が見つからず起動に失敗する（失敗しても通知が出ないだけなので、
壊れていることに気付けない）。

### 2. 各エージェントの設定へマージする

既存の hook 設定（他スキルのものを含む）を**上書きせずマージ**する。同じイベントキーに配列で併置する。
既に設定がある場合は、上書きしてよいかユーザーに確認する。

エージェントが自身の設定ファイルを編集できない場合（Claude Code の `.claude/settings.json` 等の自己改変ガード）は、
適用すべき JSON を一時ファイルへ書き出し、ユーザーに `! cp <tmp> <設定ファイル>` での適用を依頼する。

#### Claude Code — PreToolUse (`.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "EnterWorktree|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash <GUARD>"
          }
        ]
      }
    ]
  }
}
```

matcher は英数字・`_`・`-`・空白・`,`・`|` だけなら**完全一致の列挙**として扱われるため、
`EnterWorktree|Bash` は 2 つのツール名にだけ一致する（それ以外の文字を含めると正規表現として扱われる）。

#### Codex — PreToolUse (`.codex/hooks.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash <GUARD>"
          }
        ]
      }
    ]
  }
}
```

Codex の matcher は `tool_name` に対する正規表現。`EnterWorktree` は存在しないので `Bash` に限定する。
Codex は設定をマージしただけでは hook を実行しない。定義の追加後、Codex 側の信頼（trust）手順まで完了させる。

#### GitHub Copilot — preToolUse (`.github/hooks/git-worktree-branch-guard.json`)

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "matcher": "bash",
        "bash": "bash <GUARD>",
        "cwd": ".",
        "timeoutSec": 10
      }
    ]
  }
}
```

Copilot の `matcher` は `toolName` に対する正規表現で、`^(?:...)$` で全体一致させられる。

### 3. 配線できたことを実測する

**「通知が出ない」を配線成功の根拠にしない。** 未配線でも同じ出力になる。
必ず**捕捉されるはずの入力**を通して、通知が出ることを確かめる。

```bash
# 陽性コントロール: 通知が出なければならない
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"EnterWorktree","tool_input":{"name":"feature/1-x"}}' \
  | bash <GUARD>
# 陰性コントロール: 何も出てはならない
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"EnterWorktree","tool_input":{"path":".claude/worktrees/x"}}' \
  | bash <GUARD>
```

スクリプト単体の確認が通ったら、エージェント経由でも 1 度確かめる（設定のマージ位置や matcher の
書き間違いは、スクリプト単体の実行では出ない）。**捕捉されない側の経路も把握しておく** ——
Codex / Copilot では `EnterWorktree` に相当する呼び出しがそもそも捕捉できない。
