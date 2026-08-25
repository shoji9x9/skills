---
date: 2026-08-12
type: hook
priority: high
status: applied
applied-to:
  - skills/kaizen/scripts/kaizen-stop-mark.sh
  - skills/kaizen/scripts/kaizen-precommit-gate.sh
  - skills/kaizen/scripts/kaizen-hook-common.sh
  - skills/kaizen/scripts/kaizen-extract-done.sh
  - skills/kaizen/scripts/kaizen-context-inject.sh
  - skills/kaizen/scripts/kaizen-archive.sh
  - skills/kaizen/scripts/kaizen-kedb-match.sh
  - skills/kaizen/scripts/kaizen-status-check.sh
  - skills/kaizen/references/setup.md
  - skills/kaizen/references/extract.md
  - skills/kaizen/references/apply.md
  - skills/kaizen/evals/evals.json
  - .gitignore
  - "#218"
session: codex
---

# 未抽出センチネルは所有 transcript を同定できる情報を持たせる

## 事象

Claude Code の commit が、3 日前（2026-08-09）の Codex セッションが残した
`.kaizen/.pending-extract-codex` でブロックされた。ゲートの案内はセンチネルの
ファイル名 1 行だけで、どの transcript を抽出すれば解消するかを示さない。
センチネルの中身も UTC タイムスタンプ 1 行（`2026-08-09T00:52:32Z`）のみのため、
`~/.codex/sessions/**` を mtime で突き合わせて transcript を推測するしかなかった。

該当の Codex セッションは `/review` の指摘（センチネルのワイルドカード削除で他
エージェントのシグナルを消す P2）を修正した後、ユーザーの中断（`turn_aborted`）で
終了しており、抽出が実行されないままセンチネルだけが残っていた。

## 根本原因

- なぜ解消手順が分からなかったか → ゲートの「他エージェント未処理」分岐
  （`kaizen-precommit-gate.sh:182-186`）はセンチネル名を出して exit 2 するだけで、
  対象 transcript も復旧コマンドも案内しない。候補検出側の分岐は 3 エージェント分の
  `kaizen-extract-done.sh` コマンドを並べるのに、この分岐だけ案内が無い。
- なぜ transcript を機械的に解決できないか → センチネルは
  `kaizen-stop-mark.sh:34` の `date -u ... >".kaizen/.pending-extract${suffix}"` で
  タイムスタンプしか書かず、どの transcript に対応するかを持たない。
- なぜ持たない設計か → センチネルを「未抽出の活動があった」という真偽フラグと
  してのみ設計し、そのフラグを立てた本人以外が解消する経路を想定していない。
  マルチエージェント運用では、立てた本人が戻らないまま別エージェントが
  ブロックされる状況が常態になる。← 根本原因

横断スコープ確認: 同じ `.kaizen/` の制御ファイルでも `.extract-checkpoint` は
transcript パス・オフセット・エージェント・行数の 4 値を持ち機械的に解決できる。
同定情報を持たないのはセンチネルだけ。さらに checkpoint はエージェント別ではなく
単一ファイルのため（実測: claude-code の 1 件のみ）、checkpoint 側から他エージェントの
transcript を引くこともできない。

関連: [[2026-07-03-autonomous-loop-gate-rearm-friction]] /
[[2026-06-11-extractor-session-rearms-sentinel]]（いずれも適用済み。既存 2 件は
「センチネルが自己再装填する」故障で、本件の「立てた本人以外が解消できない」とは別形態）。

## 提案

未抽出センチネルには、それを解消するために必要な同定情報（transcript パス・
エージェント名）を持たせ、ブロック時にそのまま実行できる復旧コマンドを案内する。
フラグを立てた本人以外が解消できる形にする。

1. `kaizen-stop-mark.sh`: センチネルへ transcript パスとエージェント名を追記する
   （`.extract-checkpoint` と同じ「1 行 1 値」形式に揃える。1 行目＝タイムスタンプは
   後方互換のため維持）。transcript パスが取れない環境では従来どおり
   タイムスタンプのみを書き、欠落を許容する。
2. `kaizen-precommit-gate.sh`: 「他エージェント未処理」分岐で、センチネル名に加えて
   読み取れた transcript パスと `kaizen-extract-done.sh --sentinel-suffix <suffix>
   --agent <agent> <transcript>` を案内する。パスが無い旧形式ではその旨と探索先
   （`~/.codex/sessions/**` 等）を示す。
3. 旧形式のセンチネルでもゲートは従来どおり fail closed を保つ。案内の追加で
   あって、遮断条件は緩めない。

## 適用結果（2026-08-25 / Issue #218）

センチネルは「1 行 1 値」の 4 行（タイムスタンプ / transcript パス / エージェント / session id）を持つようになり、
ゲートは未解決センチネルごとに `kaizen-extract-done.sh --sentinel-suffix ... --agent ... --session-id ... <transcript>` を
そのまま貼れる形で案内する。transcript を持たないセンチネル（旧形式・Copilot）は、その旨と探索先を示すフォールバックへ倒す。
遮断条件は緩めていない（案内の追加のみ）。あわせて制御ファイル一式を session 単位にし、
「立てた本人以外が解消できない」の裏返しである「他セッションが勝手に解消してしまう」も塞いだ。
