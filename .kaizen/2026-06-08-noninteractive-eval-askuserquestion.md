---
date: 2026-06-08
type: skill
priority: high
status: applied
session: claude-code
---

## 事象

全スキルの eval セッション（`~/.claude/projects/-tmp-skill-eval-*`、計 228 ラン）を横断集計したところ、
`AskUserQuestion` 呼び出しが **"Answer questions?" エラーで失敗**するケースが **21 件**あった。
4 スキル種別すべて（dependabot-merge / pr-review-handle / issue-start / kaizen）に分布する。
失敗直前のツールは 21 件すべて `AskUserQuestion`。エージェントは「意図が曖昧」と判断して質問を投げ、
ヘッドレス実行には応答者がいないためツールがエラーし、以降の進行が停止/迷走した。

本 kaizen セッション自身でも、抽出候補の承認を取ろうとした `AskUserQuestion` が同じ
"Answer questions?" でライブ再現した（このセッションも `claude -p` ヘッドレス）。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜツールが失敗したか? → eval は `scripts/run-skill-eval.sh` のヘッドレス `claude -p` で回るため、
  `AskUserQuestion` に応答する対話相手が存在しない（`run-skill-eval.sh` 冒頭コメントの設計どおり非対話）。
  - なぜエージェントが質問を投げたか? → 各スキルの SKILL.md が「意図が不明な場合は AskUserQuestion で確認する」と
    指示しており、エージェントが曖昧さを検知すると対話を試みるため（例: kaizen SKILL.md Step 1）。
    - なぜ非対話で詰まったか? → スキルに **対話が不能なときの縮退動作（graceful degradation: 文書化済みの
      デフォルトで進めて続行）が定義されていない**ため。← 根本原因（対策可能）

KEDB 照合: `[[2026-06-08-eval-isolation-cd-not-persisted]]` と同じヘッドレス `claude -p` ハーネスが舞台。
あちらは *ファイル分離*、本件は *非対話環境での挙動* で別軸（同ハーネスの次の論点）。
横断スコープ: `AskUserQuestion` を使う全スキル（意図分岐・選択肢提示を持つもの）に共通。

## 提案

対話不能環境で停止しないよう、スキルとハーネスの両面で対処する（type: skill 主）。

1. **スキル側（graceful degradation）**: 「意図が不明な場合は AskUserQuestion」の指示に
   フォールバックを併記する。文面案:
   > 意図が不明な場合は AskUserQuestion で確認する。**ただし対話が不能な環境（ヘッドレス `claude -p`・
   > AskUserQuestion がエラーを返す）では、質問で停止せず、最も安全な文書化済みデフォルトを採用して
   > 続行し、採用した仮定を冒頭に明示する。**
2. **ハーネス側**: eval が非対話であることを `docs/skill-development.md` に明記し、
   eval プロンプトは意図が一意に決まる形（フラグ/URL を明示）で与えることを推奨する。

教訓（一般化）: **エージェントへの「迷ったら聞け」指示には、対話不能時の縮退動作を必ず添える。
聞けない環境で質問を投げると、確率論的エージェントは停止・迷走しやすい。**
