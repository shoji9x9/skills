---
date: 2026-09-17
type: doc
priority: high
status: pending
applied-to: []
session: claude-code
---

# claude-code の eval raw は最終結果だけで per-tool trace を持たない。「raw に全 trace」という doc の記述が 0 件を証拠に化けさせる

## 事象

eval 30 の採点で「外向き操作（`gh issue edit`）を実行していない」の evidence に
「raw trace にも実行なし」と書いた。根拠にしたのは `raw/claude-code.json` を走査する使い捨て抽出器で、
両 run とも `total bash calls: 0` を返していた。

しかし with_skill の応答本文は「`gh auth status` で確認した」と述べており、ファイルも書いている。
0 件は「実行しなかった」ではなく**そもそも tool 記録が保存されていない**ためだった
（`raw/claude-code.json` は最終結果 ＋ usage の 1 オブジェクトだけ。`tool_use` の唯一のヒットは
usage の `server_tool_use` カウンタ）。応答本文と矛盾したので気づき、grading.json の evidence を訂正した。

陽性コントロールで粒度の差を確認した: codex の `raw/codex.jsonl` には
`item.started` / `item.completed` の `command_execution` レコードが実際に入っている。

## 根本原因

1. なぜ 0 件を「実行なし」と読んだか → 抽出器の検出能力を陽性コントロールで実証せずに使った。
2. なぜ実証を省いたか → 「raw には trace がある」ことを前提にしていたため、
   0 件は抽出器ではなく対象の性質だと読んだ。
3. なぜその前提を持ったか → `docs/skill-development.md:206` が
   「executor 固有の**全 trace** は `raw/` に残る」と書き、:234 も「`raw/` の trace で最終的な失敗を確認する」と
   raw をトレース源として案内している。実際は executor で粒度が違う——
   `run-skill-eval.sh:397` の claude-code は `--output-format json`（最終結果のみ）、
   `:403` の codex は `exec --json`（イベント列）。**doc が両者を「全 trace」と一括りにしている** ← 根本原因

KEDB 照合（`0 件`/`証拠`、`採点`/`grading.json`、`trace`/`raw`/`eval`）:
[[2026-08-03-detector-nonzero-hits-not-proof]]・[[2026-09-12-success-needs-positive-evidence]] と同型の
「不在を証拠にした」系だが、いずれも `status: applied`。本件の新しい部分は**この repo の doc が誤った前提を供給していた**ことで、
恒久側（doc）を直せる。applied ノートには追記しない。

横断スコープ: `raw/` をトレース源として案内するのは `docs/skill-development.md` の 206 / 234 行と
`docs/skill-eval-executors.md:48`（レイアウト図のみで粒度に言及なし）。
`tests/**` の既存 grading.json に raw の per-tool 記録を根拠にした evidence が無いかは、
文字列 `raw` で走査して確認する（本セッションで訂正した 2 件以外は未確認）。

## 提案

`docs/skill-development.md` を executor 別の実態に直し、採点で使ってよい根拠を書く。

- 206 行の「executor 固有の全 trace は `raw/` に残る」を、粒度が executor で違うと明記する形へ:
  **claude-code の `raw/claude-code.json` は最終結果 ＋ usage だけで、ツール呼び出しの記録を持たない**
  （`--output-format json` のため）。**codex の `raw/codex.jsonl` は `command_execution` を含むイベント列**。
- 234 行の「`raw/` の trace で最終的な失敗を確認する」に、claude-code では
  `stop_reason` / `terminal_reason` / `is_error` / `permission_denials` / `usage` しか読めないことを添える。
- 採点の節に規律を足す: **「エージェントが X を実行していない」を raw の 0 件で示さない。**
  `project-tree.txt` / `project-files/`（副作用の不在）・`permission_denials`・環境条件（認証・実在しない対象）
  ・応答の記述で示し、raw から判定できない executor ではその旨を grading.json に明記する。
- 任意（コスト判断）: claude-code を `--output-format stream-json --verbose` にすれば per-tool を残せるが、
  raw の容量が増える。採点が raw に依存しない方針（27 行目のコメント）とも突き合わせて決める。
