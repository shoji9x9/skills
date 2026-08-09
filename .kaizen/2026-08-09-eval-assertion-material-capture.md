---
date: 2026-08-09
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# eval assertion は「判定材料がハーネスの採取物に載るか」を書いた時点で確かめる

## 事象

kaizen の回帰 eval で、採点できない assertion が 2 件出た。

- eval-8「.gitignore に 3 パターンを追加している」: `run-skill-eval.sh` の `project-files` スナップショットが
  拡張子ホワイトリストで選ぶため `.gitignore` を拾わず、内容照合ができなかった（`project-files-skipped.txt`
  にも載らない）。
- eval-14: プロンプトに「修正をすべて適用した後に」と書いたところ適用指示と読まれ、回答が複数
  メッセージに分かれた。`result.json` に残るのは最終アシスタントメッセージだけなので、前半にあった
  根拠（exit 2 の出力・引用した実装）が採取物から落ち、採点不能になった。

## 根本原因

1. なぜ採点できなかったか: 判定に要る材料（`.gitignore` の内容、前半メッセージ）が run の採取物に
   含まれていなかった。
2. なぜ含まれないと気づかなかったか: assertion を「スキルが正しく動けば true になるか」だけで書き、
   ハーネスの採取範囲（拡張子リスト・`result.json` の粒度）と突き合わせていなかった。
3. なぜ突き合わせが行われないか ← 根本原因: `.agents/rules/eval-assertion-discrimination.md` の「材料」の
   観点が `project-files` の拡張子だけを挙げており、`result.json` が最終メッセージのみであることと、
   プロンプトの書き方が採取物の形を変えることに触れていない。

横断スコープ: 内容を検査する assertion を持つ全スキルの `evals/`。特に拡張子の無い成果物
（`.gitignore` / `Makefile` / `Dockerfile` 等）と、作業を伴うプロンプト。

## 提案

`.agents/rules/eval-assertion-discrimination.md` の「材料」の項に、採取物の境界を明記する:
`project-files` は拡張子ホワイトリスト＋名前指定の dotfile のみ、`result.json` は最終アシスタント
メッセージのみ。assertion を確定させる前に「この判定に要る成果物はどの採取物に載るか」を
1 本ずつ答えさせ、答えられなければ採取範囲を広げるか assertion を変える。
あわせて、プロンプトは作業の実行を誘発する書き方（〜した後に）を避け、1 つの報告に
まとめさせる。

今回の具体修正は `docs/skill-development.md` と `scripts/run-skill-eval.sh` へ適用済み。
上記の rule 更新は未適用のため `status: pending`。
