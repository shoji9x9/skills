---
date: 2026-09-16
type: rule
priority: medium
status: applied
applied-to: [.agents/rules/eval-assertion-discrimination.md]
session: claude-code
---

# eval の期待値は、自分が書いた入力の意味論を評価し直して導出する

## 事象

Issue #376 の eval 29 で、prompt に自分で書いた入口クエリ
`SELECT p.plan_id, p.plan_name, r.member_id FROM MST_PLAN p LEFT JOIN REL_PLAN_MEMBER r ON r.plan_id = p.plan_id WHERE p.archived = false`
に対し、assertion 1 へ「1 行が表すもの（計画 1 件）」と書いた。実際は `LEFT JOIN` により 1 計画 N 行＝（計画, メンバー）の組になる。

- **正しく読んだ回答が fail、誤読した回答が pass する逆転採点**を回帰テストに埋め込んでいた。
- しかもこの eval が測ろうとしている論点（親 1 件 vs（親, 子）の組で要求単位が変わる）そのものを否定していた。
- code-review が指摘して修正（手戻り 1 往復）。実走では `with_skill` が正しく「(計画, 割当メンバー) の組」と導出しており、修正しなければ 5/5 が 4/5 になっていた。

## 根本原因

- なぜ逆転したか? → 期待値を「書くつもりだった意図」（`/plans` は親の一覧画面）のまま assertion にし、直前に自分で書いた SQL を読み直して導出しなかった
  - なぜそうなったか? → SQL は「材料」、assertion は「測りたいこと」として別々の工程で書き、両者を突き合わせる工程が無い。入力も assertion も同じ書き手が作るため、齟齬があっても誰にも止められない
    - なぜ気付かなかったか? → `.agents/rules/eval-assertion-discrimination.md` の 6 点は「**測れるか**」（弁別・到達・材料・主価値・入力が答えを持っていないか）と「**正本＝スキルの契約に実在するか**」を問うが、**入力データの意味論から期待値が導出されているか**を問う項目が無い ← 根本原因（対策可能）

KEDB: [[2026-09-02-eval-material-must-match-source-of-truth]]（applied）は同じ rule の「assertion の根拠を fixture の中身から逆算しない」側で、機構が逆向き。今回は**入力データが答えを決める部分について、入力を評価し直していない**。applied のため追記せず恒久側を強化する。

横断スコープ: `replace-strategy` の全 fixture / prompt を確認した。eval 20（`MST_` 3 テーブル）・eval 25（可視要素の帰属）は
入力に置いた要素の**列挙の一致**を問うだけで導出を要さない。SQL・集計・件数など入力の意味論を assertion が述べているのは eval 29 だけだった。
他スキルの evals にも SQL を材料に置いた assertion は無い。

## 提案

eval の assertion が入力データの意味論（クエリの返す行・集計値・件数・順序）を述べるなら、その値は入力を実際に評価して導出し、書いた意図から書かない。

`.agents/rules/eval-assertion-discrimination.md` の「正本整合」の項へ次を足す:

- **入力意味論の導出**: assertion が prompt / fixture に置いた**入力データの意味論**（返却行の単位・集計値・件数・順序）を述べるなら、
  その値は**入力を実際に評価して導出する**。書くつもりだった意図のまま書かない——入力も assertion も同じ書き手が作るため
  齟齬は誰にも止められず、**正しく読んだ回答が fail し誤読が pass する逆転採点**として回帰テストに固定される。
  SQL の `JOIN` / `GROUP BY`、ページング、フィルタは、意図（「親の一覧画面」）と実際の返却単位が食い違いやすい。
  入力を後から書き換えたときも、その入力を根拠にしている assertion を同じ変更で導出し直す。
