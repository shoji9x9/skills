# Skill Benchmark: kaizen

**Model**: claude-code / opus（reasoning effort high）
**Date**: 2026-11-09
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #930 の変更確認である。
kaizen の抽出と適用で、新しい学びの提案が既存の学び・規約・利用者の指示と食い違うかを確かめ、食い違うときは利用者が決めるまで書かないか適用しない手順を足した。
返事をする人がいない実行では、食い違う学びを `## 食い違い` の `判断: 判断待ち` として残す。
食い違う学びと食い違わない学びを両方入力にした eval を、抽出（30）と適用（31）の 2 つ足した。

## 入力の変更

- eval 30 と 31 を新しく足した。どちらも、それより前の iteration に結果が無いので、比べる記録は無い。
- eval 29 の番号は使っていない。削除済みの eval の番号として、iteration-32 と iteration-33 に記録が残っているためである。
- run の後に、自動の忘却（`kaizen-forget.sh --auto`）が判断待ちの学びを候補から外す変更を入れた。どちらの eval の prompt も忘却まで進まないので、実行し直していない。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 30（抽出） | 6/6 | 2/6 |
| 31（適用） | 6/6 | 4/6 |

## 差の出た所と出なかった所

- eval 30 の with_skill は、1 つ目の学びに `## 食い違い`（相手: `AGENTS.md`「依存の管理」、判断: 判断待ち）を書き、2 つ目に `相手: なし`・`判断: なし` を書いた。
- eval 30 の without_skill は、食い違いに気付いて独自の「規約との衝突」の節を書いたが、相手と判断を記録する形が無く、2 つ目の学びには節を書かなかった。
- eval 31 の with_skill は、食い違う学びを適用せずに `## 食い違い` を書き足して pending のまま残し、食い違わない学びだけを `AGENTS.md` に適用した。
- eval 31 の without_skill も、食い違う学びを自分の判断で保留にし、`AGENTS.md` の規約を変えなかった。差は、保留をファイルに記録したか（`## 食い違い` の判断待ち）と、lifecycle 検査の 2 本だけである。
  `AGENTS.md` を変えないこと、status を pending のまま残すこと、食い違わない学びを適用することの 3 本は、後退の検出が目的で、Delta には寄与しない。
- 両方の without_skill は、同梱の `kaizen-status-check.sh` が環境に無いので、lifecycle 検査を実行できなかった。汚染の判定はどちらも `clean` である。
