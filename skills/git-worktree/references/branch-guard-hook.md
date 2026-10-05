# branch guard hook の設定

worktree を作る手段に branch を作らせないという規律（[isolation.md](isolation.md) の「branch を作らせない」）を、
文書の指示だけにせず仕組みで守らせる。同梱の `scripts/git-worktree-branch-guard.sh` を各エージェントの
PreToolUse に登録すると、branch を作る呼び出しを捕まえて通知だけする。

**hook は呼び出しを止めない。** Issue に紐付かない worktree（過去の版を読む、使い捨ての検証）にも正しい用途があり、
そこで止めると、利用者は避けるために hook ごと外してしまう。防ぎたいのは「気付かないまま紐付けが失われること」だけで、
それには通知で足りる。

## 何を捕捉するか

| 呼び出し | 捕捉する | 捕捉しない |
| --- | --- | --- |
| `EnterWorktree`（Claude Code） | `name` 指定、および `name` も `path` も無い呼び出し（名前が自動生成される） | `path` 指定（既存 worktree に入るだけ） |
| `git worktree add` | `-b` / `-B` / `--orphan`、および commit-ish も `--detach` も無い形 | commit-ish を渡す形、`--detach`、`list` / `remove` 等 |

commit-ish も `--detach` も無い `git worktree add <パス>` も捕捉する。git はこの形で、path の basename から branch を作るからである。
根拠は git-worktree(1) の "as a convenience, the new worktree is associated with a new branch" である。
`-b` が無いからといって安全ではない。

見るのは、コマンドの位置にある `git` だけである。語の並びのどこにでも反応させると、heredoc や
コミットメッセージの本文に現れる「`git worktree add -b`」という文字列にも通知が出る。
この hook を足した commit の message でも、実際に誤検知した。誤検知が続くと通知が信用されなくなるので、見逃しより損失が大きい。

**捕捉できる範囲は、エージェントによって違う。** Claude Code の PreToolUse の matcher は、Bash 以外の
組み込みツールにも一致するので、`EnterWorktree` を捕捉できる（<https://code.claude.com/docs/en/hooks>）。
Codex と GitHub Copilot には `EnterWorktree` が無く、捕捉できるのは `git worktree add` だけである。

## 通知の出し方（エージェント別）

| エージェント | 出力 | 根拠 |
| --- | --- | --- |
| Claude Code | exit 0 ＋ `hookSpecificOutput.additionalContext` | <https://code.claude.com/docs/en/hooks> |
| Codex | exit 0 ＋ `hookSpecificOutput.additionalContext` | <https://learn.chatgpt.com/docs/hooks> |
| GitHub Copilot | exit 0 ＋ `permissionDecision: "ask"` ＋ `permissionDecisionReason` | <https://docs.github.com/en/copilot/reference/hooks-reference> |

Copilot の `preToolUse` の出力は、許可の判定だけに使うもので、`additionalContext` を持たない。
そのため通知は `ask` の理由に載せて、人に見せる。

**スクリプトは常に exit 0 で終える。** Copilot は 0 以外の終了（timeout を除く）を deny として扱い、ツールの呼び出しを止める。
通知が目的の hook が、ツールの呼び出しを止めてはいけない。
どちらの形で出すかは payload のキー（snake_case の `tool_name` か、camelCase の `toolName` か）で切り替わるので、
設定で指定するものは無い。

`jq` も `python3` も無い環境では、payload を構造として取り出せないので、何も通知しない。
ここでコマンドの文字列をそのまま照合する方法に切り替えると、`worktree` を含むだけの無関係な呼び出しに通知を出し続け、
通知そのものが無視されるようになる。

## 手順

### 1. スクリプトの絶対パスを特定する

`<GUARD>` は、同梱スクリプトの絶対パスである。インストール先（エージェントとスコープ）によって場所が違うので、
下のスニペットで確かめ、以下の JSON の `<GUARD>` を実際のパスに置き換える。
どれにも無ければ、git-worktree を実際にインストールした先の `scripts/` を使う。特定できなければ利用者に確認する。

```bash
for d in .agents/skills/git-worktree/scripts .claude/skills/git-worktree/scripts \
         .github/skills/git-worktree/scripts \
         "$HOME/.claude/skills/git-worktree/scripts" "$HOME/.codex/skills/git-worktree/scripts"; do
  [ -d "$d" ] && (cd "$d" && pwd) && break
done
```

**相対パスにしない。** PreToolUse の hook は、エージェントが `cd` したサブディレクトリを cwd として
起動することがある。相対パスだとスクリプトが見つからず、起動に失敗する。
失敗しても通知が出ないだけなので、動いていないことに気付けない。

### 2. 各エージェントの設定へマージする

既存の hook の設定（他のスキルのものを含む）は、上書きせずにマージする。同じイベントのキーの配列に並べて置く。
既に設定がある場合は、上書きしてよいかを利用者に確認する。

エージェントが自分の設定ファイルを編集できない場合（Claude Code の `.claude/settings.json` などは、自分の設定の書き換えが止められることがある）は、
適用する JSON を一時ファイルに書き出し、利用者に `! cp <tmp> <設定ファイル>` で適用してもらう。

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

matcher が英数字・`_`・`-`・空白・`,`・`|` だけでできていれば、ツール名を列挙したものとして完全一致で扱われる。
そのため、`EnterWorktree|Bash` は 2 つのツール名にだけ一致する。それ以外の文字を含めると、正規表現として扱われる。

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

Codex の matcher は、`tool_name` に対する正規表現である。`EnterWorktree` は無いので、`Bash` に限る。
Codex は、設定をマージしただけでは hook を実行しない。定義を足した後、Codex 側の信頼（trust）の手順まで済ませる。

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

Copilot の `matcher` は `toolName` に対する正規表現で、`^(?:...)$` の形で全体に一致させる。

### 3. 設定が有効になったことを実測する

「通知が出ない」ことを、設定できた根拠にしない。設定していなくても同じ出力になる。
捕捉されるはずの入力を必ず通して、通知が出ることを確かめる。

```bash
# 検出されることの確認: 通知が出なければならない
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"EnterWorktree","tool_input":{"name":"feature/1-x"}}' \
  | bash <GUARD>
# 誤検知しないことの確認: 何も出てはならない
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"EnterWorktree","tool_input":{"path":".claude/worktrees/x"}}' \
  | bash <GUARD>
```

スクリプト単体の確認が通ったら、エージェントを通しても 1 度確かめる。設定をマージした位置や matcher の
書き間違いは、スクリプト単体の実行では見つからない。
捕捉できない呼び出しも把握しておく。Codex と Copilot では、`EnterWorktree` に当たる呼び出しをそもそも捕捉できない。
