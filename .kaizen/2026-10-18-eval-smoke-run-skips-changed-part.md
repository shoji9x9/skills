---
date: 2026-10-18
type: doc
priority: high
status: pending
applied-to: []
session: claude-code
---

# eval の試しの 1 run を、変えた部品を実行しない eval で選び、全件の起動後にランナーの不具合が分かった

## 事象

Issue #625 で、配布スキルに `config-schemas/`（設定のスキーマ）と `scripts/skill-config/`（読み取り）を足し、eval を 113 run 起動した。
起動の前に 1 run だけ試したが、選んだのは spec の先頭の agent-usage#3（読み取りを実行しない、答えるだけの eval）だった。
確かめたのは隔離（`isolation.txt`）とスキルを読んだか（`skill_usage`）だけで、変えた部品が run の中で動いたかは見なかった。
113 run が終わった後の採点で、`run-skill-eval.sh` が `SKILL.md`・`references`・`assets`・`scripts` だけをコピーし、`config-schemas/` を置かないと分かった。
読み取りを実行した 30 run は「スキーマが無い」で失敗していて、実行し直した。続けて、`get` が入れ子のパスを受け付けないことでも 15 run を実行し直した。

## 根本原因

- なぜ 45 run を実行し直したか → ランナーがスキルの一部しかコピーせず、読み取りが eval の中でだけ失敗した。`get` の入れ子のパスも、eval で初めて使われた
- なぜ全件の前に分からなかったか → 試しの 1 run が、変えた部品（読み取り）を実行しない eval だった。結果も、隔離と読んだかだけを見て合格とした
- なぜその eval を選んだか → 試しの run は「ランナーが動くか」を確かめるものと考え、spec の先頭を選んだ。変えた部品が run の中で動くことを確かめる対象に入れていなかった。
  `docs/agent-workflow.md` の「外部プロセスを動かすツールは、本番と同じ呼び出しで先に小さく試す」を、ランナーの起動にだけ当て、変えた部品の呼び出しに当てなかった

## 提案

eval を多数起動する前の試しの run は、変えた部品を実行する eval から選び、raw（`raw/claude-code.jsonl`）でその部品の呼び出しが成功したことを確かめてから全件を起動する。

- 適用先の候補: `docs/skill-development.md`「実走の既定スコープ」に、試しの run の選び方と確かめる内容を 1 項目足す
- ランナーがコピーする一覧と配布スキルの直下の要素の一致は、`scripts/eval/skill-eval-fingerprint.test.ts` で確かめるようにした（同じ commit）
