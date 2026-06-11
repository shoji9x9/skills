---
date: 2026-06-11
type: hook
priority: high
status: applied
session: claude-code
---

## 事象

PR #26 レビュー対応の commit が kaizen ゲートにブロックされたが、残っていたセンチネル
`.kaizen/.pending-extract`（2026-06-10T09:00:02 作成）は、ユーザーの作業セッションではなく
**kaizen-extract.sh が spawn した headless 抽出器（`claude -p`）セッション自身の終了**が
作成したものだった（抽出器セッション e65bbf4c の終了時刻とセンチネル作成時刻が一致）。
さらにその抽出器は、出力先 `~/.claude/kaizen-learnings.md` がプロジェクト外のため
headless セッションの作業ディレクトリ制限で read/write とも全ブロックされ
（`is_error` の実イベントで確認。python3 / tee / ln -sf 等の迂回も全て拒否）、
**本来の抽出を一度も完遂できないまま**センチネルだけを再装填していた。

## 根本原因

3 階層の「なぜ」:

1. なぜ commit がブロックされたか → 抽出器セッションの終了がセンチネルを再作成したから。
2. なぜ抽出器の終了でセンチネルが作られるか → `.claude/settings.json` の Stop フック
   （`mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract`）が**無条件**で、
   抽出器除外がないから。`KAIZEN_EXTRACTING=1` ガードは `kaizen-extract.sh`（PostToolUse 側）
   にしか入っておらず、Stop フックには伝播チェックがない。
3. なぜ抽出器は本来の仕事に失敗したか → 書き込み先 `$HOME/.claude/kaizen-learnings.md` が
   プロジェクト外で、headless `claude -p` の許可ディレクトリ
   （`/home/shoji9x9/projects/skills`）から構造的に届かないから。

KEDB 照合: `~/.claude/kaizen-learnings.md` の #1「成功条件を自分で満たせない（書けない副作用に
成否を依存させると常に失敗する）」の**新形態での再発**。06-09(4回目) の修正で PostToolUse 側は
決定論化されたが、(a) Stop フックの自己除外、(b) 抽出器の出力先到達性、の 2 点が残っていた。

## 提案

1. **Stop フックに抽出器除外を入れる**（決定論的）: フック command の先頭で
   `[ -n "$KAIZEN_EXTRACTING" ] && exit 0` を評価する（env は claude -p の子プロセスである
   フックに継承される）。例:
   `sh -c '[ -n "$KAIZEN_EXTRACTING" ] && exit 0; mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract'`
2. **抽出器の出力先をプロジェクト内へ**: `~/.claude/kaizen-learnings.md` への直接追記をやめ、
   プロジェクト内（例 `.kaizen/`）へ書かせるか、`claude -p` に `--add-dir ~/.claude` 等で
   書き込み先への権限を明示的に与える。「書けない副作用を成功条件にしない」鉄則の徹底。
3. 横断確認: 他の hook（SessionStart 注入等）にも「spawn されたエージェント自身が発火させる」
   自己再帰がないか確認する。

注意: `.claude/settings.json` は Claude Code の自己改変ガードで編集不可（AGENTS.md 参照）。
適用時は修正内容を一時ファイルに書き出し、ユーザーに `! cp <tmp> .claude/settings.json` での
適用を依頼する。

## 対応結果（2026-06-11 適用済み）

提案 1〜2 の個別修正ではなく、根本原因であるユーザーレベル kaizen 機構の**撤去**で解消した:

- `~/.claude/settings.json` から PostToolUse の `kaizen-extract.sh` フック・SessionStart の
  `kaizen-learnings.md` 注入フック・同ファイルへの permissions を除去し、
  `~/.claude/kaizen-extract.sh` 本体を削除（抽出器の spawn 自体が無くなり、自己再帰と
  「書けない副作用」の両方が消滅）
- 学びの注入は、project `.claude/settings.json` に正規構成の SessionStart
  `kaizen-context-inject.sh`（pending の学びのみ供給）を追加して置き換え
- 残存していたセンチネルは削除済み

汎用の教訓として残すもの: (1) フックは「spawn されたエージェント自身が踏む」自己再帰経路を
設計時に確認する。(2) headless `claude -p` は作業ディレクトリ外へ書けないため、
プロジェクト外パスへの書き込みを成功条件にしない。
