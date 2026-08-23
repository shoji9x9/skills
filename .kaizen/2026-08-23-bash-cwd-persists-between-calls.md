---
date: 2026-08-23
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# Bash ツールの cwd は呼び出し間で持続する（doc は「毎回リセット」と誤記）

## 事象

本セッションで相対パスの `cd` が 2 回失敗した。

1. `cd skills/replace-strategy && cat evals/README.md` の次の呼び出しで
   `cd skills/replace-strategy/evals/fixtures` → No such file or directory
2. `cd tests/replace-strategy/iteration-12/eval-19 && ...` の次の呼び出しで
   同じ相対 `cd` を再指定 → No such file or directory

いずれも「前の呼び出しが残した cwd」の中から相対パスを解決したため。

## 根本原因

1. なぜ失敗したか → cwd が既に目的ディレクトリ内にあり、相対パスが二重に解決された
2. なぜそう想定しなかったか → cwd が呼び出しごとにリポジトリルートへ戻る前提で書いた
3. なぜその前提を持ったか → `docs/skill-development.md:82` が
   「エージェントの Bash ツールは **`cd` を呼び出し間で保持せず、各呼び出しで cwd が
   （リポジトリルートに）リセットされる**」と無条件に書いており、本リポジトリの基底知識に
   なっているため ← 根本原因

実測（本セッション）: `cd skills; pwd` → `/…/skills/skills`、直後の別呼び出しで `pwd` →
`/…/skills/skills`。**ターン内では持続する**。リセットが観測されたのは cwd が
プロジェクト外（skill-creator ディレクトリ）へ出た呼び出しの後だけで、ハーネスが
「Shell cwd was reset to …」と明示した。

KEDB 照合: `2026-06-08-eval-isolation-cd-not-persisted`（applied・doc の出所）と
`2026-06-16-relative-path-hook-cd-stray-sentinel`（applied）は**互いに矛盾**したまま残って
いる。後者は「`cd skills` でシェルの cwd がそのターン内で持続」と実測を記録済み。

横断スコープ: 誤記は `docs/skill-development.md:82` の 1 箇所のみ（grep 済み）。
eval 隔離の結論（ランチャ固定 cwd の `claude -p`）自体は正しく、変更不要。

## 提案

Bash 呼び出しの cwd を仮定せず、ディレクトリ指定は絶対パス（または `git -C` / `--directory`）
で与える。ハーネス挙動を doc に書くときは実測で確かめ、反証する記録が KEDB に無いか照合する。

1. `docs/skill-development.md:82` を実測に合わせて修正する。「毎回リセットされる」ではなく
   **「cwd は呼び出し間で持続しうる（ターン境界やプロジェクト外へ出た場合はリセットされる）ため
   前提にできない」**とし、隔離の理由を「cwd 前提に依存しないこと」自体へ置き換える
   （現行の結論＝ランチャ固定 cwd はそのまま維持）
2. `2026-06-08` ノートの根拠部分が実測と食い違う旨を、恒久側（上記 doc）を直した記録として残す
   （applied ノート自体は書き換えない）
