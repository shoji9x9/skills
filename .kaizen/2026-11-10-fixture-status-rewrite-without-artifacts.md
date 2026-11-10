---
date: 2026-11-10
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 既存の fixture を別の状態に書き換えるときは、その状態までに作られる成果物も合わせる

## 事象

Issue #892 の eval 8 で、eval 5 の fixture（`status: blocked`、`from_step: 6`）を `handed-off` の記録に書き換えた。
`metadata.json` の `status`・`resume`・`current` の日時と、`semantics.md`・`verification.md` は書き換えたが、`bootstrap/schema.sh` は元のまま（インスタンスの `time_zone` と `sql_mode` を設定しない）だった。
with_skill は「回答に合わせてツールを直す必要がある」と規則どおりに判断して `blocked` に戻し、確認待ちを確定させるだけの場面を測れなかった。fixture を直して 4 run を実行し直した。

## 根本原因

- なぜ別の分岐に進んだか: ツールが `handed-off` の前提（`schema.md` の値を環境に当てている）を満たしていなかった
- なぜ合わせなかったか: 書き換えの対象を、新しい状態を宣言する値（`status` など）と台帳から選び、その状態になるまでにスキルの手順が作る成果物（ツールの中身）を挙げなかった
- なぜ挙げなかったか: rule の「同じ fixture の他のファイルとも、件数と状態の集合を突き合わせる」は、ツールが書く成果物の節にあり、件数と状態の値だけを求めている。成果物の中身が状態と合うかは書いていない
- 事前のレビュー（サブエージェント）も件数と状態の値を突き合わせ、ツールの中身は見なかった

## 根拠

確信度 medium: 原因は fixture を直して実行し直した run で確かめた（with_skill が `handed-off` のまま終えた）。再発は観測していない。
KEDB 照合で、同じ原因の学びは無かった。

## 既存の規約

- 扱い: 埋もれている
- 場所: `.agents/rules/eval-assertion-discrimination.md`「fixture に置く成果物は、誰が書くかで分ける」の最後の 2 行
- 照合した範囲: `AGENTS.md`・`.agents/rules/`・`docs/`・`skills/current-environment-bootstrap` を「状態の集合」「fixture を作った時点」「書き換えて作る」で検索

## 食い違い

- 相手: なし
- 判断: なし

## 提案

`.agents/rules/eval-assertion-discrimination.md` に「既存の fixture を別の状態に書き換えて作るときは、その状態になるまでにスキルの手順が作る成果物を挙げ、中身が新しい状態と矛盾しないかを 1 つずつ確かめる」を足す。

- 置き場所は「原本と合っているか」の節にする。fixture を作る規律で、状態を書き換える場面が最初に読む位置である
- 例: `blocked` を `handed-off` に変えるなら、工程 3・6 のツールが台帳の値を環境に当てていること
- 宣言の値だけを書き換えると、取り決めどおりに動いた run が矛盾を見つけて別の分岐に進み、測りたい分岐を測れない
