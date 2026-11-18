---
date: 2026-11-02
type: rule
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 本物の Hook に組み立てた入力を当てて測ると、判定の後の処理まで実行され、作業ツリーに記録が stage される

## 事象

Issue #858 で、Copilot の入力を 6 つの Hook に当てて振る舞いを測った。
agent-usage の commit 前のチェックに `git commit` の入力を当てると、判定を通った後の記録の処理まで実行された。
その結果、worktree に利用実績の CSV が 2 件作られ、stage された。気付いて stage を外し、削除した。
後の通しの確認では、使い捨てのリポジトリで、設定の置き場所（`XDG_CONFIG_HOME` など）を使い捨ての場所に向けて実行した。

Issue #1071 の作業では、全件のテストを実行するたびに、`.kaizen/` の学び 7 件の `status` が `forgotten` に書き換わった。
`kaizen-degraded-warning.test.ts` の誤検知しないことの確認が、同梱のスクリプトを、実リポジトリを cwd にして引数なしで起動していた。
引数なしの `kaizen-extract-done.sh` は `complete` として動き、`kaizen-forget.sh --auto` を呼ぶ。Issue #1075 に起票した。

## 根本原因

- 記録されたのは、通す側の分岐が、記録して stage する処理（`gate.mjs` の `runCollect`）を持っていたからである
- 知らずに当てたのは、読んだのが `precommit-gate.sh` だけで、委譲先の `gate.mjs` を読まず、Hook を「判定して終了コードを返すだけ」と見なしたからである
- その前提で進んだのは、Hook を測る手順に、当てる前に委譲先まで副作用を挙げ、副作用のあるものを隔離した環境で実行する段が無いからである
- テストを書く側も同じで、引数なしで起動したときの委譲先の副作用（忘却の書き換え）を挙げずに、実リポジトリを cwd にした

## 根拠

同じ原因（委譲先の副作用を挙げずに、本物のスクリプトを実リポジトリで動かした）で再発し、単独のテストの実行で書き換えを再現したので high とする。
最初の観測では、副作用の出所を `gate.mjs` の `runCollect` に絞れた。
観測: 計測用のスクリプトで 6 つの Hook に入力を当てた呼び出しで、agent-usage の stderr が記録と stage を報告し、`git status` に 2 件の追加が出た。
KEDB 照合: 「副作用」「Hook」で 3 件、「本物」「スクリプト」「入力」で 1 件当たったが、どれも原因が違う。
再発の観測: `kaizen-degraded-warning.test.ts` を `-t "本番構成"` で単独に実行し、`git status` に 7 件の変更が出た。

## 既存の規約

- 扱い: なし
- 場所: なし
- 照合した範囲: `AGENTS.md`・`docs/agent-workflow.md`・`docs/testing.md`・`.agents/rules/` を「副作用」「cwd: repoRoot」「実リポジトリを cwd」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

本物の Hook やチェックのスクリプトに組み立てた入力を当てて測る前に（テストから起動するときも）、委譲先まで読んで分岐ごとの副作用（ファイルの書き込み・stage・外部への送信）を挙げ、副作用のあるものは使い捨てのリポジトリと隔離した環境変数で実行する。

- 置き場所の候補: `docs/agent-workflow.md`「確かめ方」
- 横断: kaizen-context-inject（マーカーの削除）・kaizen-stop-mark（センチネルの作成）・kaizen-precommit-gate（センチネルの解消）も、当てると状態を書き換える。今回の計測では、context-inject をこの worktree の中で当てた
- 横断: `scripts/skills/kaizen/` のテストで、`cwd: repoRoot` の `spawnSync` を挙げる
