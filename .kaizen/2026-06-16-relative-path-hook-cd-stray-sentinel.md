---
date: 2026-06-16
type: hook
priority: high
status: pending
session: claude-code
---

## 事象

スキルの `使い方` 整備（#30）作業中、code-review の検証で `cd skills` を含む Bash
コマンドを実行した。そのターンの終了時に発火した kaizen の Stop フック
（`.claude/settings.json`: `mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract`）が
**相対パス**で書くため、`skills/.kaizen/.pending-extract` という stray センチネルが生成された。

証拠（タイムスタンプ）: 正規のルート `.kaizen/.pending-extract` は 12:49 のまま据え置かれ、
`skills/.kaizen/.pending-extract` は 13:03（= code-review ターンの終了時刻）に生成。
新ターン開始時には cwd がリポジトリルートに戻る（投稿後の `pwd` がルート）。
`.gitignore` の `.kaizen/.pending-extract*` は深さ非依存なので git status には現れず、気付きにくい。

## 根本原因

最低 3 階層の「なぜ」:

1. なぜ stray センチネルが出たか → Stop フックが**相対パス** `.kaizen/.pending-extract` で書くから。
2. なぜ subdir 配下に書かれたか → コマンド内の `cd skills` でシェルの cwd が**そのターン内で持続**し、
   ターン終了時に発火する Stop フックがその cwd（`skills/`）を継承したから。
3. なぜ再発を防げていないか → 再発防止策が「エージェントが subdir に `cd` しない」という
   **運用（確率的）依存**で、決定論的な仕組みになっていないから。← 根本原因

KEDB 照合: applied 2 件の系譜の**新形態での再発**。

- `2026-06-08-eval-isolation-cd-not-persisted`（cd ベースの相対パスは隔離にならない／絶対パス・固定 cwd を使え）
- `2026-06-11-extractor-session-rearms-sentinel`（Stop フックがセンチネルを生成する経路の落とし穴）

横断スコープ: 相対パスで副作用（ファイル生成）を持つ他フック（SessionStart 注入等）にも同型の risk。

## 提案

1. **決定論的対策（本命・仕組みで解決）**: Stop フックの書き込みを `$CLAUDE_PROJECT_DIR` 基準の
   **絶対パス**にして cwd 非依存化する（例: `mkdir -p "$CLAUDE_PROJECT_DIR/.kaizen" &&
   date -Iseconds > "$CLAUDE_PROJECT_DIR/.kaizen/.pending-extract"`）。
   `.claude/settings.json` は Claude Code の自己改変ガードで編集不可（AGENTS.md 参照）のため、
   修正は一時ファイルに書き出しユーザーに `! cp <tmp> .claude/settings.json` での適用を依頼する。
   配布側 `skills/kaizen/references/setup.md` の同コマンドも同期する（kaizen スキル＝#29 の領域で実施）。
2. **補助（運用ガード）**: `.agents/rules/` か `AGENTS.md` に「副作用を持つ相対パスのフックがあるため、
   Bash で subdir へ `cd` しない（絶対パス / `git -C <dir>` / フルパス指定の grep を使う）」を明記する。
3. **横断確認**: 他フックの相対パス書き込みを洗い出し、同様に絶対パス化する。

注意: 本ノートは #30 では記録のみ（pending）。決定論的対策（提案 1）は `.claude/settings.json` と
kaizen 配布スキルの同期を伴うため、kaizen を扱うブランチ（#29 等）で適用する。
